package integration

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"time"

	"github.com/redis/go-redis/v9"
	"sub2api-extension/internal/ttft"
)

// Sub2APIPromotionBalanceStore 在 Sub2API 数据库中原子发放促销返利。
//
// 返利不是 payment_orders 的一部分，不能伪造充值订单；这里复用 Sub2API
// 已有的 users.balance 累加语义，并在 payment_audit_logs 写入独立幂等键。
type Sub2APIPromotionBalanceStore struct {
	db    *sql.DB
	redis *redis.Client
}

func NewSub2APIPromotionBalanceStore(db *sql.DB, redisClients ...*redis.Client) *Sub2APIPromotionBalanceStore {
	var redisClient *redis.Client
	if len(redisClients) > 0 {
		redisClient = redisClients[0]
	}
	return &Sub2APIPromotionBalanceStore{db: db, redis: redisClient}
}

// CreditPromotionRebate 将金额记入用户余额。同一活动和订单重复调用时不会重复入账。
func (s *Sub2APIPromotionBalanceStore) CreditPromotionRebate(ctx context.Context, userID int64, promotionID int, paymentOrderID int64, amount float64) error {
	if s == nil || s.db == nil {
		return ttft.ErrSub2APIDatabaseUnavailable
	}
	if userID <= 0 || promotionID <= 0 || paymentOrderID <= 0 || amount <= 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		return errors.New("invalid promotion balance credit")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin promotion balance transaction: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	auditOrderID, auditAction := promotionBalanceAuditKey(promotionID, paymentOrderID)
	// payment_audit_logs 的历史版本不一定有唯一索引。事务级 advisory lock
	// 仍能把同一订单的并发重试串行化，不需要改动 Sub2API 表结构。
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, auditOrderID+":"+auditAction); err != nil {
		return fmt.Errorf("lock promotion balance idempotency key: %w", err)
	}
	var existingDetail string
	err = tx.QueryRowContext(ctx, `
		SELECT detail
		FROM payment_audit_logs
		WHERE order_id = $1 AND action LIKE 'AUX_PROMOTION_REBATE%'
		LIMIT 1
	`, auditOrderID).Scan(&existingDetail)
	if err == nil {
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit existing promotion balance credit: %w", err)
		}
		committed = true
		s.invalidateBalanceCache(userID)
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("check promotion balance idempotency key: %w", err)
	}

	result, err := tx.ExecContext(ctx, `
		UPDATE users
		SET balance = balance + $1,
		    total_recharged = COALESCE(total_recharged, 0) + $1,
		    updated_at = NOW()
		WHERE id = $2 AND deleted_at IS NULL
	`, amount, userID)
	if err != nil {
		return fmt.Errorf("credit sub2api user balance: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read credited user count: %w", err)
	}
	if affected == 0 {
		return errors.New("sub2api user not found or deleted")
	}

	detail, err := json.Marshal(map[string]any{
		"source":           "sub2api-extension",
		"promotion_id":     promotionID,
		"payment_order_id": paymentOrderID,
		"user_id":          userID,
		"rebate_amount":    amount,
	})
	if err != nil {
		return fmt.Errorf("encode promotion balance audit: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO payment_audit_logs (order_id, action, detail, operator, created_at)
		VALUES ($1, $2, $3, 'sub2api-extension', NOW())
	`, auditOrderID, auditAction, string(detail)); err != nil {
		return fmt.Errorf("write promotion balance audit: %w", err)
	}
	if err := enqueuePromotionAuthCacheInvalidation(ctx, tx, userID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit promotion balance credit: %w", err)
	}
	committed = true
	s.invalidateBalanceCache(userID)
	return nil
}

// enqueuePromotionAuthCacheInvalidation 复用 Sub2API 已有的认证缓存失效队列。
// 旧版本未安装该迁移时跳过，余额数据库写入仍保持兼容。
func enqueuePromotionAuthCacheInvalidation(ctx context.Context, tx *sql.Tx, userID int64) error {
	var available bool
	if err := tx.QueryRowContext(ctx, `
		SELECT to_regclass('auth_cache_invalidation_outbox') IS NOT NULL
		   AND to_regprocedure('enqueue_auth_cache_invalidation(text)') IS NOT NULL
	`).Scan(&available); err != nil {
		return fmt.Errorf("check sub2api auth cache invalidation support: %w", err)
	}
	if !available {
		return nil
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT enqueue_auth_cache_invalidation(k.key)
		FROM api_keys AS k
		WHERE k.user_id = $1 AND k.deleted_at IS NULL AND k.key <> ''
	`, userID)
	if err != nil {
		return fmt.Errorf("enqueue sub2api auth cache invalidation: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close sub2api auth cache invalidation rows: %w", err)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("enqueue sub2api auth cache invalidation: %w", err)
	}
	return nil
}

func (s *Sub2APIPromotionBalanceStore) invalidateBalanceCache(userID int64) {
	if s == nil || s.redis == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := s.redis.Del(ctx, fmt.Sprintf("billing:balance:%d", userID)).Err(); err != nil {
		log.Printf("[promotion] failed to invalidate sub2api balance cache user_id=%d: %v", userID, err)
	}
}

func promotionBalanceAuditKey(promotionID int, paymentOrderID int64) (string, string) {
	// 订单只能参与一场活动，因此外部入账也必须按订单全局幂等。
	// promotionID 保留在审计 detail 中，参数继续保留以兼容调用方。
	return fmt.Sprintf("%d", paymentOrderID), "AUX_PROMOTION_REBATE"
}
