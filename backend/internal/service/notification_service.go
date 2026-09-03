package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"

	"sub2api-extension/ent"
	"sub2api-extension/ent/notificationchannel"
	"sub2api-extension/ent/notificationdelivery"
	"sub2api-extension/ent/systemmeta"
)

const InvoiceApplicationNotificationEvent = "invoice.application.created"
const NotificationChannelTestEvent = "notification.channel.test"
const notificationEventConfigPrefix = "notification.event."

type NotificationChannelType string

const (
	NotificationChannelEmail   NotificationChannelType = "email"
	NotificationChannelResend  NotificationChannelType = "resend"
	NotificationChannelWebhook NotificationChannelType = "webhook"
	NotificationChannelFeishu  NotificationChannelType = "feishu"
)

const (
	NotificationDeliverySent   = "SENT"
	NotificationDeliveryFailed = "FAILED"
)

var (
	ErrNotificationChannelNotFound       = errors.New("notification channel not found")
	ErrInvalidNotificationChannel        = errors.New("invalid notification channel")
	ErrInvalidNotificationDeliveryStatus = errors.New("invalid notification delivery status")
)

type NotificationChannelInput struct {
	Name    string                  `json:"name"`
	Type    NotificationChannelType `json:"type"`
	Config  map[string]interface{}  `json:"config"`
	Enabled *bool                   `json:"enabled"`
}

type NotificationChannelView struct {
	ID        int                     `json:"id"`
	Name      string                  `json:"name"`
	Type      NotificationChannelType `json:"type"`
	Config    map[string]interface{}  `json:"config"`
	Enabled   bool                    `json:"enabled"`
	CreatedAt time.Time               `json:"created_at"`
	UpdatedAt time.Time               `json:"updated_at"`
}

type NotificationEventConfig struct {
	Event             string                    `json:"event"`
	ChannelIDs        []int                     `json:"channel_ids"`
	ChannelRecipients map[int][]string          `json:"channel_recipients"`
	Channels          []NotificationChannelView `json:"channels"`
}

type storedNotificationEventConfig struct {
	ChannelIDs        []int               `json:"channel_ids"`
	ChannelRecipients map[string][]string `json:"channel_recipients,omitempty"`
}

type NotificationDeliveryView struct {
	ID           int        `json:"id"`
	ChannelID    *int       `json:"channel_id,omitempty"`
	ChannelName  string     `json:"channel_name"`
	ChannelType  string     `json:"channel_type"`
	Event        string     `json:"event"`
	Status       string     `json:"status"`
	Recipient    string     `json:"recipient"`
	Subject      string     `json:"subject"`
	ErrorMessage string     `json:"error_message,omitempty"`
	Attempts     int        `json:"attempts"`
	SentAt       *time.Time `json:"sent_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

type NotificationDeliveryPage struct {
	Items      []NotificationDeliveryView `json:"items"`
	Total      int                        `json:"total"`
	Page       int                        `json:"page"`
	PageSize   int                        `json:"page_size"`
	TotalPages int                        `json:"total_pages"`
}

type NotificationService struct {
	client     *ent.Client
	httpClient *http.Client
}

func NewNotificationService(client *ent.Client) *NotificationService {
	return &NotificationService{client: client, httpClient: &http.Client{Timeout: 10 * time.Second}}
}

func (s *NotificationService) ListChannels(ctx context.Context) ([]NotificationChannelView, error) {
	if s == nil || s.client == nil {
		return nil, errors.New("notification store is unavailable")
	}
	items, err := s.client.NotificationChannel.Query().Order(ent.Asc(notificationchannel.FieldID)).All(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]NotificationChannelView, 0, len(items))
	for _, item := range items {
		result = append(result, mapNotificationChannel(item, true))
	}
	return result, nil
}

func (s *NotificationService) CreateChannel(ctx context.Context, input NotificationChannelInput) (*NotificationChannelView, error) {
	if s == nil || s.client == nil {
		return nil, errors.New("notification store is unavailable")
	}
	name, typ, cfg, err := normalizeNotificationChannel(input)
	if err != nil {
		return nil, err
	}
	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	item, err := s.client.NotificationChannel.Create().SetName(name).SetType(string(typ)).SetConfig(cfg).SetEnabled(enabled).Save(ctx)
	if err != nil {
		return nil, err
	}
	view := mapNotificationChannel(item, true)
	return &view, nil
}

func (s *NotificationService) UpdateChannel(ctx context.Context, id int, input NotificationChannelInput) (*NotificationChannelView, error) {
	if s == nil || s.client == nil {
		return nil, errors.New("notification store is unavailable")
	}
	if id <= 0 {
		return nil, ErrNotificationChannelNotFound
	}
	item, err := s.client.NotificationChannel.Get(ctx, id)
	if ent.IsNotFound(err) {
		return nil, ErrNotificationChannelNotFound
	}
	if err != nil {
		return nil, err
	}
	name, typ, cfg, err := normalizeNotificationChannel(input)
	if err != nil {
		return nil, err
	}
	// A masked secret means "keep the old value". This lets the admin list be
	// safely rendered without making every edit rotate credentials.
	if item.Type == string(typ) {
		cfg = mergeMaskedSecrets(item.Config, cfg)
	}
	cfg = stripChannelRecipients(typ, cfg)
	edit := s.client.NotificationChannel.UpdateOne(item).SetName(name).SetType(string(typ)).SetConfig(cfg)
	if input.Enabled != nil {
		edit.SetEnabled(*input.Enabled)
	}
	updated, err := edit.Save(ctx)
	if err != nil {
		return nil, err
	}
	view := mapNotificationChannel(updated, true)
	return &view, nil
}

func (s *NotificationService) DeleteChannel(ctx context.Context, id int) error {
	if s == nil || s.client == nil {
		return errors.New("notification store is unavailable")
	}
	if id <= 0 {
		return ErrNotificationChannelNotFound
	}
	n, err := s.client.NotificationChannel.Delete().Where(notificationchannel.IDEQ(id)).Exec(ctx)
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotificationChannelNotFound
	}
	return nil
}

// TestChannel sends one test message through exactly one channel and records
// the result in the system notification log. It intentionally does not check
// Enabled so an administrator can validate a channel before enabling it for
// business events.
func (s *NotificationService) TestChannel(ctx context.Context, id int) error {
	if s == nil || s.client == nil {
		return errors.New("notification store is unavailable")
	}
	if id <= 0 {
		return ErrNotificationChannelNotFound
	}
	item, err := s.client.NotificationChannel.Get(ctx, id)
	if ent.IsNotFound(err) {
		return ErrNotificationChannelNotFound
	}
	if err != nil {
		return err
	}

	payload := map[string]interface{}{
		"event":        NotificationChannelTestEvent,
		"channel_id":   item.ID,
		"channel_name": item.Name,
		"channel_type": item.Type,
	}
	encoded, _ := json.Marshal(payload)
	subject := fmt.Sprintf("通知渠道测试：%s", item.Name)
	body := fmt.Sprintf("这是一条来自「%s」的通知渠道测试消息。", item.Name)
	recipients := []string(nil)

	if item.Type == string(NotificationChannelEmail) || item.Type == string(NotificationChannelResend) {
		_, configuredRecipients, configErr := s.readEventConfig(ctx, InvoiceApplicationNotificationEvent)
		if configErr != nil {
			recordErr := s.recordDelivery(ctx, &id, item.Name, item.Type, NotificationChannelTestEvent, "", subject, string(encoded), configErr)
			if recordErr != nil {
				return recordErr
			}
			return configErr
		}
		recipients = configuredRecipients[id]
		if len(recipients) == 0 {
			sendErr := errors.New("测试邮箱渠道前，请先在发票申请通知中填写收件人邮箱")
			recordErr := s.recordDelivery(ctx, &id, item.Name, item.Type, NotificationChannelTestEvent, "", subject, string(encoded), sendErr)
			if recordErr != nil {
				return recordErr
			}
			return sendErr
		}
	}

	sendConfig := cloneMap(item.Config)
	if len(recipients) > 0 {
		sendConfig["to"] = recipients
	}
	sendErr := s.send(ctx, item.Type, sendConfig, subject, body, payload)
	recordErr := s.recordDelivery(ctx, &id, item.Name, item.Type, NotificationChannelTestEvent, deliveryRecipient(item.Config, recipients), subject, string(encoded), sendErr)
	if recordErr != nil {
		return recordErr
	}
	return sendErr
}

func (s *NotificationService) GetEventConfig(ctx context.Context, event string) (*NotificationEventConfig, error) {
	if s == nil || s.client == nil {
		return nil, errors.New("notification store is unavailable")
	}
	event = normalizeEvent(event)
	if event == "" {
		return nil, errors.New("event is required")
	}
	ids, recipients, err := s.readEventConfig(ctx, event)
	if err != nil {
		return nil, err
	}
	channels := make([]NotificationChannelView, 0, len(ids))
	for _, id := range ids {
		item, getErr := s.client.NotificationChannel.Get(ctx, id)
		if ent.IsNotFound(getErr) {
			continue
		}
		if getErr != nil {
			return nil, getErr
		}
		channels = append(channels, mapNotificationChannel(item, true))
	}
	return &NotificationEventConfig{Event: event, ChannelIDs: ids, ChannelRecipients: recipients, Channels: channels}, nil
}

func (s *NotificationService) SetEventChannels(ctx context.Context, event string, ids []int) (*NotificationEventConfig, error) {
	return s.SetEventChannelsWithRecipients(ctx, event, ids, nil)
}

func (s *NotificationService) SetEventChannelsWithRecipients(ctx context.Context, event string, ids []int, recipients map[int][]string) (*NotificationEventConfig, error) {
	if s == nil || s.client == nil {
		return nil, errors.New("notification store is unavailable")
	}
	event = normalizeEvent(event)
	if event == "" {
		return nil, errors.New("event is required")
	}
	ids = uniquePositiveIDs(ids)
	recipients = normalizeRecipientMap(recipients)
	if len(ids) > 0 {
		items, err := s.client.NotificationChannel.Query().Where(notificationchannel.IDIn(ids...)).All(ctx)
		if err != nil {
			return nil, err
		}
		found := make(map[int]bool, len(items))
		for _, item := range items {
			// A disabled channel remains a valid event selection. It is skipped
			// at send time and produces a FAILED audit row, so operators can see
			// the reason without silently losing the event mapping.
			found[item.ID] = true
		}
		for _, id := range ids {
			if !found[id] {
				return nil, fmt.Errorf("notification channel %d is not found or disabled", id)
			}
		}
		for _, item := range items {
			if (item.Type == string(NotificationChannelEmail) || item.Type == string(NotificationChannelResend)) && containsInt(ids, item.ID) && len(recipients[item.ID]) == 0 && len(configStrings(item.Config, "to", "recipients")) == 0 {
				return nil, fmt.Errorf("通知渠道 %q 需要在业务通知中填写收件人邮箱", item.Name)
			}
			if (item.Type == string(NotificationChannelEmail) || item.Type == string(NotificationChannelResend)) && len(recipients[item.ID]) > 0 {
				if err := validateRecipientEmails(recipients[item.ID]); err != nil {
					return nil, fmt.Errorf("通知渠道 %q: %w", item.Name, err)
				}
			}
		}
	}
	stored := storedNotificationEventConfig{ChannelIDs: ids, ChannelRecipients: map[string][]string{}}
	for id, values := range recipients {
		if containsInt(ids, id) {
			stored.ChannelRecipients[strconv.Itoa(id)] = values
		}
	}
	encoded, err := json.Marshal(stored)
	if err != nil {
		return nil, err
	}
	meta, err := s.client.SystemMeta.Query().Where(systemmeta.KeyEQ(notificationEventConfigPrefix + event)).Only(ctx)
	if ent.IsNotFound(err) {
		if _, err = s.client.SystemMeta.Create().SetKey(notificationEventConfigPrefix + event).SetValue(string(encoded)).Save(ctx); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	} else if err = s.client.SystemMeta.UpdateOne(meta).SetValue(string(encoded)).Exec(ctx); err != nil {
		return nil, err
	}
	return s.GetEventConfig(ctx, event)
}

func (s *NotificationService) ListDeliveries(ctx context.Context, event, status string, page, pageSize int) (*NotificationDeliveryPage, error) {
	return s.ListDeliveriesFiltered(ctx, event, status, time.Time{}, time.Time{}, page, pageSize)
}

func (s *NotificationService) ListDeliveriesFiltered(ctx context.Context, event, status string, startAt, endAt time.Time, page, pageSize int) (*NotificationDeliveryPage, error) {
	if s == nil || s.client == nil {
		return nil, errors.New("notification store is unavailable")
	}
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 200 {
		pageSize = 200
	}
	query := s.client.NotificationDelivery.Query()
	rawEvent := strings.TrimSpace(event)
	event = normalizeEvent(rawEvent)
	if rawEvent != "" && event == "" {
		return nil, errors.New("event is too long")
	}
	if event != "" {
		query = query.Where(notificationdelivery.EventEQ(event))
	}
	if !startAt.IsZero() {
		query = query.Where(notificationdelivery.CreatedAtGTE(startAt))
	}
	if !endAt.IsZero() {
		query = query.Where(notificationdelivery.CreatedAtLT(endAt))
	}
	if status = strings.ToUpper(strings.TrimSpace(status)); status != "" {
		if status != NotificationDeliverySent && status != NotificationDeliveryFailed {
			return nil, ErrInvalidNotificationDeliveryStatus
		}
		query = query.Where(notificationdelivery.StatusEQ(status))
	}
	total, err := query.Count(ctx)
	if err != nil {
		return nil, err
	}
	items, err := query.Order(ent.Desc(notificationdelivery.FieldCreatedAt), ent.Desc(notificationdelivery.FieldID)).Offset((page - 1) * pageSize).Limit(pageSize).All(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]NotificationDeliveryView, 0, len(items))
	for _, item := range items {
		result = append(result, mapNotificationDelivery(item))
	}
	totalPages := 0
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	return &NotificationDeliveryPage{Items: result, Total: total, Page: page, PageSize: pageSize, TotalPages: totalPages}, nil
}

// ParseNotificationDateTime accepts RFC3339 and the browser's datetime-local
// format. The latter is interpreted in the server's configured local timezone.
func ParseNotificationDateTime(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, nil
	}
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return parsed, nil
	}
	if parsed, err := time.ParseInLocation("2006-01-02T15:04", value, time.Local); err == nil {
		return parsed, nil
	}
	if parsed, err := time.ParseInLocation("2006-01-02 15:04", value, time.Local); err == nil {
		return parsed, nil
	}
	return time.Time{}, fmt.Errorf("invalid datetime %q", value)
}

// NotifyInvoiceApplication sends after the invoice transaction has committed.
// A failed delivery never fails the invoice request; it is persisted as an
// immutable FAILED record with a human-readable reason for later retry tools.
func (s *NotificationService) NotifyInvoiceApplication(ctx context.Context, request *InvoiceRequest) error {
	if s == nil || s.client == nil {
		return errors.New("notification store is unavailable")
	}
	if request == nil {
		return errors.New("invoice request is required")
	}
	payload := map[string]interface{}{"event": InvoiceApplicationNotificationEvent, "invoice_request_id": request.ID, "user_email": request.UserEmail, "invoice_title": request.InvoiceTitle, "amount": request.Amount, "status": request.Status}
	subject := fmt.Sprintf("发票申请 #%d", request.ID)
	body := fmt.Sprintf("用户 %s 提交了发票申请，抬头：%s，金额：%.2f，状态：%s。", request.UserEmail, request.InvoiceTitle, request.Amount, request.Status)
	return s.Notify(ctx, InvoiceApplicationNotificationEvent, subject, body, payload)
}

// Notify dispatches one generic event to all channels configured for it. It is
// intentionally independent from invoice types so future modules can reuse
// the same channel registry and delivery audit trail.
func (s *NotificationService) Notify(ctx context.Context, event, subject, body string, payload map[string]interface{}) error {
	if s == nil || s.client == nil {
		return errors.New("notification store is unavailable")
	}
	event = normalizeEvent(event)
	if event == "" {
		return errors.New("event is required")
	}
	ids, recipients, err := s.readEventConfig(ctx, event)
	if err != nil {
		return err
	}
	encoded, _ := json.Marshal(payload)
	if len(ids) == 0 {
		reason := fmt.Errorf("未配置事件 %s 的通知渠道", event)
		if event == InvoiceApplicationNotificationEvent {
			reason = errors.New("未配置发票申请通知渠道")
		}
		return s.recordDelivery(ctx, nil, "", "", event, "", subject, string(encoded), reason)
	}
	var firstErr error
	for _, id := range ids {
		item, getErr := s.client.NotificationChannel.Get(ctx, id)
		if ent.IsNotFound(getErr) {
			err = fmt.Errorf("通知渠道 %d 不存在", id)
			if firstErr == nil {
				firstErr = err
			}
			_ = s.recordDelivery(ctx, &id, "", "", event, "", subject, string(encoded), err)
			continue
		}
		if getErr != nil {
			return getErr
		}
		if !item.Enabled {
			err = fmt.Errorf("通知渠道 %q 已停用", item.Name)
			if firstErr == nil {
				firstErr = err
			}
			_ = s.recordDelivery(ctx, &id, item.Name, item.Type, event, deliveryRecipient(item.Config, recipients[id]), subject, string(encoded), err)
			continue
		}
		sendConfig := cloneMap(item.Config)
		if values := recipients[id]; len(values) > 0 && (item.Type == string(NotificationChannelEmail) || item.Type == string(NotificationChannelResend)) {
			sendConfig["to"] = values
		}
		sendErr := s.send(ctx, item.Type, sendConfig, subject, body, payload)
		if recordErr := s.recordDelivery(ctx, &id, item.Name, item.Type, event, deliveryRecipient(item.Config, recipients[id]), subject, string(encoded), sendErr); recordErr != nil && firstErr == nil {
			firstErr = recordErr
		}
		if sendErr != nil && firstErr == nil {
			firstErr = sendErr
		}
	}
	return firstErr
}

func (s *NotificationService) recordDelivery(ctx context.Context, channelID *int, name, typ, event, recipient, subject, payload string, sendErr error) error {
	if s == nil || s.client == nil {
		return errors.New("notification store is unavailable")
	}
	b := s.client.NotificationDelivery.Create().SetEvent(event).SetChannelName(limitText(name, 120)).SetChannelType(limitText(typ, 24)).SetRecipient(limitText(recipient, 1000)).SetSubject(limitText(subject, 255)).SetPayload(payload).SetAttempts(1)
	if channelID != nil {
		b.SetChannelID(*channelID)
	}
	if sendErr != nil {
		b.SetStatus(NotificationDeliveryFailed).SetErrorMessage(limitText(sendErr.Error(), 2000))
	} else {
		b.SetStatus(NotificationDeliverySent).SetSentAt(time.Now())
	}
	_, err := b.Save(ctx)
	return err
}

func (s *NotificationService) send(ctx context.Context, typ string, cfg map[string]interface{}, subject, body string, payload map[string]interface{}) error {
	switch NotificationChannelType(strings.ToLower(strings.TrimSpace(typ))) {
	case NotificationChannelEmail:
		return sendSMTP(ctx, cfg, subject, body)
	case NotificationChannelResend:
		return s.sendResend(ctx, cfg, subject, body)
	case NotificationChannelWebhook:
		return s.sendWebhook(ctx, cfg, subject, body, payload)
	case NotificationChannelFeishu:
		return s.sendFeishu(ctx, cfg, body)
	default:
		return fmt.Errorf("不支持的通知渠道类型 %q", typ)
	}
}

func (s *NotificationService) sendResend(ctx context.Context, cfg map[string]interface{}, subject, body string) error {
	key, from := configString(cfg, "api_key"), configString(cfg, "from")
	if key == "" || from == "" {
		return errors.New("通知渠道 Resend 需要 api_key 和 from")
	}
	to := configStrings(cfg, "to", "recipients")
	if len(to) == 0 {
		return errors.New("通知渠道 Resend 至少需要一个收件人")
	}
	requestBody := map[string]interface{}{"from": from, "to": to, "subject": subject, "text": body}
	return postJSON(ctx, s.httpClient, "https://api.resend.com/emails", requestBody, map[string]string{"Authorization": "Bearer " + key})
}

func (s *NotificationService) sendWebhook(ctx context.Context, cfg map[string]interface{}, subject, body string, payload map[string]interface{}) error {
	target := configString(cfg, "url")
	if target == "" {
		return errors.New("通知渠道 Webhook 需要 url")
	}
	u, err := url.Parse(target)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return errors.New("通知渠道 Webhook url 无效")
	}
	parsed := u
	provider := normalizeWebhookProvider(configString(cfg, "provider"))
	text := notificationText(subject, body)
	switch provider {
	case "generic":
		headers := map[string]string{}
		if token := configString(cfg, "authorization"); token != "" {
			headers["Authorization"] = token
		}
		if secret := configString(cfg, "secret"); secret != "" {
			headers["X-Webhook-Secret"] = secret
		}
		return postJSON(ctx, s.httpClient, target, payload, headers)
	case "wecom":
		// 企业微信机器人通过 URL 中的 key 鉴权，消息体使用机器人 text 格式。
		requestBody := map[string]interface{}{"msgtype": "text", "text": map[string]string{"content": text}}
		var response struct {
			ErrCode int    `json:"errcode"`
			ErrMsg  string `json:"errmsg"`
		}
		if err := postJSONDecode(ctx, s.httpClient, target, requestBody, nil, &response); err != nil {
			return err
		}
		if response.ErrCode != 0 {
			return fmt.Errorf("企业微信发送失败: %s (errcode=%d)", response.ErrMsg, response.ErrCode)
		}
		return nil
	case "feishu_bot":
		// 飞书机器人可选签名校验；配置 secret 时按官方算法把 timestamp/sign
		// 放入请求体，URL 本身仍使用机器人 Webhook 地址。
		requestBody := map[string]interface{}{"msg_type": "text", "content": map[string]string{"text": text}}
		if secret := configString(cfg, "secret"); secret != "" {
			timestamp := time.Now().Unix()
			requestBody["timestamp"] = strconv.FormatInt(timestamp, 10)
			requestBody["sign"] = signFeishuWebhook(timestamp, secret)
		}
		var response struct {
			Code          int    `json:"code"`
			Msg           string `json:"msg"`
			StatusCode    int    `json:"StatusCode"`
			StatusMessage string `json:"StatusMessage"`
		}
		if err := postJSONDecode(ctx, s.httpClient, target, requestBody, nil, &response); err != nil {
			return err
		}
		code, message := response.Code, response.Msg
		if response.StatusCode != 0 || response.StatusMessage != "" {
			code, message = response.StatusCode, response.StatusMessage
		}
		if code != 0 {
			return fmt.Errorf("飞书机器人发送失败: %s (code=%d)", message, code)
		}
		return nil
	case "dingtalk":
		// 钉钉签名参数属于 URL 查询参数，secret 为空时仅使用 URL 中的
		// access_token，适配未启用加签的机器人。
		if secret := configString(cfg, "secret"); secret != "" {
			timestamp := time.Now().UnixMilli()
			parsed.RawQuery = addDingTalkSignature(parsed.Query(), timestamp, secret)
			target = parsed.String()
		}
		requestBody := map[string]interface{}{"msgtype": "text", "text": map[string]string{"content": text}}
		var response struct {
			ErrCode int    `json:"errcode"`
			ErrMsg  string `json:"errmsg"`
		}
		if err := postJSONDecode(ctx, s.httpClient, target, requestBody, nil, &response); err != nil {
			return err
		}
		if response.ErrCode != 0 {
			return fmt.Errorf("钉钉发送失败: %s (errcode=%d)", response.ErrMsg, response.ErrCode)
		}
		return nil
	default:
		return fmt.Errorf("不支持的 Webhook 平台 %q", provider)
	}
}

func normalizeWebhookProvider(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "generic", "custom", "通用":
		return "generic"
	case "wecom", "wechat_work", "wechatwork", "weixin", "企业微信":
		return "wecom"
	case "feishu", "feishu_bot", "lark", "lark_bot", "飞书", "飞书机器人":
		return "feishu_bot"
	case "dingtalk", "ding_talk", "dingding", "钉钉":
		return "dingtalk"
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func notificationText(subject, body string) string {
	subject, body = strings.TrimSpace(subject), strings.TrimSpace(body)
	if subject == "" {
		return body
	}
	if body == "" {
		return subject
	}
	return subject + "\n" + body
}

func signFeishuWebhook(timestamp int64, secret string) string {
	stringToSign := fmt.Sprintf("%d\n%s", timestamp, secret)
	// 飞书机器人签名规范：以 timestamp\nsecret 作为 HMAC 密钥，消息为空。
	mac := hmac.New(sha256.New, []byte(stringToSign))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func addDingTalkSignature(values url.Values, timestamp int64, secret string) string {
	stringToSign := fmt.Sprintf("%d\n%s", timestamp, secret)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(stringToSign))
	values.Set("timestamp", strconv.FormatInt(timestamp, 10))
	values.Set("sign", base64.StdEncoding.EncodeToString(mac.Sum(nil)))
	return values.Encode()
}

func (s *NotificationService) sendFeishu(ctx context.Context, cfg map[string]interface{}, body string) error {
	appID, appSecret, receiveID := configString(cfg, "app_id"), configString(cfg, "app_secret"), configString(cfg, "receive_id")
	if appID == "" || appSecret == "" || receiveID == "" {
		return errors.New("飞书应用需要 app_id、app_secret 和 receive_id")
	}
	var tokenResp struct {
		Code              int    `json:"code"`
		Msg               string `json:"msg"`
		TenantAccessToken string `json:"tenant_access_token"`
	}
	if err := postJSONDecode(ctx, s.httpClient, "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", map[string]string{"app_id": appID, "app_secret": appSecret}, nil, &tokenResp); err != nil {
		return err
	}
	if tokenResp.Code != 0 || tokenResp.TenantAccessToken == "" {
		return fmt.Errorf("飞书鉴权失败: %s", tokenResp.Msg)
	}
	receiveType := configString(cfg, "receive_id_type")
	if receiveType == "" {
		receiveType = "email"
	}
	content, _ := json.Marshal(map[string]string{"text": body})
	message := map[string]interface{}{"receive_id": receiveID, "msg_type": "text", "content": string(content)}
	endpoint := "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=" + url.QueryEscape(receiveType)
	var response struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if err := postJSONDecode(ctx, s.httpClient, endpoint, message, map[string]string{"Authorization": "Bearer " + tokenResp.TenantAccessToken}, &response); err != nil {
		return err
	}
	if response.Code != 0 {
		return fmt.Errorf("飞书发送失败: %s", response.Msg)
	}
	return nil
}

func postJSON(ctx context.Context, client *http.Client, target string, value interface{}, headers map[string]string) error {
	// Generic webhooks are allowed to return an empty or non-JSON body; HTTP
	// status is the delivery contract for this channel type.
	return postJSONDecode(ctx, client, target, value, headers, nil)
}
func postJSONDecode(ctx context.Context, client *http.Client, target string, value interface{}, headers map[string]string, output interface{}) error {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, strings.NewReader(string(data)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	responseData, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if readErr != nil {
		return readErr
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("通知服务返回 HTTP %d: %s", resp.StatusCode, limitText(string(responseData), 300))
	}
	if output != nil && len(responseData) > 0 {
		if err := json.Unmarshal(responseData, output); err != nil {
			return fmt.Errorf("通知服务响应格式无效: %w", err)
		}
	}
	return nil
}

func sendSMTP(ctx context.Context, cfg map[string]interface{}, subject, body string) error {
	host := configString(cfg, "host")
	if host == "" {
		return errors.New("邮箱需要 SMTP host")
	}
	port := configInt(cfg, "port", 587)
	from := configString(cfg, "from")
	if from == "" {
		return errors.New("邮箱需要 from")
	}
	to := configStrings(cfg, "to", "recipients")
	if len(to) == 0 {
		return errors.New("邮箱至少需要一个收件人")
	}
	dialer := net.Dialer{Timeout: 10 * time.Second}
	address := net.JoinHostPort(host, strconv.Itoa(port))
	var conn net.Conn
	var err error
	if configBool(cfg, "tls", false) || port == 465 {
		conn, err = tls.DialWithDialer(&dialer, "tcp", address, &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12})
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", address)
	}
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close() }()
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer func() { _ = client.Close() }()
	if port != 465 && configBool(cfg, "starttls", true) {
		ok, _ := client.Extension("STARTTLS")
		if !ok {
			return errors.New("SMTP 服务不支持 STARTTLS")
		}
		if err = client.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}); err != nil {
			return err
		}
	}
	username, password := configString(cfg, "username"), configString(cfg, "password")
	// Most hosted SMTP providers use the sender address as the login name.
	// Keep username optional in the channel form, but never skip AUTH merely
	// because an operator left that duplicate value blank while supplying an
	// SMTP authorization code.
	if username == "" && password != "" {
		username = from
	}
	if username != "" {
		if err = client.Auth(smtp.PlainAuth("", username, password, host)); err != nil {
			if strings.EqualFold(host, "smtp.qq.com") {
				return fmt.Errorf("QQ 邮箱 SMTP 认证失败：请确认用户名为完整邮箱地址、SMTP 服务已开启且密码为最新授权码: %w", err)
			}
			return fmt.Errorf("SMTP 认证失败: %w", err)
		}
	}
	if err = client.Mail(from); err != nil {
		return err
	}
	for _, recipient := range to {
		if err = client.Rcpt(recipient); err != nil {
			return err
		}
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	_, err = io.WriteString(writer, fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n", from, strings.Join(to, ", "), subject, body))
	if closeErr := writer.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return client.Quit()
}

func normalizeNotificationChannel(input NotificationChannelInput) (string, NotificationChannelType, map[string]interface{}, error) {
	name := limitText(input.Name, 120)
	if name == "" {
		return "", "", nil, fmt.Errorf("name is required")
	}
	typ := NotificationChannelType(strings.ToLower(strings.TrimSpace(string(input.Type))))
	webhookProvider := ""
	switch typ {
	case "smtp", "mail":
		typ = NotificationChannelEmail
	case "resend_email":
		typ = NotificationChannelResend
	case "lark", "feishu_app":
		typ = NotificationChannelFeishu
	case "wecom", "wechat_work", "wechatwork", "weixin", "wecom_bot":
		typ, webhookProvider = NotificationChannelWebhook, "wecom"
	case "feishu_bot", "lark_bot":
		typ, webhookProvider = NotificationChannelWebhook, "feishu_bot"
	case "dingtalk", "ding_talk", "dingding", "dingtalk_bot":
		typ, webhookProvider = NotificationChannelWebhook, "dingtalk"
	}
	if typ != NotificationChannelEmail && typ != NotificationChannelResend && typ != NotificationChannelWebhook && typ != NotificationChannelFeishu {
		return "", "", nil, ErrInvalidNotificationChannel
	}
	if input.Config == nil {
		input.Config = map[string]interface{}{}
	}
	cfg := cloneMap(input.Config)
	if webhookProvider != "" {
		cfg["provider"] = webhookProvider
	}
	cfg = stripChannelRecipients(typ, cfg)
	if err := validateNotificationConfig(typ, cfg); err != nil {
		return "", "", nil, err
	}
	return name, typ, cfg, nil
}
func validateNotificationConfig(typ NotificationChannelType, cfg map[string]interface{}) error {
	switch typ {
	case NotificationChannelEmail:
		if configString(cfg, "host") == "" || configString(cfg, "from") == "" {
			return errors.New("邮箱需要 host 和 from，收件人请在具体业务通知中配置")
		}
		port := configInt(cfg, "port", 587)
		if port < 1 || port > 65535 {
			return errors.New("邮箱 SMTP port 无效")
		}
		if strings.EqualFold(configString(cfg, "host"), "smtp.qq.com") {
			username := configString(cfg, "username")
			if username == "" {
				username = configString(cfg, "from")
			}
			if !strings.Contains(username, "@") {
				return errors.New("QQ 邮箱 SMTP 用户名必须填写完整邮箱地址，密码请填写 SMTP 授权码")
			}
			if configString(cfg, "password") == "" {
				return errors.New("QQ 邮箱 SMTP 需要填写 SMTP 授权码")
			}
		}
	case NotificationChannelResend:
		if configString(cfg, "api_key") == "" || configString(cfg, "from") == "" {
			return errors.New("通知渠道 Resend 需要 api_key 和 from，收件人请在具体业务通知中配置")
		}
	case NotificationChannelWebhook:
		target := configString(cfg, "url")
		u, err := url.Parse(target)
		if target == "" || err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return errors.New("通知渠道 Webhook 需要 url")
		}
		provider := normalizeWebhookProvider(configString(cfg, "provider"))
		if provider != "generic" && provider != "wecom" && provider != "feishu_bot" && provider != "dingtalk" {
			return fmt.Errorf("不支持的 Webhook 平台 %q", provider)
		}
	case NotificationChannelFeishu:
		if configString(cfg, "app_id") == "" || configString(cfg, "app_secret") == "" || configString(cfg, "receive_id") == "" {
			return errors.New("飞书应用需要 app_id、app_secret 和 receive_id")
		}
	}
	return nil
}
func normalizeEvent(event string) string {
	event = strings.TrimSpace(event)
	if len(event) > 100 {
		return ""
	}
	return event
}
func uniquePositiveIDs(ids []int) []int {
	seen := map[int]bool{}
	result := make([]int, 0, len(ids))
	for _, id := range ids {
		if id > 0 && !seen[id] {
			seen[id] = true
			result = append(result, id)
		}
	}
	return result
}
func containsInt(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
func normalizeRecipients(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		for _, part := range splitRecipientList(value) {
			part = strings.TrimSpace(part)
			if part != "" && !seen[strings.ToLower(part)] {
				seen[strings.ToLower(part)] = true
				result = append(result, part)
			}
		}
	}
	return result
}

func splitRecipientList(value string) []string {
	return strings.FieldsFunc(value, func(r rune) bool {
		return unicode.IsSpace(r) || r == ',' || r == ';' || r == '，' || r == '；'
	})
}
func validateRecipientEmails(values []string) error {
	for _, value := range values {
		parsed, err := mail.ParseAddress(value)
		if err != nil || parsed.Address != value || !strings.Contains(parsed.Address, "@") {
			return fmt.Errorf("收件人邮箱无效: %s", value)
		}
	}
	return nil
}
func normalizeRecipientMap(values map[int][]string) map[int][]string {
	result := map[int][]string{}
	for id, recipients := range values {
		if id > 0 {
			if normalized := normalizeRecipients(recipients); len(normalized) > 0 {
				result[id] = normalized
			}
		}
	}
	return result
}
func (s *NotificationService) readEventConfig(ctx context.Context, event string) ([]int, map[int][]string, error) {
	meta, err := s.client.SystemMeta.Query().Where(systemmeta.KeyEQ(notificationEventConfigPrefix + event)).Only(ctx)
	if ent.IsNotFound(err) {
		return []int{}, map[int][]string{}, nil
	}
	if err != nil {
		return nil, nil, err
	}
	var ids []int
	if err := json.Unmarshal([]byte(meta.Value), &ids); err == nil {
		return uniquePositiveIDs(ids), map[int][]string{}, nil
	}
	var stored storedNotificationEventConfig
	if err := json.Unmarshal([]byte(meta.Value), &stored); err != nil {
		return nil, nil, fmt.Errorf("通知事件配置格式无效: %w", err)
	}
	recipients := map[int][]string{}
	for key, values := range stored.ChannelRecipients {
		id, parseErr := strconv.Atoi(key)
		if parseErr == nil && id > 0 {
			recipients[id] = normalizeRecipients(values)
		}
	}
	return uniquePositiveIDs(stored.ChannelIDs), recipients, nil
}
func mapNotificationChannel(item *ent.NotificationChannel, mask bool) NotificationChannelView {
	cfg := cloneMap(item.Config)
	cfg = stripChannelRecipients(NotificationChannelType(item.Type), cfg)
	if mask {
		cfg = maskConfig(item.Type, cfg)
	}
	return NotificationChannelView{ID: item.ID, Name: item.Name, Type: NotificationChannelType(item.Type), Config: cfg, Enabled: item.Enabled, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}
func mapNotificationDelivery(item *ent.NotificationDelivery) NotificationDeliveryView {
	return NotificationDeliveryView{ID: item.ID, ChannelID: item.ChannelID, ChannelName: item.ChannelName, ChannelType: item.ChannelType, Event: item.Event, Status: item.Status, Recipient: item.Recipient, Subject: item.Subject, ErrorMessage: item.ErrorMessage, Attempts: item.Attempts, SentAt: item.SentAt, CreatedAt: item.CreatedAt}
}
func maskConfig(typ string, cfg map[string]interface{}) map[string]interface{} {
	for _, key := range []string{"password", "api_key", "app_secret", "secret", "authorization"} {
		if _, ok := cfg[key]; ok {
			cfg[key] = "********"
		}
	}
	return cfg
}
func mergeMaskedSecrets(old, next map[string]interface{}) map[string]interface{} {
	result := cloneMap(old)
	for key, value := range next {
		if text, ok := value.(string); ok && text == "********" {
			continue
		}
		result[key] = value
	}
	return result
}
func cloneMap(value map[string]interface{}) map[string]interface{} {
	result := map[string]interface{}{}
	for key, item := range value {
		result[key] = item
	}
	return result
}
func stripChannelRecipients(typ NotificationChannelType, cfg map[string]interface{}) map[string]interface{} {
	if typ == NotificationChannelEmail || typ == NotificationChannelResend {
		delete(cfg, "to")
		delete(cfg, "recipients")
	}
	return cfg
}
func channelRecipient(cfg map[string]interface{}) string {
	if values := configStrings(cfg, "to", "recipients"); len(values) > 0 {
		return strings.Join(values, ",")
	}
	if target := configString(cfg, "url"); target != "" {
		if parsed, err := url.Parse(target); err == nil {
			parsed.RawQuery = ""
			parsed.Fragment = ""
			return parsed.String()
		}
	}
	return configString(cfg, "receive_id")
}
func deliveryRecipient(cfg map[string]interface{}, recipients []string) string {
	if len(recipients) > 0 {
		return strings.Join(recipients, ",")
	}
	return channelRecipient(cfg)
}
func configString(cfg map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if value, ok := cfg[key]; ok {
			if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
				return strings.TrimSpace(text)
			}
		}
	}
	return ""
}
func configStrings(cfg map[string]interface{}, keys ...string) []string {
	for _, key := range keys {
		value, ok := cfg[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case string:
			result := normalizeRecipients([]string{typed})
			if len(result) > 0 {
				return result
			}
		case []interface{}:
			raw := make([]string, 0, len(typed))
			for _, item := range typed {
				if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
					raw = append(raw, text)
				}
			}
			result := normalizeRecipients(raw)
			if len(result) > 0 {
				return result
			}
		case []string:
			result := normalizeRecipients(typed)
			if len(result) > 0 {
				return result
			}
		}
	}
	return nil
}
func configInt(cfg map[string]interface{}, key string, fallback int) int {
	if value, ok := cfg[key]; ok {
		switch typed := value.(type) {
		case float64:
			return int(typed)
		case int:
			return typed
		case string:
			if n, err := strconv.Atoi(typed); err == nil {
				return n
			}
		}
	}
	return fallback
}
func configBool(cfg map[string]interface{}, key string, fallback bool) bool {
	if value, ok := cfg[key]; ok {
		switch typed := value.(type) {
		case bool:
			return typed
		case string:
			if parsed, err := strconv.ParseBool(typed); err == nil {
				return parsed
			}
		}
	}
	return fallback
}
