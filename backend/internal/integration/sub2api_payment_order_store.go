package integration

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"

	"sub2api-extension/internal/invoice"
	"sub2api-extension/internal/ttft"
)

// Sub2APIPaymentOrderStore is a read-only adapter for completed balance
// recharge orders.  The extension never writes to Sub2API payment data.
type Sub2APIPaymentOrderStore struct{ db *sql.DB }

// SearchUsersByEmail returns the small user projection needed by the admin
// invoice filter. It is deliberately read-only and never exposes credentials.
func (s *Sub2APIPaymentOrderStore) SearchUsersByEmail(ctx context.Context, email string, limit int) ([]invoice.UserCandidate, error) {
	if s == nil || s.db == nil {
		return nil, ttft.ErrSub2APIDatabaseUnavailable
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	if strings.TrimSpace(email) == "" {
		return []invoice.UserCandidate{}, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, COALESCE(email, ''), COALESCE(username, '')
		FROM users
		WHERE email ILIKE $1 ESCAPE '\'
		ORDER BY email ASC, id ASC
		LIMIT $2`, "%"+escapeLike(strings.TrimSpace(email))+"%", limit)
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			log.Printf("[Sub2APIPaymentOrderStore.SearchUsersByEmail] failed to close rows: %v", closeErr)
		}
	}()
	items := make([]invoice.UserCandidate, 0)
	for rows.Next() {
		var item invoice.UserCandidate
		if err := rows.Scan(&item.ID, &item.Email, &item.Username); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// GetUserByID returns the minimal identity projection needed when an admin
// creates an offline invoice record. Credentials and other user columns are
// deliberately excluded from the query.
func (s *Sub2APIPaymentOrderStore) GetUserByID(ctx context.Context, userID int64) (invoice.UserCandidate, error) {
	if s == nil || s.db == nil {
		return invoice.UserCandidate{}, ttft.ErrSub2APIDatabaseUnavailable
	}
	if userID <= 0 {
		return invoice.UserCandidate{}, sql.ErrNoRows
	}
	var item invoice.UserCandidate
	err := s.db.QueryRowContext(ctx, `
		SELECT id, COALESCE(email, ''), COALESCE(username, '')
		FROM users
		WHERE id = $1`, userID).Scan(&item.ID, &item.Email, &item.Username)
	return item, err
}

func escapeLike(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, "%", `\%`)
	return strings.ReplaceAll(value, "_", `\_`)
}

func NewSub2APIPaymentOrderStore(db *sql.DB) *Sub2APIPaymentOrderStore {
	return &Sub2APIPaymentOrderStore{db: db}
}

func (s *Sub2APIPaymentOrderStore) ListCompletedRecharges(ctx context.Context, userID int64) ([]invoice.OrderCandidate, error) {
	if s == nil || s.db == nil {
		return nil, ttft.ErrSub2APIDatabaseUnavailable
	}
	return s.query(ctx, `
		SELECT id, COALESCE(out_trade_no, ''), amount, paid_at
		FROM payment_orders
		WHERE user_id = $1
		  AND order_type = 'balance'
		  AND status = 'COMPLETED'
		  AND paid_at IS NOT NULL
		  AND amount > 0
		  AND COALESCE(refund_amount, 0) = 0
		ORDER BY paid_at DESC, id DESC
		LIMIT 200`, userID)
}

func (s *Sub2APIPaymentOrderStore) GetCompletedRecharges(ctx context.Context, userID int64, ids []int64) ([]invoice.OrderCandidate, error) {
	if s == nil || s.db == nil {
		return nil, ttft.ErrSub2APIDatabaseUnavailable
	}
	if len(ids) == 0 {
		return []invoice.OrderCandidate{}, nil
	}
	args := make([]any, 0, len(ids)+1)
	args = append(args, userID)
	placeholders := make([]string, 0, len(ids))
	for i, id := range ids {
		placeholders = append(placeholders, fmt.Sprintf("$%d", i+2))
		args = append(args, id)
	}
	statement := `
		SELECT id, COALESCE(out_trade_no, ''), amount, paid_at
		FROM payment_orders
		WHERE user_id = $1
		  AND order_type = 'balance'
		  AND status = 'COMPLETED'
		  AND paid_at IS NOT NULL
		  AND amount > 0
		  AND COALESCE(refund_amount, 0) = 0
		  AND id IN (` + strings.Join(placeholders, ",") + `)`
	return s.query(ctx, statement, args...)
}

func (s *Sub2APIPaymentOrderStore) query(ctx context.Context, statement string, args ...any) ([]invoice.OrderCandidate, error) {
	rows, err := s.db.QueryContext(ctx, statement, args...)
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			log.Printf("[Sub2APIPaymentOrderStore] failed to close rows: %v", closeErr)
		}
	}()
	items := make([]invoice.OrderCandidate, 0)
	for rows.Next() {
		var item invoice.OrderCandidate
		var paidAt time.Time
		if err := rows.Scan(&item.PaymentOrderID, &item.OutTradeNo, &item.Amount, &paidAt); err != nil {
			return nil, err
		}
		item.PaidAt = paidAt.UTC()
		items = append(items, item)
	}
	return items, rows.Err()
}
