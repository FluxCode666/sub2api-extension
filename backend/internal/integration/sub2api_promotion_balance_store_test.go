package integration

import (
	"context"
	"errors"
	"testing"

	"sub2api-extension/internal/ttft"

	"github.com/stretchr/testify/require"
)

func TestPromotionBalanceAuditKeyIsGlobalPerOrder(t *testing.T) {
	orderID, action := promotionBalanceAuditKey(12, 345)
	require.Equal(t, "345", orderID)
	require.Equal(t, "AUX_PROMOTION_REBATE", action)
	otherOrder, otherAction := promotionBalanceAuditKey(12, 346)
	require.NotEqual(t, orderID, otherOrder)
	require.Equal(t, action, otherAction)
	otherPromotionOrder, otherPromotionAction := promotionBalanceAuditKey(13, 345)
	require.Equal(t, orderID, otherPromotionOrder)
	require.Equal(t, action, otherPromotionAction)
}

func TestSub2APIPromotionBalanceStoreRequiresDatabase(t *testing.T) {
	store := NewSub2APIPromotionBalanceStore(nil)
	err := store.CreditPromotionRebate(context.Background(), 1, 2, 3, 4)
	require.Error(t, err)
	require.True(t, errors.Is(err, ttft.ErrSub2APIDatabaseUnavailable))
}
