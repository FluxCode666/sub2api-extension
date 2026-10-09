package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type ticketStoreStub struct {
	createdTicket Ticket
	firstMessage  TicketMessage
	createErr     error
	createCalls   int
	userID        int64
	replyErr      error
	updatedTicket Ticket
	replyMessage  TicketMessage
	replyCalls    int
	statusCalls   int
	feature       bool
}

func (s *ticketStoreStub) FeatureEnabled(context.Context) (bool, error) {
	return s.feature, nil
}

func (s *ticketStoreStub) SetFeatureEnabled(_ context.Context, enabled bool) error {
	s.feature = enabled
	return nil
}

func (s *ticketStoreStub) Create(_ context.Context, ticket Ticket, message TicketMessage) (*Ticket, error) {
	s.createCalls++
	s.createdTicket = ticket
	s.firstMessage = message
	if s.createErr != nil {
		return nil, s.createErr
	}
	ticket.ID = 42
	ticket.Messages = []TicketMessage{{TicketID: 42, SenderType: message.SenderType, Body: message.Body}}
	ticket.CreatedAt = time.Now()
	ticket.UpdatedAt = ticket.CreatedAt
	return &ticket, nil
}

func (s *ticketStoreStub) ListForUser(context.Context, int64, int, int) (*TicketPage, error) {
	return &TicketPage{}, nil
}

func (s *ticketStoreStub) GetForUser(context.Context, int64, int) (*Ticket, error) {
	return &Ticket{}, nil
}

func (s *ticketStoreStub) AddUserReply(_ context.Context, userID int64, _ int, message TicketMessage) (*Ticket, error) {
	s.userID = userID
	return s.reply(message)
}

func (s *ticketStoreStub) ListForAdmin(context.Context, TicketAdminFilters) (*TicketPage, error) {
	return &TicketPage{}, nil
}

func (s *ticketStoreStub) GetForAdmin(context.Context, int) (*Ticket, error) {
	ticket := s.updatedTicket
	return &ticket, nil
}

func (s *ticketStoreStub) AddAdminReply(_ context.Context, _ int, message TicketMessage) (*Ticket, error) {
	return s.reply(message)
}

func (s *ticketStoreStub) reply(message TicketMessage) (*Ticket, error) {
	s.replyCalls++
	s.replyMessage = message
	if s.replyErr != nil {
		return nil, s.replyErr
	}
	return &s.updatedTicket, nil
}

func (s *ticketStoreStub) SetStatus(_ context.Context, _ int, status TicketStatus) (*Ticket, error) {
	s.statusCalls++
	if s.replyErr != nil {
		return nil, s.replyErr
	}
	s.updatedTicket.Status = status
	return &s.updatedTicket, nil
}

type ticketNotifierStub struct {
	event   string
	subject string
	body    string
	payload map[string]interface{}
	err     error
	calls   int
}

func (n *ticketNotifierStub) Notify(_ context.Context, event, subject, body string, payload map[string]interface{}) error {
	n.calls++
	n.event, n.subject, n.body, n.payload = event, subject, body, payload
	return n.err
}

func TestTicketServiceNotifiesEveryReplyAfterPersistence(t *testing.T) {
	for _, sender := range []string{"user", "admin"} {
		t.Run(sender, func(t *testing.T) {
			store := &ticketStoreStub{updatedTicket: Ticket{ID: 42, UserID: 17, UserEmail: "owner@example.com", UserName: "Alice", Subject: "登录失败", Status: TicketStatusInProgress}}
			notifier := &ticketNotifierStub{}
			svc := NewTicketService(store, notifier)
			event := TicketAdminRepliedNotificationEvent
			for i := 0; i < 2; i++ {
				var result *Ticket
				var err error
				if sender == "user" {
					event = TicketUserRepliedNotificationEvent
					result, err = svc.ReplyAsUser(context.Background(), 17, "Alice", 42, "  请查看最新进展  ")
				} else {
					result, err = svc.ReplyAsAdmin(context.Background(), 42, "  请查看最新进展  ")
				}
				require.NoError(t, err)
				require.Equal(t, 42, result.ID)
				require.Equal(t, i+1, store.replyCalls)
				require.Equal(t, i+1, notifier.calls)
				require.Equal(t, event, notifier.event)
				require.Equal(t, event, notifier.payload["event"])
				require.Equal(t, "owner@example.com", notifier.payload["user_email"])
				require.Equal(t, "请查看最新进展", notifier.payload["message"])
				require.Equal(t, sender, store.replyMessage.SenderType)
				require.Contains(t, notifier.body, "请查看最新进展")
				require.Contains(t, notifier.subject, "#42")
			}
		})
	}
}

func TestTicketServiceFailedRepliesDoNotNotify(t *testing.T) {
	for _, sender := range []string{"user", "admin"} {
		for _, storeErr := range []error{ErrTicketNotFound, ErrTicketClosed, errors.New("database unavailable")} {
			t.Run(sender+"/"+storeErr.Error(), func(t *testing.T) {
				store := &ticketStoreStub{replyErr: storeErr}
				notifier := &ticketNotifierStub{}
				svc := NewTicketService(store, notifier)
				var err error
				if sender == "user" {
					_, err = svc.ReplyAsUser(context.Background(), 17, "Alice", 42, "回复")
				} else {
					_, err = svc.ReplyAsAdmin(context.Background(), 42, "回复")
				}
				require.ErrorIs(t, err, storeErr)
				require.Zero(t, notifier.calls)
			})
		}
	}
}

func TestTicketServiceReplySurvivesNotificationFailure(t *testing.T) {
	store := &ticketStoreStub{updatedTicket: Ticket{ID: 42}}
	notifier := &ticketNotifierStub{err: errors.New("notification unavailable")}
	svc := NewTicketService(store, notifier)
	userReply, err := svc.ReplyAsUser(context.Background(), 17, "Alice", 42, "回复")
	require.NoError(t, err)
	require.Equal(t, 42, userReply.ID)
	adminReply, err := svc.ReplyAsAdmin(context.Background(), 42, "回复")
	require.NoError(t, err)
	require.Equal(t, 42, adminReply.ID)
	require.Equal(t, 2, notifier.calls)
}

func TestTicketServiceStatusChangesNotifyOnce(t *testing.T) {
	store := &ticketStoreStub{updatedTicket: Ticket{ID: 42, UserEmail: "owner@example.com", Status: TicketStatusOpen}}
	notifier := &ticketNotifierStub{err: errors.New("notification unavailable")}
	svc := NewTicketService(store, notifier)
	for _, status := range []TicketStatus{TicketStatusInProgress, TicketStatusClosed, TicketStatusOpen} {
		updated, err := svc.UpdateStatus(context.Background(), 42, status)
		require.NoError(t, err)
		require.Equal(t, status, updated.Status)
		require.Equal(t, TicketStatusUpdatedNotificationEvent, notifier.event)
		require.Equal(t, status, notifier.payload["status"])
		require.Contains(t, notifier.body, ticketStatusLabel(status))
		calls := notifier.calls
		_, err = svc.UpdateStatus(context.Background(), 42, status)
		require.NoError(t, err)
		require.Equal(t, calls, notifier.calls)
	}
	require.Equal(t, 3, store.statusCalls)
	require.Equal(t, 3, notifier.calls)
}

func TestTicketServiceFailedStatusChangeDoesNotNotify(t *testing.T) {
	store := &ticketStoreStub{updatedTicket: Ticket{ID: 42, Status: TicketStatusOpen}, replyErr: ErrTicketNotFound}
	notifier := &ticketNotifierStub{}
	_, err := NewTicketService(store, notifier).UpdateStatus(context.Background(), 42, TicketStatusClosed)
	require.ErrorIs(t, err, ErrTicketNotFound)
	require.Zero(t, notifier.calls)
}

func TestTicketServiceCreatePersistsOwnerAndNotifies(t *testing.T) {
	store := &ticketStoreStub{}
	notifier := &ticketNotifierStub{}
	service := NewTicketService(store, notifier)

	created, err := service.Create(context.Background(), 17, "user@example.com", "Alice", TicketInput{
		Subject: "  登录失败  ", Body: "  无法进入控制台  ",
	})

	require.NoError(t, err)
	require.Equal(t, int64(17), store.createdTicket.UserID)
	require.Equal(t, "登录失败", store.createdTicket.Subject)
	require.Equal(t, "user", store.firstMessage.SenderType)
	require.Equal(t, "无法进入控制台", store.firstMessage.Body)
	require.Equal(t, 42, created.ID)
	require.Equal(t, TicketCreatedNotificationEvent, notifier.event)
	require.Contains(t, notifier.subject, "#42")
	require.Equal(t, "user@example.com", notifier.payload["user_email"])
}

func TestTicketServiceCreateKeepsTicketWhenNotificationFails(t *testing.T) {
	store := &ticketStoreStub{}
	notifier := &ticketNotifierStub{err: errors.New("notification unavailable")}
	service := NewTicketService(store, notifier)

	created, err := service.Create(context.Background(), 17, "", "", TicketInput{Subject: "帮助", Body: "需要协助"})

	require.NoError(t, err)
	require.Equal(t, 42, created.ID)
	require.Equal(t, 1, store.createCalls)
}

func TestTicketServiceRejectsInvalidInputAndStatus(t *testing.T) {
	store := &ticketStoreStub{}
	service := NewTicketService(store, nil)

	_, err := service.Create(context.Background(), 1, "", "", TicketInput{Subject: "", Body: "body"})
	require.ErrorIs(t, err, ErrInvalidTicket)
	require.Zero(t, store.createCalls)

	_, err = service.UpdateStatus(context.Background(), 42, "UNKNOWN")
	require.ErrorIs(t, err, ErrInvalidTicket)
}

func TestTicketServicePassesAuthenticatedOwnerToReplyStore(t *testing.T) {
	store := &ticketStoreStub{}
	store.replyErr = ErrTicketClosed
	service := NewTicketService(store, nil)

	_, err := service.ReplyAsUser(context.Background(), 29, "Alice", 42, "请继续处理")

	require.ErrorIs(t, err, ErrTicketClosed)
	require.Equal(t, int64(29), store.userID)
}

func TestTicketServicePersistsPublicationSettingThroughStore(t *testing.T) {
	store := &ticketStoreStub{}
	svc := NewTicketService(store, nil)

	enabled, err := svc.FeatureEnabled(context.Background())
	require.NoError(t, err)
	require.False(t, enabled)

	require.NoError(t, svc.SetFeatureEnabled(context.Background(), true))
	enabled, err = svc.FeatureEnabled(context.Background())
	require.NoError(t, err)
	require.True(t, enabled)
}

var _ TicketStore = (*ticketStoreStub)(nil)
