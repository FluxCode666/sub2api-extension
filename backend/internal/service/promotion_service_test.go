package service

import (
	"testing"
	"time"

	"aux-system/ent"
	"aux-system/internal/invoice"

	"github.com/stretchr/testify/require"
)

func TestValidatePromotionInput(t *testing.T) {
	valid := PromotionInput{Title: "春季返利", RewardType: PromotionRewardPercentage, RewardValue: 12.5}
	require.NoError(t, validatePromotionInput(valid))
	require.Error(t, validatePromotionInput(PromotionInput{Title: "活动", RewardType: PromotionRewardPercentage, RewardValue: 100.01}))
	require.Error(t, validatePromotionInput(PromotionInput{Title: "活动", RewardType: PromotionRewardFixed, RewardValue: 0}))
	start := time.Now().Add(time.Hour)
	end := start.Add(-time.Minute)
	valid.StartsAt = &start
	valid.EndsAt = &end
	require.Error(t, validatePromotionInput(valid))
}

func TestValidatePromotionInputAllowsZeroAndRejectsNegativeMaxRebateAmount(t *testing.T) {
	valid := PromotionInput{
		Title:           "活动",
		RewardType:      PromotionRewardFixed,
		RewardValue:     10,
		MaxRebateAmount: 0,
	}
	require.NoError(t, validatePromotionInput(valid))

	valid.MaxRebateAmount = -1
	require.Error(t, validatePromotionInput(valid))
}

func TestCalculateRebateRoundsAndSupportsBothRules(t *testing.T) {
	percentage := &ent.Promotion{RewardType: PromotionRewardPercentage, RewardValue: 12.5}
	require.Equal(t, 12.50, calculateRebate(percentage, 100))
	fixed := &ent.Promotion{RewardType: PromotionRewardFixed, RewardValue: 8.888}
	require.Equal(t, 8.89, calculateRebate(fixed, 100))
}

func TestAllocatePromotionRebatesUsesRemainingLimitAndSmallestOrdersFirst(t *testing.T) {
	promotion := &ent.Promotion{RewardType: PromotionRewardPercentage, RewardValue: 10, MaxRebateAmount: 10}
	orders := map[int64]invoice.OrderCandidate{
		1: {PaymentOrderID: 1, Amount: 100},
		2: {PaymentOrderID: 2, Amount: 20},
		3: {PaymentOrderID: 3, Amount: 80},
	}

	allocations := allocatePromotionRebates(promotion, []int64{1, 2, 3}, orders, 0)
	require.Equal(t, []promotionRebateAllocation{
		{PaymentOrderID: 2, Amount: 2},
		{PaymentOrderID: 3, Amount: 8},
	}, allocations)
}

func TestAllocatePromotionRebatesPartiallyFillsLargestOrder(t *testing.T) {
	promotion := &ent.Promotion{RewardType: PromotionRewardFixed, RewardValue: 20, MaxRebateAmount: 10}
	orders := map[int64]invoice.OrderCandidate{1: {PaymentOrderID: 1, Amount: 100}}

	allocations := allocatePromotionRebates(promotion, []int64{1}, orders, 5)
	require.Equal(t, []promotionRebateAllocation{{PaymentOrderID: 1, Amount: 5}}, allocations)
}

func TestPromotionIsActiveHonorsWindowAndPublication(t *testing.T) {
	now := time.Now()
	start := now.Add(-time.Hour)
	end := now.Add(time.Hour)
	item := ent.Promotion{Enabled: true, Published: true, StartsAt: &start, EndsAt: &end}
	require.True(t, promotionIsActive(item, now))
	item.Enabled = false
	require.False(t, promotionIsActive(item, now))
}

func TestPromotionVisibilityIncludesEndedPublishedActivities(t *testing.T) {
	now := time.Date(2026, 9, 12, 12, 0, 0, 0, time.UTC)
	end := now.Add(-time.Minute)
	item := ent.Promotion{Enabled: true, Published: true, EndsAt: &end}

	require.True(t, promotionIsEnded(item, now))
	require.True(t, promotionIsVisible(item, now))
	item.Published = false
	require.False(t, promotionIsVisible(item, now))
}

func TestPromotionVisibilityIncludesActivitiesStartingWithinThreeDays(t *testing.T) {
	now := time.Date(2026, 9, 12, 12, 0, 0, 0, time.UTC)
	start := now.Add(3 * 24 * time.Hour)
	item := ent.Promotion{Enabled: true, Published: true, StartsAt: &start}

	require.True(t, promotionIsUpcoming(item, now))
	require.True(t, promotionIsVisible(item, now))

	tooFar := now.Add(3*24*time.Hour + time.Nanosecond)
	item.StartsAt = &tooFar
	require.False(t, promotionIsUpcoming(item, now))
	require.False(t, promotionIsVisible(item, now))

	item.StartsAt = nil
	require.False(t, promotionIsUpcoming(item, now))
}

func TestPromotionOrderIsEligibleUsesHalfOpenPaymentWindow(t *testing.T) {
	start := time.Date(2026, 9, 12, 10, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	item := ent.Promotion{StartsAt: &start, EndsAt: &end}

	require.True(t, promotionOrderIsEligible(item, start))
	require.True(t, promotionOrderIsEligible(item, start.Add(30*time.Minute)))
	require.False(t, promotionOrderIsEligible(item, start.Add(-time.Nanosecond)))
	require.False(t, promotionOrderIsEligible(item, end))
	require.False(t, promotionOrderIsEligible(item, time.Time{}))
}

func TestPromotionOrderIsEligibleSupportsOpenEndedWindows(t *testing.T) {
	start := time.Date(2026, 9, 12, 10, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)

	require.True(t, promotionOrderIsEligible(ent.Promotion{EndsAt: &end}, start))
	require.True(t, promotionOrderIsEligible(ent.Promotion{StartsAt: &start}, end.Add(time.Hour)))
}
