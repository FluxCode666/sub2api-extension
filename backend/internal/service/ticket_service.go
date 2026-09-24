package service

import (
	"context"
	"errors"
	"log"
	"strconv"
	"strings"
	"time"
)

const (
	TicketCreatedNotificationEvent = "ticket.created"
	TicketFeatureSettingKey        = "ticket.feature.enabled"
)

type TicketStatus string

const (
	TicketStatusOpen       TicketStatus = "OPEN"
	TicketStatusInProgress TicketStatus = "IN_PROGRESS"
	TicketStatusClosed     TicketStatus = "CLOSED"
)

var (
	ErrTicketNotFound = errors.New("ticket not found")
	ErrTicketClosed   = errors.New("ticket is closed")
	ErrInvalidTicket  = errors.New("invalid ticket")
)

type TicketMessage struct {
	ID         int       `json:"id"`
	TicketID   int       `json:"ticket_id"`
	SenderType string    `json:"sender_type"`
	SenderName string    `json:"sender_name"`
	Body       string    `json:"body"`
	CreatedAt  time.Time `json:"created_at"`
}

type Ticket struct {
	ID        int             `json:"id"`
	UserID    int64           `json:"user_id,omitempty"`
	UserEmail string          `json:"user_email,omitempty"`
	UserName  string          `json:"user_name,omitempty"`
	Subject   string          `json:"subject"`
	Status    TicketStatus    `json:"status"`
	Messages  []TicketMessage `json:"messages,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

type TicketPage struct {
	Items      []Ticket `json:"items"`
	Total      int      `json:"total"`
	Page       int      `json:"page"`
	PageSize   int      `json:"page_size"`
	TotalPages int      `json:"total_pages"`
}

type TicketAdminFilters struct {
	Page     int
	PageSize int
	Keyword  string
	Status   TicketStatus
}

type TicketInput struct {
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

type TicketStore interface {
	Create(context.Context, Ticket, TicketMessage) (*Ticket, error)
	ListForUser(context.Context, int64, int, int) (*TicketPage, error)
	GetForUser(context.Context, int64, int) (*Ticket, error)
	AddUserReply(context.Context, int64, int, TicketMessage) (*Ticket, error)
	ListForAdmin(context.Context, TicketAdminFilters) (*TicketPage, error)
	GetForAdmin(context.Context, int) (*Ticket, error)
	AddAdminReply(context.Context, int, TicketMessage) (*Ticket, error)
	SetStatus(context.Context, int, TicketStatus) (*Ticket, error)
}

type TicketNotifier interface {
	Notify(context.Context, string, string, string, map[string]interface{}) error
}

type TicketService struct {
	store        TicketStore
	notifier     TicketNotifier
	featureStore ticketFeatureStore
}

type ticketFeatureStore interface {
	FeatureEnabled(context.Context) (bool, error)
	SetFeatureEnabled(context.Context, bool) error
}

func NewTicketService(store TicketStore, notifier TicketNotifier) *TicketService {
	featureStore, _ := store.(ticketFeatureStore)
	return &TicketService{store: store, notifier: notifier, featureStore: featureStore}
}

// FeatureEnabled reports whether the ticket portal should be published in the
// Sub2API user menu. Missing configuration is intentionally treated as false.
func (s *TicketService) FeatureEnabled(ctx context.Context) (bool, error) {
	if s == nil || s.featureStore == nil {
		return false, errors.New("ticket feature store is unavailable")
	}
	return s.featureStore.FeatureEnabled(ctx)
}

// SetFeatureEnabled persists whether the ticket portal should be published in
// the Sub2API user menu. Menu synchronization is handled by the admin handler.
func (s *TicketService) SetFeatureEnabled(ctx context.Context, enabled bool) error {
	if s == nil || s.featureStore == nil {
		return errors.New("ticket feature store is unavailable")
	}
	return s.featureStore.SetFeatureEnabled(ctx, enabled)
}

func (s *TicketService) Create(ctx context.Context, userID int64, email, name string, input TicketInput) (*Ticket, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("ticket store is unavailable")
	}
	if userID <= 0 {
		return nil, ErrInvalidTicket
	}
	input.Subject = strings.TrimSpace(input.Subject)
	input.Body = strings.TrimSpace(input.Body)
	if input.Subject == "" || len([]rune(input.Subject)) > 200 || input.Body == "" || len([]rune(input.Body)) > 10000 {
		return nil, ErrInvalidTicket
	}
	if len([]rune(email)) > 255 || len([]rune(name)) > 100 {
		return nil, ErrInvalidTicket
	}
	created, err := s.store.Create(ctx, Ticket{
		UserID: userID, UserEmail: strings.TrimSpace(email), UserName: strings.TrimSpace(name),
		Subject: input.Subject, Status: TicketStatusOpen,
	}, TicketMessage{SenderType: "user", SenderName: strings.TrimSpace(name), Body: input.Body})
	if err != nil {
		return nil, err
	}
	if s.notifier != nil {
		payload := map[string]interface{}{
			"ticket_id": created.ID, "subject": created.Subject,
			"user_id": userID, "user_email": strings.TrimSpace(email), "user_name": strings.TrimSpace(name),
			"message": input.Body,
		}
		if err := s.notifier.Notify(ctx, TicketCreatedNotificationEvent, fmtTicketSubject(created), formatTicketNotification(created, email, name, input.Body), payload); err != nil {
			log.Printf("[TicketService.Create] notification failed ticket_id=%d: %v", created.ID, err)
		}
	}
	return created, nil
}

func (s *TicketService) ListForUser(ctx context.Context, userID int64, page, pageSize int) (*TicketPage, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("ticket store is unavailable")
	}
	if userID <= 0 {
		return nil, ErrInvalidTicket
	}
	page, pageSize = normalizeTicketPaging(page, pageSize)
	return s.store.ListForUser(ctx, userID, page, pageSize)
}

func (s *TicketService) GetForUser(ctx context.Context, userID int64, id int) (*Ticket, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("ticket store is unavailable")
	}
	if userID <= 0 || id <= 0 {
		return nil, ErrTicketNotFound
	}
	return s.store.GetForUser(ctx, userID, id)
}

func (s *TicketService) ReplyAsUser(ctx context.Context, userID int64, userName string, id int, body string) (*Ticket, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("ticket store is unavailable")
	}
	body = strings.TrimSpace(body)
	if userID <= 0 || id <= 0 || body == "" || len([]rune(body)) > 10000 || len([]rune(userName)) > 100 {
		return nil, ErrInvalidTicket
	}
	return s.store.AddUserReply(ctx, userID, id, TicketMessage{SenderType: "user", SenderName: strings.TrimSpace(userName), Body: body})
}

func (s *TicketService) ListForAdmin(ctx context.Context, filters TicketAdminFilters) (*TicketPage, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("ticket store is unavailable")
	}
	if filters.Status != "" && !validTicketStatus(filters.Status) {
		return nil, ErrInvalidTicket
	}
	filters.Page, filters.PageSize = normalizeTicketPaging(filters.Page, filters.PageSize)
	filters.Keyword = strings.TrimSpace(filters.Keyword)
	if len([]rune(filters.Keyword)) > 200 {
		return nil, ErrInvalidTicket
	}
	return s.store.ListForAdmin(ctx, filters)
}

func (s *TicketService) GetForAdmin(ctx context.Context, id int) (*Ticket, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("ticket store is unavailable")
	}
	if id <= 0 {
		return nil, ErrTicketNotFound
	}
	return s.store.GetForAdmin(ctx, id)
}

func (s *TicketService) ReplyAsAdmin(ctx context.Context, id int, body string) (*Ticket, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("ticket store is unavailable")
	}
	body = strings.TrimSpace(body)
	if id <= 0 || body == "" || len([]rune(body)) > 10000 {
		return nil, ErrInvalidTicket
	}
	return s.store.AddAdminReply(ctx, id, TicketMessage{SenderType: "admin", SenderName: "管理员", Body: body})
}

func (s *TicketService) UpdateStatus(ctx context.Context, id int, status TicketStatus) (*Ticket, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("ticket store is unavailable")
	}
	if id <= 0 || !validTicketStatus(status) {
		return nil, ErrInvalidTicket
	}
	return s.store.SetStatus(ctx, id, status)
}

func normalizeTicketPaging(page, pageSize int) (int, int) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}

func validTicketStatus(status TicketStatus) bool {
	switch status {
	case TicketStatusOpen, TicketStatusInProgress, TicketStatusClosed:
		return true
	default:
		return false
	}
}

func fmtTicketSubject(ticket *Ticket) string {
	return "新工单 #" + strconv.Itoa(ticket.ID) + "：" + ticket.Subject
}

func formatTicketNotification(ticket *Ticket, email, name, body string) string {
	return "收到新的用户工单。\n工单编号：#" + strconv.Itoa(ticket.ID) + "\n主题：" + ticket.Subject + "\n用户：" + notificationUserLabel(email, name) + "\n\n" + body
}

func notificationUserLabel(email, name string) string {
	name = strings.TrimSpace(name)
	email = strings.TrimSpace(email)
	if name == "" {
		return email
	}
	if email == "" {
		return name
	}
	return name + "（" + email + "）"
}
