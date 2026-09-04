package integration

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"sub2api-extension/internal/ops"
	"sub2api-extension/internal/ttft"
)

// Sub2APICostStore reads Sub2API's read-only usage/account tables. Account
// settings themselves live in the extension database and are passed in by the
// service layer.
type Sub2APICostStore struct{ db *sql.DB }

func NewSub2APICostStore(db *sql.DB) *Sub2APICostStore { return &Sub2APICostStore{db: db} }

func (s *Sub2APICostStore) ListAccounts(ctx context.Context) ([]ops.Sub2APIAccount, error) {
	if s == nil || s.db == nil {
		return nil, ttft.ErrSub2APIDatabaseUnavailable
	}
	columns, err := s.columns(ctx, "accounts")
	if err != nil {
		return nil, fmt.Errorf("inspect accounts: %w", err)
	}
	if !columns["id"] {
		return nil, errors.New("accounts.id is unavailable")
	}
	name := textColumnExpression("a", columns, "name")
	platform := textColumnExpression("a", columns, "platform")
	typeExpr := textColumnExpression("a", columns, "type")
	rate := numericColumnExpression("a", columns, []string{"rate_multiplier"})
	updated := timeColumnExpression("a", columns, "updated_at")
	// Include soft-deleted accounts as well: they can still own historical
	// usage_logs and therefore still need a stable name and cost policy for
	// audit/reconciliation. The UI can distinguish current usage separately.
	where := "1=1"
	statement := fmt.Sprintf(`
		SELECT a."id"::bigint, %s, %s, %s, %s::double precision, %s
		FROM accounts a WHERE %s ORDER BY a."id" ASC`, name, typeExpr, platform, rate, updated, where)
	rows, err := s.db.QueryContext(ctx, statement)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	accounts := make([]ops.Sub2APIAccount, 0)
	for rows.Next() {
		var account ops.Sub2APIAccount
		var rawType string
		if err := rows.Scan(&account.ID, &account.Name, &rawType, &account.Platform, &account.RateMultiplier, &account.UpdatedAt); err != nil {
			return nil, err
		}
		account.Type = classifyAccountType(rawType, account.Platform)
		if account.RateMultiplier <= 0 {
			account.RateMultiplier = 1
		}
		accounts = append(accounts, account)
	}
	return accounts, rows.Err()
}

func (s *Sub2APICostStore) QueryConsumption(ctx context.Context, query ops.ConsumptionQuery, config ops.CostConfig, accountConfigs []ops.AccountCostConfig) (*ops.ConsumptionResponse, error) {
	if s == nil || s.db == nil {
		return nil, ttft.ErrSub2APIDatabaseUnavailable
	}
	if !query.StartTime.Before(query.EndTime) {
		return nil, errors.New("consumption query start time must be before end time")
	}
	usageColumns, err := s.columns(ctx, "usage_logs")
	if err != nil {
		return nil, fmt.Errorf("inspect usage_logs: %w", err)
	}
	accountColumns, err := s.columns(ctx, "accounts")
	if err != nil {
		return nil, fmt.Errorf("inspect accounts: %w", err)
	}
	if !usageColumns["created_at"] {
		return nil, errors.New("usage_logs.created_at is unavailable")
	}
	joined := usageColumns["account_id"] && accountColumns["id"]
	accountID := qualified("u", "account_id", usageColumns)
	join := ""
	if joined {
		// Do not filter deleted accounts here: historical usage must retain the
		// account's OAuth/API classification even after upstream deletion.
		join = ` LEFT JOIN accounts a ON a."id" = u."account_id"`
	}
	kind := accountKindExpression(accountColumns, joined)
	baseCost := accountBaseCostExpression("u", usageColumns)
	revenue := numericColumnExpression("u", usageColumns, []string{"charged_amount", "amount", "price", "total_price", "revenue", "request_amount", "actual_cost"})
	if revenue == "0" {
		revenue = baseCost
	}
	tokens := numericColumnExpression("u", usageColumns, []string{"total_tokens", "tokens"})
	if tokens == "0" {
		tokens = sumNumericColumns("u", usageColumns, []string{"input_tokens", "prompt_tokens", "output_tokens", "completion_tokens", "cache_creation_tokens", "cache_read_tokens", "image_input_tokens", "image_output_tokens"})
	}
	snapshotMultiplier := "NULL::double precision"
	hasSnapshot := usageColumns["account_rate_multiplier"]
	if hasSnapshot {
		snapshotMultiplier = fmt.Sprintf(`NULLIF(u.%s::double precision, 0)`, identifier("account_rate_multiplier"))
	}
	snapshotCost := fmt.Sprintf(`CASE WHEN %s IS NOT NULL THEN (%s) * (%s) ELSE 0 END`, snapshotMultiplier, baseCost, snapshotMultiplier)
	unsnapshottedRawCost := fmt.Sprintf(`CASE WHEN %s IS NULL THEN (%s) ELSE 0 END`, snapshotMultiplier, baseCost)
	accountFallback := "1"
	if joined && accountColumns["rate_multiplier"] {
		accountFallback = `COALESCE(NULLIF(a."rate_multiplier"::double precision, 0), 1)`
	}
	whereSQL := `u."created_at" >= $1 AND u."created_at" < $2`
	statement := fmt.Sprintf(`
		SELECT date_trunc('day', u."created_at" AT TIME ZONE 'Asia/Shanghai')::date,
		       %s::bigint,
		       %s,
		       COUNT(*)::bigint,
		       COALESCE(SUM(%s), 0)::double precision,
		       COALESCE(SUM(%s), 0)::double precision,
		       COALESCE(SUM(%s), 0)::double precision,
		       %s::double precision,
		       COALESCE(SUM(%s), 0)::bigint
		FROM usage_logs u%s
		WHERE %s
		GROUP BY 1, 2, 3, 8 ORDER BY 1 ASC, 2 ASC`, accountID, kind, revenue, snapshotCost, unsnapshottedRawCost, accountFallback, tokens, join, whereSQL)
	rows, err := s.db.QueryContext(ctx, statement, query.StartTime, query.EndTime)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	configs := make(map[int64]ops.AccountCostConfig, len(accountConfigs))
	for _, account := range accountConfigs {
		configs[account.AccountID] = account
	}
	result := &ops.ConsumptionResponse{StartTime: query.StartTime, EndTime: query.EndTime, Config: config, Days: make([]ops.DailyConsumption, 0), Accounts: make([]ops.AccountConsumption, 0)}
	dayIndex := make(map[string]int)
	accountIndex := make(map[int64]int)
	for rows.Next() {
		var day time.Time
		var accountIDScan sql.NullInt64
		var kindValue string
		var requests, tokenCount int64
		var rawRevenue, historicalCost, unsnapshottedRaw, fallbackMultiplier float64
		if err := rows.Scan(&day, &accountIDScan, &kindValue, &requests, &rawRevenue, &historicalCost, &unsnapshottedRaw, &fallbackMultiplier, &tokenCount); err != nil {
			return nil, err
		}
		accountIDValue := int64(0)
		if accountIDScan.Valid {
			accountIDValue = accountIDScan.Int64
		}
		accountConfig := configs[accountIDValue]
		multiplier := accountConfig.EffectiveAPIMultiplier(fallbackMultiplier)
		apiCost := historicalCost
		if kindValue != "oauth" {
			apiCost += unsnapshottedRaw * multiplier
		}
		key := day.Format("2006-01-02")
		idx, ok := dayIndex[key]
		if !ok {
			idx = len(result.Days)
			dayIndex[key] = idx
			result.Days = append(result.Days, ops.DailyConsumption{Date: day})
		}
		item := &result.Days[idx]
		item.Requests += requests
		item.TotalTokens += tokenCount
		item.Revenue += rawRevenue
		item.APICost += apiCost
		item.TotalCost += apiCost
		result.TotalRevenue += rawRevenue
		result.TotalRequests += requests
		result.TotalTokens += tokenCount
		if kindValue != "oauth" {
			item.APIAccountCount++
			result.TotalAPICost += apiCost
			if accountIDValue != 0 {
				addAccountBreakdown(result, accountIndex, accountConfig, accountIDValue, kindValue, rawRevenue, apiCost, requests, multiplier, multiplierSource(accountConfig, historicalCost, unsnapshottedRaw))
			}
		} else if accountIDValue != 0 {
			addAccountBreakdown(result, accountIndex, accountConfig, accountIDValue, kindValue, rawRevenue, 0, requests, 0, "purchase cost")
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	oauthUses, err := s.queryOAuthFirstUses(ctx, usageColumns, accountColumns, join, kind, accountID, query.StartTime, query.EndTime)
	if err != nil {
		return nil, fmt.Errorf("query oauth account costs: %w", err)
	}
	for _, use := range oauthUses {
		accountConfig := configs[use.AccountID]
		cost := accountConfig.EffectiveOAuthCost(config.OAuthAccountCost)
		key := use.Day.Format("2006-01-02")
		idx, ok := dayIndex[key]
		if !ok {
			idx = len(result.Days)
			dayIndex[key] = idx
			result.Days = append(result.Days, ops.DailyConsumption{Date: use.Day})
		}
		result.Days[idx].OAuthAccountCount++
		result.Days[idx].OAuthCost += cost
		result.Days[idx].TotalCost += cost
		result.TotalOAuthCost += cost
		result.OAuthAccountCount++
		if use.AccountID != 0 {
			addAccountBreakdown(result, accountIndex, accountConfig, use.AccountID, "oauth", 0, cost, 0, 0, "purchase cost")
		}
	}
	applyProfitMetrics(result, config)
	return result, nil
}

func applyProfitMetrics(result *ops.ConsumptionResponse, config ops.CostConfig) {
	for i := range result.Days {
		result.Days[i].GrossProfit = result.Days[i].Revenue - result.Days[i].TotalCost
		result.Days[i].Profit = result.Days[i].GrossProfit
		result.Days[i].TaxAmount = result.Days[i].Revenue * config.TaxRate / 100
		result.Days[i].NetProfit = result.Days[i].Profit - result.Days[i].TaxAmount
		if result.Days[i].Revenue > 0 {
			result.Days[i].NetMargin = result.Days[i].NetProfit / result.Days[i].Revenue
		}
	}
	result.TotalCost = result.TotalAPICost + result.TotalOAuthCost
	result.GrossProfit = result.TotalRevenue - result.TotalCost
	if result.TotalRevenue > 0 {
		result.GrossMargin = result.GrossProfit / result.TotalRevenue
	}
	result.TotalTax = result.TotalRevenue * config.TaxRate / 100
	result.Profit = result.GrossProfit
	result.NetProfit = result.Profit - result.TotalTax
	if result.TotalRevenue > 0 {
		result.NetMargin = result.NetProfit / result.TotalRevenue
	}
	for i := range result.Accounts {
		result.Accounts[i].GrossProfit = result.Accounts[i].Revenue - result.Accounts[i].APICost - result.Accounts[i].OAuthCost
		result.Accounts[i].TaxAmount = result.Accounts[i].Revenue * config.TaxRate / 100
		result.Accounts[i].NetProfit = result.Accounts[i].GrossProfit - result.Accounts[i].TaxAmount
	}
}

func addAccountBreakdown(result *ops.ConsumptionResponse, index map[int64]int, config ops.AccountCostConfig, accountID int64, kind string, revenue, cost float64, requests int64, multiplier float64, source string) {
	i, ok := index[accountID]
	if !ok {
		i = len(result.Accounts)
		index[accountID] = i
		result.Accounts = append(result.Accounts, ops.AccountConsumption{AccountID: accountID, AccountType: kind, Name: config.Name, Platform: config.Platform})
	}
	item := &result.Accounts[i]
	item.Requests += requests
	item.Revenue += revenue
	if kind == "oauth" {
		item.OAuthCost += cost
	} else {
		item.APICost += cost
		if multiplier > 0 {
			item.Multiplier = multiplier
		}
		if source != "" {
			item.MultiplierSource = source
		}
	}
}

func multiplierSource(config ops.AccountCostConfig, historicalCost, unsnapshottedRaw float64) string {
	if unsnapshottedRaw == 0 && historicalCost != 0 {
		return "usage log snapshot"
	}
	if config.APIMultiplierOverride != nil {
		return "manual"
	}
	if config.SyncedAPIMultiplier != nil {
		return "Sub2API sync"
	}
	return "Sub2API account"
}

type oauthFirstUse struct {
	AccountID int64
	Day       time.Time
}

func (s *Sub2APICostStore) queryOAuthFirstUses(ctx context.Context, usageColumns, accountColumns map[string]bool, join, kind, accountID string, start, end time.Time) ([]oauthFirstUse, error) {
	if !usageColumns["account_id"] || !accountColumns["id"] {
		return []oauthFirstUse{}, nil
	}
	statement := fmt.Sprintf(`
		SELECT %s::bigint,
		       MIN(date_trunc('day', u."created_at" AT TIME ZONE 'Asia/Shanghai')::date)
		FROM usage_logs u%s
		WHERE u."created_at" >= $1 AND u."created_at" < $2 AND (%s = 'oauth') AND %s IS NOT NULL
		GROUP BY %s ORDER BY 2 ASC`, accountID, join, kind, accountID, accountID)
	rows, err := s.db.QueryContext(ctx, statement, start, end)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	result := make([]oauthFirstUse, 0)
	for rows.Next() {
		var use oauthFirstUse
		if err := rows.Scan(&use.AccountID, &use.Day); err != nil {
			return nil, err
		}
		result = append(result, use)
	}
	return result, rows.Err()
}

func (s *Sub2APICostStore) columns(ctx context.Context, table string) (map[string]bool, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`, table)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	result := make(map[string]bool)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		result[strings.ToLower(name)] = true
	}
	return result, rows.Err()
}

func identifier(name string) string { return `"` + strings.ReplaceAll(name, `"`, `""`) + `"` }

func qualified(alias, name string, columns map[string]bool) string {
	if !columns[name] {
		return "NULL::bigint"
	}
	return alias + "." + identifier(name)
}

func numericColumnExpression(alias string, columns map[string]bool, candidates []string) string {
	for _, name := range candidates {
		if columns[name] {
			return fmt.Sprintf("COALESCE(%s.%s::numeric, 0)", alias, identifier(name))
		}
	}
	return "0"
}

func accountBaseCostExpression(alias string, columns map[string]bool) string {
	if columns["account_stats_cost"] && columns["total_cost"] {
		return fmt.Sprintf("COALESCE(%s.%s::double precision, %s.%s::double precision, 0)", alias, identifier("account_stats_cost"), alias, identifier("total_cost"))
	}
	return numericColumnExpression(alias, columns, []string{"account_stats_cost", "total_cost", "cost", "provider_cost", "upstream_cost"})
}

func sumNumericColumns(alias string, columns map[string]bool, candidates []string) string {
	parts := make([]string, 0, len(candidates))
	seen := make(map[string]struct{}, len(candidates))
	for _, name := range candidates {
		if !columns[name] {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		parts = append(parts, fmt.Sprintf("COALESCE(%s.%s::numeric, 0)", alias, identifier(name)))
	}
	if len(parts) == 0 {
		return "0"
	}
	return "(" + strings.Join(parts, " + ") + ")"
}

func textColumnExpression(alias string, columns map[string]bool, name string) string {
	if !columns[name] {
		return "''::text"
	}
	return fmt.Sprintf("COALESCE(%s.%s::text, '')", alias, identifier(name))
}

func timeColumnExpression(alias string, columns map[string]bool, name string) string {
	if !columns[name] {
		return "CURRENT_TIMESTAMP"
	}
	return fmt.Sprintf("COALESCE(%s.%s, CURRENT_TIMESTAMP)", alias, identifier(name))
}

func accountKindExpression(columns map[string]bool, joined bool) string {
	if !joined {
		return "'api'"
	}
	parts := make([]string, 0, 4)
	for _, name := range []string{"type", "auth_type", "account_type", "api_type", "credential_type", "auth_method", "mode", "platform", "source"} {
		if columns[name] {
			parts = append(parts, fmt.Sprintf("lower(coalesce(a.%s::text, ''))", identifier(name)))
		}
	}
	if len(parts) == 0 {
		return "'api'"
	}
	checks := make([]string, len(parts))
	for i, part := range parts {
		checks[i] = part + " LIKE '%oauth%'"
	}
	return fmt.Sprintf("CASE WHEN %s THEN 'oauth' ELSE 'api' END", strings.Join(checks, " OR "))
}

func classifyAccountType(rawType, platform string) string {
	value := strings.ToLower(strings.TrimSpace(rawType + " " + platform))
	if strings.Contains(value, "oauth") {
		return "oauth"
	}
	return "api"
}
