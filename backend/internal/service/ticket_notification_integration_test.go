//go:build integration

package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"aux-system/ent"
	"aux-system/ent/notificationdelivery"
	"aux-system/ent/systemmeta"

	entsql "entgo.io/ent/dialect/sql"
	_ "github.com/lib/pq"
	"github.com/stretchr/testify/require"
)

type ticketNotificationTransport struct {
	target *url.URL
}

func (transport ticketNotificationTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	cloned := request.Clone(request.Context())
	cloned.URL.Scheme, cloned.URL.Host = transport.target.Scheme, transport.target.Host
	return http.DefaultTransport.RoundTrip(cloned)
}

func TestTicketProgressNotificationDelivery(t *testing.T) {
	dsn := os.Getenv("TICKET_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("需要隔离 PostgreSQL 测试库 TICKET_TEST_DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := sql.Open("postgres", dsn)
	require.NoError(t, err)
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	schema := "ticket_notification_test_" + time.Now().Format("20060102150405000000000")
	_, err = db.ExecContext(ctx, `CREATE SCHEMA `+schema)
	require.NoError(t, err)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = db.ExecContext(cleanupCtx, `DROP SCHEMA `+schema+` CASCADE`)
	})
	_, err = db.ExecContext(ctx, `SET search_path TO `+schema)
	require.NoError(t, err)
	client := ent.NewClient(ent.Driver(entsql.OpenDB("postgres", db)))
	require.NoError(t, client.Schema.Create(ctx))

	var mutex sync.Mutex
	var emails []map[string]interface{}
	var webhooks []map[string]interface{}
	rejectEmail := false
	sink := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload map[string]interface{}
		if decodeErr := json.NewDecoder(request.Body).Decode(&payload); decodeErr != nil {
			t.Errorf("解析通知请求失败：%v", decodeErr)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		mutex.Lock()
		defer mutex.Unlock()
		if request.URL.Path == "/emails" {
			emails = append(emails, payload)
			if rejectEmail {
				writer.WriteHeader(http.StatusServiceUnavailable)
				return
			}
		} else {
			webhooks = append(webhooks, payload)
		}
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer sink.Close()
	target, err := url.Parse(sink.URL)
	require.NoError(t, err)
	notifications := NewNotificationService(client)
	notifications.httpClient = &http.Client{Transport: ticketNotificationTransport{target: target}, Timeout: 5 * time.Second}
	email, err := notifications.CreateChannel(ctx, NotificationChannelInput{Name: "测试邮件", Type: NotificationChannelResend, Config: map[string]interface{}{"api_key": "local-test", "from": "sender@example.com"}})
	require.NoError(t, err)
	webhook, err := notifications.CreateChannel(ctx, NotificationChannelInput{Name: "测试管理员 Webhook", Type: NotificationChannelWebhook, Config: map[string]interface{}{"url": sink.URL + "/webhook"}})
	require.NoError(t, err)
	_, err = notifications.SetEventChannelsWithRecipients(ctx, TicketCreatedNotificationEvent, []int{email.ID, webhook.ID}, map[int][]string{email.ID: {"admin@example.com"}})
	require.NoError(t, err)
	tickets := NewTicketService(NewEntTicketStore(client), notifications)
	ticket, err := tickets.Create(ctx, 17, "owner@example.com", "Alice", TicketInput{Subject: "登录失败", Body: "首次描述"})
	require.NoError(t, err)

	for _, message := range []string{"第一次追加", "第二次追加"} {
		_, err = tickets.ReplyAsUser(ctx, 17, "Alice", ticket.ID, message)
		require.NoError(t, err)
	}
	for _, message := range []string{"已收到", "已定位问题"} {
		_, err = tickets.ReplyAsAdmin(ctx, ticket.ID, message)
		require.NoError(t, err)
	}
	_, err = tickets.UpdateStatus(ctx, ticket.ID, TicketStatusClosed)
	require.NoError(t, err)
	_, err = tickets.UpdateStatus(ctx, ticket.ID, TicketStatusClosed)
	require.NoError(t, err)
	_, err = tickets.ReplyAsUser(ctx, 17, "Alice", ticket.ID, "关闭后回复")
	require.ErrorIs(t, err, ErrTicketClosed)
	_, err = tickets.ReplyAsUser(ctx, 99, "Other", ticket.ID, "他人回复")
	require.ErrorIs(t, err, ErrTicketNotFound)

	mutex.Lock()
	require.Len(t, emails, 6)
	for index, email := range emails {
		recipient := "admin@example.com"
		if index >= 3 {
			recipient = "owner@example.com"
		}
		require.Equal(t, []interface{}{recipient}, email["to"])
	}
	require.Contains(t, emails[3]["text"], "已收到")
	require.Contains(t, emails[4]["text"], "已定位问题")
	require.Contains(t, emails[5]["text"], "已关闭")
	require.Len(t, webhooks, 3, "管理员回复不得广播到管理员 Webhook")
	require.Equal(t, TicketCreatedNotificationEvent, webhooks[0]["event"])
	require.Equal(t, TicketUserRepliedNotificationEvent, webhooks[1]["event"])
	require.Equal(t, "第二次追加", webhooks[2]["message"])
	mutex.Unlock()

	logs, err := notifications.ListDeliveries(ctx, TicketAdminRepliedNotificationEvent, NotificationDeliverySent, 1, 100)
	require.NoError(t, err)
	require.Equal(t, 2, logs.Total)
	for _, delivery := range logs.Items {
		require.Equal(t, "owner@example.com", delivery.Recipient)
	}

	// 显式空配置关闭用户回复提醒，不回退到新工单配置。
	_, err = notifications.SetEventChannels(ctx, TicketUserRepliedNotificationEvent, nil)
	require.NoError(t, err)
	config, err := notifications.GetEventConfig(ctx, TicketUserRepliedNotificationEvent)
	require.NoError(t, err)
	require.Empty(t, config.ChannelIDs)
	_, err = tickets.UpdateStatus(ctx, ticket.ID, TicketStatusOpen)
	require.NoError(t, err)
	_, err = tickets.ReplyAsUser(ctx, 17, "Alice", ticket.ID, "空配置仍保存回复")
	require.NoError(t, err)
	failed, err := notifications.ListDeliveries(ctx, TicketUserRepliedNotificationEvent, NotificationDeliveryFailed, 1, 100)
	require.NoError(t, err)
	require.Equal(t, 1, failed.Total)

	// 用户事件可只选择发件渠道；配置的管理员地址也不得影响实际收件人。
	_, err = notifications.SetEventChannelsWithRecipients(ctx, TicketAdminRepliedNotificationEvent, []int{email.ID}, map[int][]string{email.ID: {"wrong@example.com"}})
	require.NoError(t, err)
	_, err = notifications.SetEventChannels(ctx, TicketAdminRepliedNotificationEvent, []int{webhook.ID})
	require.ErrorContains(t, err, "仅支持 SMTP 或 Resend")
	_, err = tickets.ReplyAsAdmin(ctx, ticket.ID, "单独选择发件渠道")
	require.NoError(t, err)
	_, err = notifications.SetEventChannels(ctx, TicketAdminRepliedNotificationEvent, []int{email.ID})
	require.NoError(t, err)
	mutex.Lock()
	require.Equal(t, []interface{}{"owner@example.com"}, emails[len(emails)-1]["to"])
	rejectEmail = true
	mutex.Unlock()
	_, err = tickets.ReplyAsAdmin(ctx, ticket.ID, "投递失败仍保存回复")
	require.NoError(t, err)
	failed, err = notifications.ListDeliveries(ctx, TicketAdminRepliedNotificationEvent, NotificationDeliveryFailed, 1, 100)
	require.NoError(t, err)
	require.Equal(t, 1, failed.Total)
	require.Equal(t, "owner@example.com", failed.Items[0].Recipient)
	disabled := false
	_, err = notifications.UpdateChannel(ctx, email.ID, NotificationChannelInput{Name: email.Name, Type: email.Type, Config: email.Config, Enabled: &disabled})
	require.NoError(t, err)
	_, err = tickets.ReplyAsAdmin(ctx, ticket.ID, "渠道停用仍保存回复")
	require.NoError(t, err)
	failed, err = notifications.ListDeliveries(ctx, TicketAdminRepliedNotificationEvent, NotificationDeliveryFailed, 1, 100)
	require.NoError(t, err)
	require.Equal(t, 2, failed.Total)
	require.Contains(t, failed.Items[0].ErrorMessage, "已停用")
	require.Equal(t, "owner@example.com", failed.Items[0].Recipient)

	// 群聊渠道无法投递给用户，邮箱缺失也必须留下失败日志。
	_, err = client.SystemMeta.Delete().Where(systemmeta.KeyEQ(notificationEventConfigPrefix + TicketAdminRepliedNotificationEvent)).Exec(ctx)
	require.NoError(t, err)
	_, err = notifications.SetEventChannels(ctx, TicketCreatedNotificationEvent, []int{webhook.ID})
	require.NoError(t, err)
	for index, ownerEmail := range []string{"owner@example.com", ""} {
		_, err = client.SupportTicket.UpdateOneID(ticket.ID).SetUserEmail(ownerEmail).Save(ctx)
		require.NoError(t, err)
		_, err = tickets.ReplyAsAdmin(ctx, ticket.ID, fmt.Sprintf("无法投递 %d", index))
		require.NoError(t, err)
	}
	failed, err = notifications.ListDeliveries(ctx, TicketAdminRepliedNotificationEvent, NotificationDeliveryFailed, 1, 100)
	require.NoError(t, err)
	require.Equal(t, 4, failed.Total)
	require.Contains(t, failed.Items[0].ErrorMessage, "邮箱缺失或无效")
	require.Contains(t, failed.Items[1].ErrorMessage, "SMTP 或 Resend")
	stored, err := tickets.GetForAdmin(ctx, ticket.ID)
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(stored.Messages[len(stored.Messages)-1].Body, "无法投递"))
	count, err := client.NotificationDelivery.Query().Where(notificationdelivery.StatusEQ(NotificationDeliverySent)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 11, count)
}
