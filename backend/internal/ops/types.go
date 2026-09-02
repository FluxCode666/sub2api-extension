package ops

import "time"

// CostConfig controls the two cost models used by the operations dashboard.
// OAuth accounts are treated as purchased units; API accounts use the raw
// provider charge multiplied by APICostMultiplier.
type CostConfig struct {
	OAuthAccountCost  float64 `json:"oauth_account_cost"`
	APICostMultiplier float64 `json:"api_cost_multiplier"`
	TaxRate           float64 `json:"tax_rate"`
	Currency          string  `json:"currency"`
}

// Sub2APIAccount is the read-only account metadata needed by the extension.
// It is populated from Sub2API's accounts table during periodic sync.
type Sub2APIAccount struct {
	ID             int64     `json:"id"`
	Name           string    `json:"name"`
	Type           string    `json:"type"`
	Platform       string    `json:"platform"`
	RateMultiplier float64   `json:"rate_multiplier"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// AccountCostConfig is the extension-owned per-account cost policy. A nil
// OAuth cost or API override means "use the global/default policy".
type AccountCostConfig struct {
	AccountID             int64      `json:"account_id"`
	AccountType           string     `json:"account_type"`
	Name                  string     `json:"name"`
	Platform              string     `json:"platform"`
	OAuthAccountCost      *float64   `json:"oauth_account_cost,omitempty"`
	APIMultiplierOverride *float64   `json:"api_multiplier_override,omitempty"`
	SyncedAPIMultiplier   *float64   `json:"synced_api_multiplier,omitempty"`
	APIMultiplierMode     string     `json:"api_multiplier_mode"`
	LastSyncedAt          *time.Time `json:"last_synced_at,omitempty"`
}

func (c AccountCostConfig) EffectiveAPIMultiplier(fallback float64) float64 {
	if c.APIMultiplierOverride != nil && *c.APIMultiplierOverride > 0 {
		return *c.APIMultiplierOverride
	}
	if c.SyncedAPIMultiplier != nil && *c.SyncedAPIMultiplier > 0 {
		return *c.SyncedAPIMultiplier
	}
	if fallback > 0 {
		return fallback
	}
	return 1
}

func (c AccountCostConfig) EffectiveOAuthCost(fallback float64) float64 {
	if c.OAuthAccountCost != nil && *c.OAuthAccountCost >= 0 {
		return *c.OAuthAccountCost
	}
	if fallback >= 0 {
		return fallback
	}
	return 0
}

type CostConfigResponse struct {
	Global     CostConfig          `json:"global"`
	Accounts   []AccountCostConfig `json:"accounts"`
	LastSyncAt *time.Time          `json:"last_sync_at,omitempty"`
}

func DefaultCostConfig() CostConfig {
	return CostConfig{OAuthAccountCost: 0, APICostMultiplier: 1, TaxRate: 0, Currency: "CNY"}
}

type ConsumptionQuery struct {
	StartTime time.Time
	EndTime   time.Time
}

type DailyConsumption struct {
	Date              time.Time `json:"date"`
	Requests          int64     `json:"requests"`
	TotalTokens       int64     `json:"total_tokens"`
	Revenue           float64   `json:"revenue"`
	APICost           float64   `json:"api_cost"`
	OAuthCost         float64   `json:"oauth_cost"`
	TotalCost         float64   `json:"total_cost"`
	GrossProfit       float64   `json:"gross_profit"`
	TaxAmount         float64   `json:"tax_amount"`
	Profit            float64   `json:"profit"`
	NetProfit         float64   `json:"net_profit"`
	NetMargin         float64   `json:"net_margin"`
	OAuthAccountCount int64     `json:"oauth_account_count"`
	APIAccountCount   int64     `json:"api_account_count"`
}

type AccountConsumption struct {
	AccountID        int64   `json:"account_id"`
	AccountType      string  `json:"account_type"`
	Name             string  `json:"name"`
	Platform         string  `json:"platform"`
	Requests         int64   `json:"requests"`
	Revenue          float64 `json:"revenue"`
	APICost          float64 `json:"api_cost"`
	OAuthCost        float64 `json:"oauth_cost"`
	GrossProfit      float64 `json:"gross_profit"`
	TaxAmount        float64 `json:"tax_amount"`
	NetProfit        float64 `json:"net_profit"`
	Multiplier       float64 `json:"multiplier"`
	MultiplierSource string  `json:"multiplier_source"`
}

type ConsumptionResponse struct {
	StartTime         time.Time            `json:"start_time"`
	EndTime           time.Time            `json:"end_time"`
	Config            CostConfig           `json:"config"`
	TotalRequests     int64                `json:"total_requests"`
	TotalTokens       int64                `json:"total_tokens"`
	TotalRevenue      float64              `json:"total_revenue"`
	TotalAPICost      float64              `json:"total_api_cost"`
	TotalOAuthCost    float64              `json:"total_oauth_cost"`
	TotalCost         float64              `json:"total_cost"`
	GrossProfit       float64              `json:"gross_profit"`
	GrossMargin       float64              `json:"gross_margin"`
	TotalTax          float64              `json:"total_tax"`
	Profit            float64              `json:"profit"`
	NetProfit         float64              `json:"net_profit"`
	NetMargin         float64              `json:"net_margin"`
	OAuthAccountCount int64                `json:"oauth_account_count"`
	Days              []DailyConsumption   `json:"days"`
	Accounts          []AccountConsumption `json:"accounts"`
}
