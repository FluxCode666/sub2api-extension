package service

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"strings"
	"time"

	"aux-system/ent"
	"aux-system/ent/supportticket"
	"aux-system/ent/supportticketmessage"
	"aux-system/ent/systemmeta"
)

type entTicketStore struct {
	client *ent.Client
}

func NewEntTicketStore(client *ent.Client) TicketStore {
	return &entTicketStore{client: client}
}

func (s *entTicketStore) FeatureEnabled(ctx context.Context) (bool, error) {
	if s == nil || s.client == nil {
		return false, errors.New("ticket store is unavailable")
	}
	meta, err := s.client.SystemMeta.Query().Where(systemmeta.KeyEQ(TicketFeatureSettingKey)).Only(ctx)
	if ent.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return strings.EqualFold(strings.TrimSpace(meta.Value), "true"), nil
}

func (s *entTicketStore) SetFeatureEnabled(ctx context.Context, enabled bool) error {
	if s == nil || s.client == nil {
		return errors.New("ticket store is unavailable")
	}
	value := "false"
	if enabled {
		value = "true"
	}
	meta, err := s.client.SystemMeta.Query().Where(systemmeta.KeyEQ(TicketFeatureSettingKey)).Only(ctx)
	if ent.IsNotFound(err) {
		_, err = s.client.SystemMeta.Create().SetKey(TicketFeatureSettingKey).SetValue(value).Save(ctx)
		return err
	}
	if err != nil {
		return err
	}
	return s.client.SystemMeta.UpdateOne(meta).SetValue(value).Exec(ctx)
}

func (s *entTicketStore) Create(ctx context.Context, ticket Ticket, firstMessage TicketMessage) (*Ticket, error) {
	if s == nil || s.client == nil {
		return nil, errors.New("ticket store is unavailable")
	}
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer func() {
		if rollbackErr := tx.Rollback(); rollbackErr != nil && !errors.Is(rollbackErr, sql.ErrTxDone) {
			log.Printf("[TicketStore.Create] transaction rollback failed: %v", rollbackErr)
		}
	}()
	created, err := tx.SupportTicket.Create().
		SetUserID(ticket.UserID).
		SetUserEmail(ticket.UserEmail).
		SetUserName(ticket.UserName).
		SetSubject(ticket.Subject).
		SetStatus(string(TicketStatusOpen)).
		Save(ctx)
	if err != nil {
		return nil, err
	}
	message, err := tx.SupportTicketMessage.Create().
		SetTicketID(created.ID).
		SetSenderType(firstMessage.SenderType).
		SetSenderName(firstMessage.SenderName).
		SetBody(firstMessage.Body).
		Save(ctx)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &Ticket{
		ID: created.ID, UserID: created.UserID, UserEmail: created.UserEmail, UserName: created.UserName,
		Subject: created.Subject, Status: TicketStatus(created.Status),
		Messages:  []TicketMessage{mapSupportTicketMessage(message)},
		CreatedAt: created.CreatedAt, UpdatedAt: created.UpdatedAt,
	}, nil
}

func (s *entTicketStore) ListForUser(ctx context.Context, userID int64, page, pageSize int) (*TicketPage, error) {
	if s == nil || s.client == nil {
		return nil, errors.New("ticket store is unavailable")
	}
	query := s.client.SupportTicket.Query().Where(supportticket.UserIDEQ(userID))
	return s.list(ctx, query, page, pageSize)
}

func (s *entTicketStore) GetForUser(ctx context.Context, userID int64, id int) (*Ticket, error) {
	if s == nil || s.client == nil {
		return nil, errors.New("ticket store is unavailable")
	}
	item, err := s.client.SupportTicket.Query().Where(supportticket.IDEQ(id), supportticket.UserIDEQ(userID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrTicketNotFound
	}
	if err != nil {
		return nil, err
	}
	return s.withMessages(ctx, item)
}

func (s *entTicketStore) AddUserReply(ctx context.Context, userID int64, id int, message TicketMessage) (*Ticket, error) {
	return s.addReply(ctx, userID, id, message, true)
}

func (s *entTicketStore) ListForAdmin(ctx context.Context, filters TicketAdminFilters) (*TicketPage, error) {
	if s == nil || s.client == nil {
		return nil, errors.New("ticket store is unavailable")
	}
	query := s.client.SupportTicket.Query()
	if filters.Status != "" {
		query = query.Where(supportticket.StatusEQ(string(filters.Status)))
	}
	if filters.Keyword != "" {
		query = query.Where(supportticket.Or(
			supportticket.SubjectContainsFold(filters.Keyword),
			supportticket.UserEmailContainsFold(filters.Keyword),
			supportticket.UserNameContainsFold(filters.Keyword),
		))
	}
	return s.list(ctx, query, filters.Page, filters.PageSize)
}

func (s *entTicketStore) GetForAdmin(ctx context.Context, id int) (*Ticket, error) {
	if s == nil || s.client == nil {
		return nil, errors.New("ticket store is unavailable")
	}
	item, err := s.client.SupportTicket.Get(ctx, id)
	if ent.IsNotFound(err) {
		return nil, ErrTicketNotFound
	}
	if err != nil {
		return nil, err
	}
	return s.withMessages(ctx, item)
}

func (s *entTicketStore) AddAdminReply(ctx context.Context, id int, message TicketMessage) (*Ticket, error) {
	return s.addReply(ctx, 0, id, message, false)
}

func (s *entTicketStore) SetStatus(ctx context.Context, id int, status TicketStatus) (*Ticket, error) {
	if s == nil || s.client == nil {
		return nil, errors.New("ticket store is unavailable")
	}
	updated, err := s.client.SupportTicket.Update().
		Where(supportticket.IDEQ(id)).
		SetStatus(string(status)).
		SetUpdatedAt(time.Now()).
		Save(ctx)
	if err != nil {
		return nil, err
	}
	if updated == 0 {
		return nil, ErrTicketNotFound
	}
	return s.GetForAdmin(ctx, id)
}

func (s *entTicketStore) addReply(ctx context.Context, userID int64, id int, message TicketMessage, userReply bool) (*Ticket, error) {
	if s == nil || s.client == nil {
		return nil, errors.New("ticket store is unavailable")
	}
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer func() {
		if rollbackErr := tx.Rollback(); rollbackErr != nil && !errors.Is(rollbackErr, sql.ErrTxDone) {
			log.Printf("[TicketStore.addReply] transaction rollback failed: %v", rollbackErr)
		}
	}()
	query := tx.SupportTicket.Query().Where(supportticket.IDEQ(id))
	if userReply {
		query = query.Where(supportticket.UserIDEQ(userID))
	}
	item, err := query.Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrTicketNotFound
	}
	if err != nil {
		return nil, err
	}
	if userReply && TicketStatus(item.Status) == TicketStatusClosed {
		return nil, ErrTicketClosed
	}
	if _, err := tx.SupportTicketMessage.Create().
		SetTicketID(item.ID).
		SetSenderType(message.SenderType).
		SetSenderName(message.SenderName).
		SetBody(message.Body).
		Save(ctx); err != nil {
		return nil, err
	}
	update := tx.SupportTicket.UpdateOneID(item.ID).SetUpdatedAt(time.Now())
	if !userReply && TicketStatus(item.Status) == TicketStatusOpen {
		update.SetStatus(string(TicketStatusInProgress))
	}
	if _, err := update.Save(ctx); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetForAdmin(ctx, id)
}

func (s *entTicketStore) list(ctx context.Context, query *ent.SupportTicketQuery, page, pageSize int) (*TicketPage, error) {
	total, err := query.Count(ctx)
	if err != nil {
		return nil, err
	}
	items, err := query.Order(ent.Desc(supportticket.FieldUpdatedAt), ent.Desc(supportticket.FieldID)).
		Offset((page - 1) * pageSize).Limit(pageSize).All(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]Ticket, 0, len(items))
	for _, item := range items {
		result = append(result, mapSupportTicket(item))
	}
	return &TicketPage{Items: result, Total: total, Page: page, PageSize: pageSize, TotalPages: (total + pageSize - 1) / pageSize}, nil
}

func (s *entTicketStore) withMessages(ctx context.Context, item *ent.SupportTicket) (*Ticket, error) {
	messages, err := s.client.SupportTicketMessage.Query().
		Where(supportticketmessage.TicketIDEQ(item.ID)).
		Order(ent.Asc(supportticketmessage.FieldCreatedAt), ent.Asc(supportticketmessage.FieldID)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	ticket := mapSupportTicket(item)
	ticket.Messages = make([]TicketMessage, 0, len(messages))
	for _, message := range messages {
		ticket.Messages = append(ticket.Messages, mapSupportTicketMessage(message))
	}
	return &ticket, nil
}

func mapSupportTicket(item *ent.SupportTicket) Ticket {
	return Ticket{
		ID: item.ID, UserID: item.UserID, UserEmail: item.UserEmail, UserName: item.UserName,
		Subject: item.Subject, Status: TicketStatus(item.Status), CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt,
	}
}

func mapSupportTicketMessage(item *ent.SupportTicketMessage) TicketMessage {
	return TicketMessage{
		ID: item.ID, TicketID: item.TicketID, SenderType: item.SenderType,
		SenderName: item.SenderName, Body: item.Body, CreatedAt: item.CreatedAt,
	}
}

var _ TicketStore = (*entTicketStore)(nil)
