package service

import (
	"testing"
	"time"

	"sub2api-extension/ent"

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

func TestCalculateRebateRoundsAndSupportsBothRules(t *testing.T) {
	percentage := &ent.Promotion{RewardType: PromotionRewardPercentage, RewardValue: 12.5}
	require.Equal(t, 12.50, calculateRebate(percentage, 100))
	fixed := &ent.Promotion{RewardType: PromotionRewardFixed, RewardValue: 8.888}
	require.Equal(t, 8.89, calculateRebate(fixed, 100))
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
