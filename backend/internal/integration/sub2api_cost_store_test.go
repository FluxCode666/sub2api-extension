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
		TotalRevenue:     1000,
		RevenueAvailable: true,
		TotalAPICost:     200,
		TotalOAuthCost:   100,
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
		TotalRevenue:     100,
		RevenueAvailable: true,
		TotalAPICost:     30,
		Days:             []ops.DailyConsumption{{Revenue: 100, TotalCost: 30}},
	}

	applyProfitMetrics(result, ops.CostConfig{TaxRate: 0})

	assert.Zero(t, result.TotalTax)
	assert.InDelta(t, result.Profit, result.NetProfit, 0.000001)
	assert.InDelta(t, result.Days[0].Profit, result.Days[0].NetProfit, 0.000001)
}

func TestApplyProfitMetricsCalculatesAPIOnlyDailyMetrics(t *testing.T) {
	result := &ops.ConsumptionResponse{
		RevenueAvailable: true,
		Days:             []ops.DailyConsumption{{APIRevenue: 400, APICost: 80}},
	}

	applyProfitMetrics(result, ops.CostConfig{TaxRate: 6})

	assert.InDelta(t, 320, result.Days[0].APIGrossProfit, 0.000001)
	assert.InDelta(t, 24, result.Days[0].APITaxAmount, 0.000001)
	assert.InDelta(t, 296, result.Days[0].APINetProfit, 0.000001)
	assert.InDelta(t, 0.74, result.Days[0].APINetMargin, 0.000001)
}

func TestApplyProfitMetricsWithoutRevenueDoesNotInventProfit(t *testing.T) {
	result := &ops.ConsumptionResponse{
		TotalRevenue:   120,
		TotalAPICost:   80,
		TotalOAuthCost: 20,
		GrossProfit:    20,
		TotalTax:       7,
		NetProfit:      13,
		Days:           []ops.DailyConsumption{{Revenue: 120, TotalCost: 100, GrossProfit: 20, APIGrossProfit: 10, APITaxAmount: 2, APINetProfit: 8}},
		Accounts:       []ops.AccountConsumption{{Revenue: 120, GrossProfit: 20, TaxAmount: 7, NetProfit: 13}},
	}

	applyProfitMetrics(result, ops.CostConfig{TaxRate: 6})

	if result.TotalCost != 100 {
		t.Fatalf("expected total cost to remain available without revenue, got %v", result.TotalCost)
	}
	if result.GrossProfit != 0 || result.TotalTax != 0 || result.NetProfit != 0 {
		t.Fatalf("expected aggregate profit metrics to be zero, got %+v", result)
	}
	if result.Days[0].GrossProfit != 0 || result.Days[0].APINetProfit != 0 || result.Accounts[0].NetProfit != 0 {
		t.Fatalf("expected detail profit metrics to be zero, got day=%+v account=%+v", result.Days[0], result.Accounts[0])
	}
}

func TestChargeColumnExpressionUsesSub2APIActualCost(t *testing.T) {
	if expression, source := chargeColumnExpression("u", map[string]bool{"actual_cost": true}); expression == "0" || source != "actual_cost" {
		t.Fatalf("Sub2API actual_cost should be used as user revenue: expression=%q source=%q", expression, source)
	}
	if expression, source := chargeColumnExpression("u", map[string]bool{"actual_cost": true, "billed_amount": true}); source != "actual_cost" || expression == "0" {
		t.Fatalf("canonical actual_cost should take precedence: expression=%q source=%q", expression, source)
	}
	if expression, source := chargeColumnExpression("u", map[string]bool{"total_cost": true, "provider_cost": true}); expression != "0" || source != "" {
		t.Fatalf("provider cost must not become revenue: expression=%q source=%q", expression, source)
	}
	if expression, source := chargeColumnExpression("u", map[string]bool{"billed_amount": true}); expression == "0" || source != "billed_amount" {
		t.Fatalf("explicit charge field should be used: expression=%q source=%q", expression, source)
	}
}

func TestAccountAPICostIgnoresOAuthUsageSnapshots(t *testing.T) {
	if got := accountAPICost("oauth", 12.5, 4, 2); got != 0 {
		t.Fatalf("OAuth API cost = %v, want 0", got)
	}
	if got := accountAPICost("api", 12.5, 4, 2); got != 20.5 {
		t.Fatalf("API cost = %v, want 20.5", got)
	}
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
	firstExpiry := time.Date(2026, 2, 1, 3, 4, 5, 0, time.UTC)
	laterExpiry := time.Date(2026, 3, 1, 3, 4, 5, 0, time.UTC)
	result := &ops.ConsumptionResponse{}
	index := make(map[string]int)
	addAccountBreakdown(result, index, ops.AccountCostConfig{BillingGroup: group, AccountCreatedAt: &created, AccountExpiresAt: &firstExpiry}, 11, "oauth", 100, 20, 2, 0, "purchase cost")
	addAccountBreakdown(result, index, ops.AccountCostConfig{BillingGroup: group, AccountExpiresAt: &laterExpiry}, 12, "oauth", 200, 0, 3, 0, "purchase cost")

	if len(result.Accounts) != 1 {
		t.Fatalf("got %d account rows, want one merged row", len(result.Accounts))
	}
	row := result.Accounts[0]
	if row.AccountID != 11 || len(row.AccountIDs) != 2 || row.Requests != 5 || row.Revenue != 300 || row.OAuthCost != 20 {
		t.Fatalf("merged row = %+v", row)
	}
	if row.AccountExpiresAt == nil || !row.AccountExpiresAt.Equal(firstExpiry) {
		t.Fatalf("merged expiration = %v, want earliest %v", row.AccountExpiresAt, firstExpiry)
	}
}

func TestBillingGroupKeyAllowsMixedAccountTypes(t *testing.T) {
	apiKey := billingGroupKey(ops.AccountCostConfig{BillingGroup: "shared"}, 11, "api")
	oauthKey := billingGroupKey(ops.AccountCostConfig{BillingGroup: "shared"}, 12, "oauth")
	if apiKey != oauthKey {
		t.Fatalf("mixed billing group keys differ: api=%q oauth=%q", apiKey, oauthKey)
	}
}

func TestAddAccountBreakdownKeepsMultipleAPIMultipliers(t *testing.T) {
	result := &ops.ConsumptionResponse{}
	index := make(map[string]int)
	addAccountBreakdown(result, index, ops.AccountCostConfig{BillingGroup: "shared"}, 11, "api", 100, 10, 1, 0.1, "manual")
	addAccountBreakdown(result, index, ops.AccountCostConfig{BillingGroup: "shared"}, 12, "api", 200, 30, 1, 0.2, "Sub2API sync")

	if len(result.Accounts) != 1 {
		t.Fatalf("got %d account rows, want one merged row", len(result.Accounts))
	}
	row := result.Accounts[0]
	if row.AccountType != "api" || row.APICost != 40 || len(row.Multipliers) != 2 || row.MultiplierSource != "multiple" {
		t.Fatalf("merged API row = %+v", row)
	}
}

func TestAddAccountBreakdownMergesAPIAndOAuthCosts(t *testing.T) {
	result := &ops.ConsumptionResponse{}
	index := make(map[string]int)
	addAccountBreakdown(result, index, ops.AccountCostConfig{BillingGroup: "shared"}, 11, "api", 100, 10, 1, 0.1, "manual")
	addAccountBreakdown(result, index, ops.AccountCostConfig{BillingGroup: "shared"}, 12, "oauth", 200, 20, 2, 0, "purchase cost")

	if len(result.Accounts) != 1 {
		t.Fatalf("got %d account rows, want one mixed row", len(result.Accounts))
	}
	row := result.Accounts[0]
	if row.AccountType != "mixed" || len(row.AccountTypes) != 2 || row.APICost != 10 || row.OAuthCost != 20 || row.Requests != 3 || row.Revenue != 300 || row.APIRevenue != 100 || row.OAuthRevenue != 200 {
		t.Fatalf("mixed row = %+v", row)
	}
}
