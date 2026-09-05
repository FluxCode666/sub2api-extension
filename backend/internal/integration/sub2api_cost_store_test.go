package integration

import (
	"strings"
	"testing"
	"time"

	"sub2api-extension/internal/ops"

	"github.com/stretchr/testify/assert"
)

func TestNumericColumnExpressionUsesFirstAvailableColumn(t *testing.T) {
	columns := map[string]bool{"actual_cost": true, "total_cost": true}
	got := numericColumnExpression("u", columns, []string{"charged_amount", "actual_cost", "total_cost"})
	if !strings.Contains(got, `u."actual_cost"`) {
		t.Fatalf("expression = %q, want actual_cost", got)
	}
	if strings.Contains(got, `u."total_cost"`) {
		t.Fatalf("expression = %q, should not use a later candidate", got)
	}
}

func TestSumNumericColumnsIncludesKnownTokenBreakdown(t *testing.T) {
	columns := map[string]bool{
		"input_tokens":          true,
		"output_tokens":         true,
		"cache_creation_tokens": true,
		"cache_read_tokens":     true,
	}
	got := sumNumericColumns("u", columns, []string{
		"input_tokens",
		"prompt_tokens",
		"output_tokens",
		"completion_tokens",
		"cache_creation_tokens",
		"cache_read_tokens",
	})
	for _, name := range []string{"input_tokens", "output_tokens", "cache_creation_tokens", "cache_read_tokens"} {
		if !strings.Contains(got, `u."`+name+`"`) {
			t.Errorf("expression = %q, missing %s", got, name)
		}
	}
}

func TestAccountKindExpressionDetectsOAuthType(t *testing.T) {
	got := accountKindExpression(map[string]bool{"type": true, "platform": true}, true)
	if !strings.Contains(got, "LIKE '%oauth%'") {
		t.Fatalf("expression = %q, want oauth classification", got)
	}
}

func TestApplyProfitMetricsWithTax(t *testing.T) {
	result := &ops.ConsumptionResponse{
		TotalRevenue:   1000,
		TotalAPICost:   200,
		TotalOAuthCost: 100,
		Days: []ops.DailyConsumption{
			{Revenue: 400, APICost: 80, OAuthCost: 40, TotalCost: 120},
			{Revenue: 600, APICost: 120, OAuthCost: 60, TotalCost: 180},
		},
		Accounts: []ops.AccountConsumption{
			{Revenue: 400, APICost: 80, OAuthCost: 40},
		},
	}

	applyProfitMetrics(result, ops.CostConfig{TaxRate: 6})

	assert.InDelta(t, 300, result.TotalCost, 0.000001)
	assert.InDelta(t, 700, result.GrossProfit, 0.000001)
	assert.InDelta(t, 700, result.Profit, 0.000001)
	assert.InDelta(t, 60, result.TotalTax, 0.000001)
	assert.InDelta(t, 640, result.NetProfit, 0.000001)
	assert.InDelta(t, 0.64, result.NetMargin, 0.000001)

	assert.InDelta(t, 280, result.Days[0].Profit, 0.000001)
	assert.InDelta(t, 24, result.Days[0].TaxAmount, 0.000001)
	assert.InDelta(t, 256, result.Days[0].NetProfit, 0.000001)
	assert.InDelta(t, 0.64, result.Days[0].NetMargin, 0.000001)

	assert.InDelta(t, 280, result.Accounts[0].GrossProfit, 0.000001)
	assert.InDelta(t, 24, result.Accounts[0].TaxAmount, 0.000001)
	assert.InDelta(t, 256, result.Accounts[0].NetProfit, 0.000001)
}

func TestApplyProfitMetricsWithZeroTax(t *testing.T) {
	result := &ops.ConsumptionResponse{
		TotalRevenue: 100,
		TotalAPICost: 30,
		Days:         []ops.DailyConsumption{{Revenue: 100, TotalCost: 30}},
	}

	applyProfitMetrics(result, ops.CostConfig{TaxRate: 0})

	assert.Zero(t, result.TotalTax)
	assert.InDelta(t, result.Profit, result.NetProfit, 0.000001)
	assert.InDelta(t, result.Days[0].Profit, result.Days[0].NetProfit, 0.000001)
}

func TestBillingGroupKeyKeepsUnmergedAccountsSeparate(t *testing.T) {
	first := billingGroupKey(ops.AccountCostConfig{}, 11, "oauth")
	second := billingGroupKey(ops.AccountCostConfig{}, 12, "oauth")
	if first == second {
		t.Fatalf("unmerged accounts share billing key %q", first)
	}
}

func TestAddAccountBreakdownMergesBillingGroup(t *testing.T) {
	group := "same-oauth"
	created := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	result := &ops.ConsumptionResponse{}
	index := make(map[string]int)
	addAccountBreakdown(result, index, ops.AccountCostConfig{BillingGroup: group, AccountCreatedAt: &created}, 11, "oauth", 100, 20, 2, 0, "purchase cost")
	addAccountBreakdown(result, index, ops.AccountCostConfig{BillingGroup: group}, 12, "oauth", 200, 0, 3, 0, "purchase cost")

	if len(result.Accounts) != 1 {
		t.Fatalf("got %d account rows, want one merged row", len(result.Accounts))
	}
	row := result.Accounts[0]
	if row.AccountID != 11 || len(row.AccountIDs) != 2 || row.Requests != 5 || row.Revenue != 300 || row.OAuthCost != 20 {
		t.Fatalf("merged row = %+v", row)
	}
}
