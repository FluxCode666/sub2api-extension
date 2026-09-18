//go:build integration

package service

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/stretchr/testify/require"

	"aux-system/ent"
	"aux-system/internal/integration"
	"aux-system/internal/ops"
)

func TestOAuthBillingGroupInheritsExplicitCost(t *testing.T) {
	dsn := os.Getenv("COST_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("需要隔离 PostgreSQL 测试库 COST_TEST_DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := sql.Open("postgres", dsn)
	require.NoError(t, err)
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	schema := "cost_billing_test_" + time.Now().Format("20060102150405000000000")
	_, err = db.ExecContext(ctx, `CREATE SCHEMA `+schema)
	require.NoError(t, err)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = db.ExecContext(cleanupCtx, `DROP SCHEMA `+schema+` CASCADE`)
	})
	_, err = db.ExecContext(ctx, `SET search_path TO `+schema)
	require.NoError(t, err)
	client := ent.NewClient(ent.Driver(entsql.OpenDB("postgres", db)))
	require.NoError(t, client.Schema.Create(ctx))
	_, err = db.ExecContext(ctx, `CREATE TABLE accounts (id bigint PRIMARY KEY, type text);
		INSERT INTO accounts VALUES (1, 'oauth'), (2, 'oauth'), (3, 'apikey');
		CREATE TABLE usage_logs (account_id bigint, created_at timestamptz, total_cost numeric, actual_cost numeric);
		INSERT INTO usage_logs VALUES
		(1, '2026-09-16T01:00:00Z', 5, 100), (3, '2026-09-16T01:00:00Z', 2, 10),
		(2, '2026-09-17T01:00:00Z', 5, 200)`)
	require.NoError(t, err)
	source := integration.NewSub2APICostStore(db)
	svc := NewCostService(source, NewEntCostConfigStore(client), source)
	global := ops.DefaultCostConfig()
	global.OAuthAccountCost = 7
	_, err = svc.SaveConfig(ctx, global)
	require.NoError(t, err)
	cost := 12.5
	owner, err := svc.SaveAccountConfig(ctx, ops.AccountCostConfig{AccountID: 2, OAuthAccountCost: &cost})
	require.NoError(t, err)
	_, err = svc.SaveBillingGroup(ctx, ops.BillingGroupUpdate{AccountIDs: []int64{1, 2, 3}, BillingGroup: "shared"})
	require.NoError(t, err)
	owner.BillingGroup = "shared"
	start := time.Date(2026, 9, 16, 0, 0, 0, 0, time.UTC)

	// 最小 ID 未填成本，唯一设置成本的成员在首日没有调用，仍使用整组的明确采购价。
	for _, days := range []int{1, 2} {
		result, queryErr := svc.Query(ctx, ops.ConsumptionQuery{StartTime: start, EndTime: start.AddDate(0, 0, days)})
		require.NoError(t, queryErr)
		require.Equal(t, cost, result.TotalOAuthCost)
		require.Equal(t, int64(1), result.OAuthAccountCount)
		require.Equal(t, 2.0, result.TotalAPICost)
		require.Equal(t, cost+2, result.TotalCost)
		require.Len(t, result.Accounts, 1)
		require.Equal(t, cost, result.Accounts[0].OAuthCost)
		require.Equal(t, "mixed", result.Accounts[0].AccountType)
		require.Equal(t, float64(110+(days-1)*200), result.TotalRevenue)
		require.Equal(t, result.TotalRevenue-cost-2, result.GrossProfit)
	}

	// 明确的零成本不能被默认价覆盖；清空最后一个明确成本后才回退默认价。
	zero := 0.0
	for _, tc := range []struct {
		value *float64
		want  float64
	}{{&zero, 0}, {nil, 7}} {
		owner.OAuthAccountCost = tc.value
		_, err = svc.SaveAccountConfig(ctx, owner)
		require.NoError(t, err)
		result, queryErr := svc.Query(ctx, ops.ConsumptionQuery{StartTime: start, EndTime: start.AddDate(0, 0, 2)})
		require.NoError(t, queryErr)
		require.Equal(t, tc.want, result.TotalOAuthCost)
		require.Equal(t, tc.want, result.Accounts[0].OAuthCost)
		require.Equal(t, int64(1), result.OAuthAccountCount)
	}
}
