// Package invoice holds dependency-neutral invoice value types shared by the
// service layer and Sub2API database adapters.
package invoice

import "time"

type OrderCandidate struct {
	PaymentOrderID int64     `json:"payment_order_id"`
	OutTradeNo     string    `json:"out_trade_no"`
	Amount         float64   `json:"amount"`
	PaidAt         time.Time `json:"paid_at"`
}

// UserCandidate is the minimal Sub2API user projection used by admin search.
type UserCandidate struct {
	ID       int64  `json:"id"`
	Email    string `json:"email"`
	Username string `json:"username,omitempty"`
}
