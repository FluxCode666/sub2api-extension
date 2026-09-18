//go:build integration

package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"testing"
	"time"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/stretchr/testify/require"

	"aux-system/ent"
	"aux-system/internal/integration"
	"aux-system/internal/ops"
)

func TestCostAccountSubscriptionExpiry(t *testing.T) {
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
	schema := "cost_expiry_test_" + time.Now().Format("20060102150405000000000")
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
	source := integration.NewSub2APICostStore(db)
	svc := NewCostService(source, NewEntCostConfigStore(client), source)
	_, err = db.ExecContext(ctx, `CREATE TABLE accounts (
		id bigint PRIMARY KEY, type text, platform text, expires_at timestamptz,
		credentials jsonb, parent_account_id bigint);
		INSERT INTO accounts VALUES
		(1, 'oauth', 'openai', NULL, '{"subscription_expires_at":"2026-10-01T08:00:00+08:00","expires_at":"2026-09-14T01:00:00Z","access_token":"test-token-not-for-response"}', NULL),
		(2, 'oauth', 'openai', '2026-09-20T00:00:00Z', '{"subscription_expires_at":"2026-10-01T00:00:00Z"}', NULL),
		(3, 'oauth', 'openai', NULL, '{"expires_at":"2026-09-14T01:00:00Z"}', NULL),
		(4, 'oauth', 'openai', NULL, '{"subscription_expires_at":"invalid-date"}', NULL),
		(5, 'oauth', 'openai', NULL, '{"subscription_expires_at":null}', NULL),
		(6, 'apikey', 'openai', NULL, '{"subscription_expires_at":"2026-10-01T00:00:00Z"}', NULL),
		(7, 'oauth', 'openai', NULL, NULL, 1),
		(8, 'oauth', 'openai', NULL, '{"subscription_expires_at":" 2026-10-02T00:00:00.123Z "}', 1),
		(9, 'oauth', 'openai', NULL, NULL, 999),
		(10, 'oauth', 'openai', NULL, '{"subscription_expires_at":"2020-01-01T00:00:00Z"}', NULL),
		(11, 'oauth', 'openai', NULL, '{"subscription_expires_at":1234567890}', NULL),
		(12, 'oauth', 'openai', NULL, '{"subscription_expires_at":"0001-01-01T00:00:00Z"}', NULL),
		(13, 'oauth', 'openai', NULL, '{"subscription_expires_at":""}', NULL);
		CREATE TABLE usage_logs (account_id bigint, created_at timestamptz, actual_cost numeric, total_cost numeric);
		INSERT INTO usage_logs VALUES (1, '2026-09-14T01:00:00Z', 10, 5)`)
	require.NoError(t, err)

	result, err := svc.Sync(ctx)
	require.NoError(t, err)
	byID := make(map[int64]ops.AccountCostConfig)
	for _, account := range result.Accounts {
		byID[account.AccountID] = account
	}
	require.Len(t, byID, 13)
	for id, expected := range map[int64]string{
		1: "2026-10-01T00:00:00Z", 2: "2026-09-20T00:00:00Z", 7: "2026-10-01T00:00:00Z",
		8: "2026-10-02T00:00:00.123Z", 10: "2020-01-01T00:00:00Z",
	} {
		require.NotNil(t, byID[id].AccountExpiresAt, "账号 %d", id)
		require.Equal(t, expected, byID[id].AccountExpiresAt.UTC().Format(time.RFC3339Nano), "账号 %d", id)
	}
	for _, id := range []int64{3, 4, 5, 6, 9, 11, 12, 13} {
		require.Nil(t, byID[id].AccountExpiresAt, "账号 %d", id)
	}
	encoded, err := json.Marshal(result)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "test-token-not-for-response")
	require.NotContains(t, string(encoded), "credentials")

	// 验证订阅日期穿过同步、持久化和实际回本查询，且续期/清空能更新旧快照。
	start := time.Date(2026, 9, 14, 0, 0, 0, 0, time.UTC)
	for _, expiry := range []string{"2026-11-01T00:00:00Z", ""} {
		_, err = db.ExecContext(ctx, `UPDATE accounts SET credentials = jsonb_build_object('subscription_expires_at', $1::text) WHERE id = 1`, expiry)
		require.NoError(t, err)
		_, err = svc.Sync(ctx)
		require.NoError(t, err)
		consumption, queryErr := svc.Query(ctx, ops.ConsumptionQuery{StartTime: start, EndTime: start.Add(24 * time.Hour)})
		require.NoError(t, queryErr)
		require.Len(t, consumption.Accounts, 1)
		if expiry == "" {
			require.Nil(t, consumption.Accounts[0].AccountExpiresAt)
		} else {
			require.NotNil(t, consumption.Accounts[0].AccountExpiresAt)
			require.Equal(t, expiry, consumption.Accounts[0].AccountExpiresAt.UTC().Format(time.RFC3339))
		}
	}

	// 旧版上游缺少人工到期列、母账号列或凭据列时，仍应正常读取列表。
	for _, column := range []string{"expires_at", "parent_account_id", "credentials"} {
		_, err = db.ExecContext(ctx, `ALTER TABLE accounts DROP COLUMN `+column)
		require.NoError(t, err)
		accounts, listErr := source.ListAccounts(ctx)
		require.NoError(t, listErr)
		require.Len(t, accounts, 13)
		if column == "credentials" {
			for _, account := range accounts {
				require.Nil(t, account.ExpiresAt)
			}
		}
	}
}
