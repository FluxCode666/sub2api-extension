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

func (s *ticketStoreStub) AddUserReply(_ context.Context, userID int64, _ int, _ TicketMessage) (*Ticket, error) {
	s.userID = userID
	return nil, s.replyErr
}

func (s *ticketStoreStub) ListForAdmin(context.Context, TicketAdminFilters) (*TicketPage, error) {
	return &TicketPage{}, nil
}

func (s *ticketStoreStub) GetForAdmin(context.Context, int) (*Ticket, error) {
	return &Ticket{}, nil
}

func (s *ticketStoreStub) AddAdminReply(context.Context, int, TicketMessage) (*Ticket, error) {
	return &Ticket{}, nil
}

func (s *ticketStoreStub) SetStatus(context.Context, int, TicketStatus) (*Ticket, error) {
	return &Ticket{}, nil
}

type ticketNotifierStub struct {
	event   string
	subject string
	body    string
	payload map[string]interface{}
	err     error
}

func (n *ticketNotifierStub) Notify(_ context.Context, event, subject, body string, payload map[string]interface{}) error {
	n.event, n.subject, n.body, n.payload = event, subject, body, payload
	return n.err
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
