package ops

import "testing"

func TestAccountCostConfigEffectiveMultiplier(t *testing.T) {
	synced := 0.09
	manual := 0.5
	account := AccountCostConfig{SyncedAPIMultiplier: &synced}
	if got := account.EffectiveAPIMultiplier(1); got != 0.09 {
		t.Fatalf("synced multiplier = %v, want 0.09", got)
	}
	account.APIMultiplierOverride = &manual
	if got := account.EffectiveAPIMultiplier(1); got != 0.5 {
		t.Fatalf("manual multiplier = %v, want 0.5", got)
	}
}

func TestAccountCostConfigEffectiveOAuthCost(t *testing.T) {
	cost := 12.5
	account := AccountCostConfig{OAuthAccountCost: &cost}
	if got := account.EffectiveOAuthCost(2); got != 12.5 {
		t.Fatalf("account OAuth cost = %v, want 12.5", got)
	}
	if got := (AccountCostConfig{}).EffectiveOAuthCost(2); got != 2 {
		t.Fatalf("fallback OAuth cost = %v, want 2", got)
	}
}
