package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"entgo.io/ent/dialect/sql"
	"sub2api-extension/ent"
	"sub2api-extension/ent/promotion"
	"sub2api-extension/ent/promotionclaim"
	"sub2api-extension/ent/systemmeta"
	"sub2api-extension/internal/invoice"
)

const (
	PromotionFeatureSettingKey = "promotion.feature.enabled"
	PromotionRewardFixed       = "FIXED"
	PromotionRewardPercentage  = "PERCENTAGE"
	PromotionClaimGranted      = "GRANTED"
)

var (
	ErrPromotionNotFound           = errors.New("promotion not found")
	ErrPromotionInactive           = errors.New("promotion is inactive")
	ErrPromotionOrderInvalid       = errors.New("one or more selected orders are unavailable")
	ErrPromotionOrderClaimed       = errors.New("one or more selected orders have already been claimed")
	ErrInvalidPromotion            = errors.New("invalid promotion")
	ErrPromotionPublishFailed      = errors.New("promotion publication failed")
	ErrPromotionBalanceUnavailable = errors.New("promotion balance credit is unavailable")
)

type PromotionInput struct {
	Title       string     `json:"title"`
	Description string     `json:"description"`
	RewardType  string     `json:"reward_type"`
	RewardValue float64    `json:"reward_value"`
	StartsAt    *time.Time `json:"starts_at"`
	EndsAt      *time.Time `json:"ends_at"`
	Enabled     *bool      `json:"enabled"`
}

type Promotion struct {
	ID          int             `json:"id"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	RewardType  string          `json:"reward_type"`
	RewardValue float64         `json:"reward_value"`
	StartsAt    *time.Time      `json:"starts_at,omitempty"`
	EndsAt      *time.Time      `json:"ends_at,omitempty"`
	Enabled     bool            `json:"enabled"`
	Published   bool            `json:"published"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
	Stats       *PromotionStats `json:"stats,omitempty"`
}

type PromotionStats struct {
	ParticipantCount int        `json:"participant_count"`
	ClaimCount       int        `json:"claim_count"`
	OrderAmountTotal float64    `json:"order_amount_total"`
	RebateTotal      float64    `json:"rebate_total"`
	LastClaimAt      *time.Time `json:"last_claim_at,omitempty"`
}

type PromotionOrder struct {
	PaymentOrderID int64     `json:"payment_order_id"`
	OutTradeNo     string    `json:"out_trade_no"`
	Amount         float64   `json:"amount"`
	PaidAt         time.Time `json:"paid_at"`
	Claimed        bool      `json:"claimed"`
	RebateAmount   float64   `json:"rebate_amount"`
}

type PromotionClaim struct {
	ID             int       `json:"id"`
	PromotionID    int       `json:"promotion_id"`
	PaymentOrderID int64     `json:"payment_order_id"`
	OutTradeNo     string    `json:"out_trade_no"`
	OrderAmount    float64   `json:"order_amount"`
	RebateAmount   float64   `json:"rebate_amount"`
	Status         string    `json:"status"`
	ClaimedAt      time.Time `json:"claimed_at"`
}

type PromotionClaimInput struct {
	OrderIDs []int64 `json:"order_ids"`
}

// PromotionBalanceCreditor is implemented by the controlled Sub2API database
// integration. It must be idempotent for the same payment order across activities.
type PromotionBalanceCreditor interface {
	CreditPromotionRebate(context.Context, int64, int, int64, float64) error
}

type PromotionService struct {
	client   *ent.Client
	orders   InvoiceOrderSource
	creditor PromotionBalanceCreditor
}

func NewPromotionService(client *ent.Client, orders InvoiceOrderSource, creditors ...PromotionBalanceCreditor) *PromotionService {
	var creditor PromotionBalanceCreditor
	if len(creditors) > 0 {
		creditor = creditors[0]
	}
	return &PromotionService{client: client, orders: orders, creditor: creditor}
}

func (s *PromotionService) FeatureEnabled(ctx context.Context) (bool, error) {
	meta, err := s.client.SystemMeta.Query().Where(systemmeta.KeyEQ(PromotionFeatureSettingKey)).Only(ctx)
	if ent.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return strings.EqualFold(strings.TrimSpace(meta.Value), "true"), nil
}

func (s *PromotionService) SetFeatureEnabled(ctx context.Context, enabled bool) error {
	value := "false"
	if enabled {
		value = "true"
	}
	meta, err := s.client.SystemMeta.Query().Where(systemmeta.KeyEQ(PromotionFeatureSettingKey)).Only(ctx)
	if ent.IsNotFound(err) {
		_, err = s.client.SystemMeta.Create().SetKey(PromotionFeatureSettingKey).SetValue(value).Save(ctx)
		return err
	}
	if err != nil {
		return err
	}
	return s.client.SystemMeta.UpdateOne(meta).SetValue(value).Exec(ctx)
}

func (s *PromotionService) Create(ctx context.Context, input PromotionInput) (*Promotion, error) {
	if err := validatePromotionInput(input); err != nil {
		return nil, err
	}
	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	item, err := s.client.Promotion.Create().SetTitle(strings.TrimSpace(input.Title)).SetDescription(strings.TrimSpace(input.Description)).SetRewardType(strings.ToUpper(strings.TrimSpace(input.RewardType))).SetRewardValue(roundPromotionMoney(input.RewardValue)).SetNillableStartsAt(input.StartsAt).SetNillableEndsAt(input.EndsAt).SetEnabled(enabled).SetPublished(enabled).Save(ctx)
	if err != nil {
		return nil, err
	}
	result := mapPromotion(item)
	return &result, nil
}

func (s *PromotionService) List(ctx context.Context, publicOnly bool) ([]Promotion, error) {
	if publicOnly {
		enabled, err := s.FeatureEnabled(ctx)
		if err != nil || !enabled {
			return []Promotion{}, err
		}
	}
	query := s.client.Promotion.Query().Order(promotion.ByCreatedAt(sql.OrderDesc()))
	if publicOnly {
		query.Where(promotion.EnabledEQ(true), promotion.PublishedEQ(true))
	}
	items, err := query.All(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]Promotion, 0, len(items))
	now := time.Now()
	for _, item := range items {
		if publicOnly && !promotionIsVisible(*item, now) {
			continue
		}
		result = append(result, mapPromotion(item))
	}
	return result, nil
}

func (s *PromotionService) Get(ctx context.Context, id int) (*Promotion, error) {
	item, err := s.client.Promotion.Get(ctx, id)
	if ent.IsNotFound(err) {
		return nil, ErrPromotionNotFound
	}
	if err != nil {
		return nil, err
	}
	result := mapPromotion(item)
	stats, err := s.Stats(ctx, id)
	if err != nil {
		return nil, err
	}
	result.Stats = stats
	return &result, nil
}

func (s *PromotionService) Update(ctx context.Context, id int, input PromotionInput) (*Promotion, error) {
	if err := validatePromotionInput(input); err != nil {
		return nil, err
	}
	item, err := s.client.Promotion.Get(ctx, id)
	if ent.IsNotFound(err) {
		return nil, ErrPromotionNotFound
	}
	if err != nil {
		return nil, err
	}
	update := s.client.Promotion.UpdateOne(item).SetTitle(strings.TrimSpace(input.Title)).SetDescription(strings.TrimSpace(input.Description)).SetRewardType(strings.ToUpper(strings.TrimSpace(input.RewardType))).SetRewardValue(roundPromotionMoney(input.RewardValue)).SetNillableStartsAt(input.StartsAt).SetNillableEndsAt(input.EndsAt)
	if input.Enabled != nil {
		update.SetEnabled(*input.Enabled)
		if !*input.Enabled {
			// 停用活动时同步下架，避免已停用活动继续出现在用户端入口。
			update.SetPublished(false)
		}
	}
	updated, err := update.Save(ctx)
	if err != nil {
		return nil, err
	}
	result := mapPromotion(updated)
	return &result, nil
}

func (s *PromotionService) SetPublished(ctx context.Context, id int, published bool) (*Promotion, error) {
	item, err := s.client.Promotion.Get(ctx, id)
	if ent.IsNotFound(err) {
		return nil, ErrPromotionNotFound
	}
	if err != nil {
		return nil, err
	}
	if published && !item.Enabled {
		return nil, ErrPromotionInactive
	}
	updated, err := s.client.Promotion.UpdateOne(item).SetPublished(published).Save(ctx)
	if err != nil {
		return nil, err
	}
	result := mapPromotion(updated)
	return &result, nil
}

func (s *PromotionService) Delete(ctx context.Context, id int) error {
	count, err := s.client.PromotionClaim.Query().Where(promotionclaim.PromotionIDEQ(id)).Count(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		return errors.New("promotion with claims cannot be deleted")
	}
	if err := s.client.Promotion.DeleteOneID(id).Exec(ctx); ent.IsNotFound(err) {
		return ErrPromotionNotFound
	} else {
		return err
	}
}

func (s *PromotionService) ListPublicOrders(ctx context.Context, userID int64, promotionID int) ([]PromotionOrder, error) {
	p, err := s.activePromotion(ctx, promotionID)
	if err != nil {
		return nil, err
	}
	if s.orders == nil {
		return nil, ErrSub2APIDatabaseUnavailable
	}
	orders, err := s.orders.ListCompletedRecharges(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrSub2APIDatabaseUnavailable, err)
	}
	// 按用户读取全部活动的领取记录。订单的唯一性是全局约束，已在其他活动
	// 领取的订单也要显示为已领取，避免用户在当前活动中重复尝试。
	claims, err := s.client.PromotionClaim.Query().Where(promotionclaim.UserIDEQ(userID)).All(ctx)
	if err != nil {
		return nil, err
	}
	claimed := make(map[int64]PromotionClaim, len(claims))
	for _, c := range claims {
		claimed[c.PaymentOrderID] = mapClaim(c)
	}
	result := make([]PromotionOrder, 0, len(orders))
	for _, order := range orders {
		if !promotionOrderIsEligible(*p, order.PaidAt) {
			continue
		}
		item := PromotionOrder{PaymentOrderID: order.PaymentOrderID, OutTradeNo: order.OutTradeNo, Amount: order.Amount, PaidAt: order.PaidAt}
		if claim, ok := claimed[order.PaymentOrderID]; ok {
			item.Claimed = true
			item.RebateAmount = claim.RebateAmount
		} else {
			item.RebateAmount = calculateRebate(p, order.Amount)
		}
		result = append(result, item)
	}
	return result, nil
}

func (s *PromotionService) Claim(ctx context.Context, userID int64, promotionID int, input PromotionClaimInput) ([]PromotionClaim, error) {
	p, err := s.activePromotion(ctx, promotionID)
	if err != nil {
		return nil, err
	}
	if len(input.OrderIDs) == 0 || len(input.OrderIDs) > 100 {
		return nil, ErrPromotionOrderInvalid
	}
	seenOrderIDs := make(map[int64]struct{}, len(input.OrderIDs))
	for _, id := range input.OrderIDs {
		if id <= 0 {
			return nil, ErrPromotionOrderInvalid
		}
		if _, exists := seenOrderIDs[id]; exists {
			return nil, ErrPromotionOrderInvalid
		}
		seenOrderIDs[id] = struct{}{}
	}
	if s.orders == nil {
		return nil, ErrSub2APIDatabaseUnavailable
	}
	orders, err := s.orders.GetCompletedRecharges(ctx, userID, input.OrderIDs)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrSub2APIDatabaseUnavailable, err)
	}
	byID := make(map[int64]invoice.OrderCandidate, len(orders))
	for _, order := range orders {
		byID[order.PaymentOrderID] = order
	}
	for _, id := range input.OrderIDs {
		order, ok := byID[id]
		if !ok || !promotionOrderIsEligible(*p, order.PaidAt) {
			return nil, ErrPromotionOrderInvalid
		}
	}
	if s.creditor == nil {
		return nil, ErrPromotionBalanceUnavailable
	}
	claims := make([]PromotionClaim, 0, len(input.OrderIDs))
	for _, id := range input.OrderIDs {
		// 订单唯一性跨活动生效，不能只检查当前 promotion_id。
		exists, e := s.client.PromotionClaim.Query().Where(promotionclaim.PaymentOrderIDEQ(id)).Exist(ctx)
		if e != nil {
			return nil, e
		}
		if exists {
			return nil, ErrPromotionOrderClaimed
		}
	}
	for _, id := range input.OrderIDs {
		order := byID[id]
		amount := calculateRebate(p, order.Amount)
		if err := s.creditor.CreditPromotionRebate(ctx, userID, promotionID, order.PaymentOrderID, amount); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrPromotionBalanceUnavailable, err)
		}
	}
	// 外部 Sub2API 余额写入完成后再开启扩展本地事务，避免在本地事务内
	// 持有连接等待另一个数据库。余额写入具备幂等键，失败重试可补齐领取记录。
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	for _, id := range input.OrderIDs {
		order := byID[id]
		amount := calculateRebate(p, order.Amount)
		created, createErr := tx.PromotionClaim.Create().SetPromotionID(promotionID).SetUserID(userID).SetPaymentOrderID(order.PaymentOrderID).SetOutTradeNo(order.OutTradeNo).SetOrderAmount(roundPromotionMoney(order.Amount)).SetRebateAmount(amount).SetStatus(PromotionClaimGranted).Save(ctx)
		if createErr != nil {
			if ent.IsConstraintError(createErr) {
				return nil, ErrPromotionOrderClaimed
			}
			return nil, createErr
		}
		claims = append(claims, mapClaim(created))
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return claims, nil
}

func (s *PromotionService) ListClaims(ctx context.Context, userID int64) ([]PromotionClaim, error) {
	items, err := s.client.PromotionClaim.Query().Where(promotionclaim.UserIDEQ(userID)).Order(promotionclaim.ByClaimedAt(sql.OrderDesc())).All(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]PromotionClaim, 0, len(items))
	for _, item := range items {
		result = append(result, mapClaim(item))
	}
	return result, nil
}

func (s *PromotionService) Stats(ctx context.Context, promotionID int) (*PromotionStats, error) {
	items, err := s.client.PromotionClaim.Query().Where(promotionclaim.PromotionIDEQ(promotionID)).Order(promotionclaim.ByClaimedAt(sql.OrderDesc())).All(ctx)
	if err != nil {
		return nil, err
	}
	users := map[int64]struct{}{}
	stats := &PromotionStats{ClaimCount: len(items)}
	for _, item := range items {
		users[item.UserID] = struct{}{}
		stats.OrderAmountTotal += item.OrderAmount
		stats.RebateTotal += item.RebateAmount
		if stats.LastClaimAt == nil {
			t := item.ClaimedAt
			stats.LastClaimAt = &t
		}
	}
	stats.ParticipantCount = len(users)
	stats.OrderAmountTotal = roundPromotionMoney(stats.OrderAmountTotal)
	stats.RebateTotal = roundPromotionMoney(stats.RebateTotal)
	return stats, nil
}

func (s *PromotionService) activePromotion(ctx context.Context, id int) (*ent.Promotion, error) {
	featureEnabled, err := s.FeatureEnabled(ctx)
	if err != nil {
		return nil, err
	}
	if !featureEnabled {
		return nil, ErrPromotionInactive
	}
	p, err := s.client.Promotion.Get(ctx, id)
	if ent.IsNotFound(err) {
		return nil, ErrPromotionNotFound
	}
	if err != nil {
		return nil, err
	}
	if !promotionIsActive(*p, time.Now()) {
		return nil, ErrPromotionInactive
	}
	return p, nil
}

func promotionIsActive(item ent.Promotion, now time.Time) bool {
	return item.Enabled && item.Published && (item.StartsAt == nil || !now.Before(*item.StartsAt)) && (item.EndsAt == nil || now.Before(*item.EndsAt))
}

func promotionIsEnded(item ent.Promotion, now time.Time) bool {
	return item.Enabled && item.Published && item.EndsAt != nil && !now.Before(*item.EndsAt)
}

func promotionIsVisible(item ent.Promotion, now time.Time) bool {
	return promotionIsActive(item, now) || promotionIsEnded(item, now)
}

// promotionOrderIsEligible 使用与活动本身相同的半开区间：开始时间包含，
// 结束时间不包含。这样活动结束瞬间及之后支付的订单不能参与领取。
func promotionOrderIsEligible(item ent.Promotion, paidAt time.Time) bool {
	if paidAt.IsZero() {
		return false
	}
	if item.StartsAt != nil && paidAt.Before(*item.StartsAt) {
		return false
	}
	if item.EndsAt != nil && !paidAt.Before(*item.EndsAt) {
		return false
	}
	return true
}

func validatePromotionInput(input PromotionInput) error {
	if strings.TrimSpace(input.Title) == "" || len([]rune(input.Title)) > 200 {
		return fmt.Errorf("title is required and must be at most 200 characters")
	}
	input.RewardType = strings.ToUpper(strings.TrimSpace(input.RewardType))
	if input.RewardType != PromotionRewardFixed && input.RewardType != PromotionRewardPercentage {
		return ErrInvalidPromotion
	}
	if math.IsNaN(input.RewardValue) || math.IsInf(input.RewardValue, 0) || input.RewardValue <= 0 || (input.RewardType == PromotionRewardPercentage && input.RewardValue > 100) {
		return ErrInvalidPromotion
	}
	if input.StartsAt != nil && input.EndsAt != nil && !input.StartsAt.Before(*input.EndsAt) {
		return ErrInvalidPromotion
	}
	return nil
}

func calculateRebate(p *ent.Promotion, amount float64) float64 {
	if p.RewardType == PromotionRewardPercentage {
		return roundPromotionMoney(amount * p.RewardValue / 100)
	}
	return roundPromotionMoney(p.RewardValue)
}
func roundPromotionMoney(value float64) float64 { return math.Round(value*100) / 100 }

func mapPromotion(item *ent.Promotion) Promotion {
	return Promotion{ID: item.ID, Title: item.Title, Description: item.Description, RewardType: item.RewardType, RewardValue: item.RewardValue, StartsAt: item.StartsAt, EndsAt: item.EndsAt, Enabled: item.Enabled, Published: item.Published, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}
func mapClaim(item *ent.PromotionClaim) PromotionClaim {
	return PromotionClaim{ID: item.ID, PromotionID: item.PromotionID, PaymentOrderID: item.PaymentOrderID, OutTradeNo: item.OutTradeNo, OrderAmount: item.OrderAmount, RebateAmount: item.RebateAmount, Status: item.Status, ClaimedAt: item.ClaimedAt}
}
