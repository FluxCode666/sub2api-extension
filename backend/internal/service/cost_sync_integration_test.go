//go:build integration

package service

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	_ "github.com/lib/pq"
	"github.com/stretchr/testify/require"

	"aux-system/ent"
	"aux-system/internal/integration"
	"aux-system/internal/ops"
)

// 仅使用显式指定的临时测试库，避免在开发或生产 Sub2API 库创建测试表。
func TestCostAccountSyncDeletionAndMigration(t *testing.T) {
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
	// 每次测试使用独立 schema，可重复执行，不清理调用者的数据。
	schema := "cost_test_" + time.Now().Format("20060102150405000000000")
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
	store := NewEntCostConfigStore(client)
	source := integration.NewSub2APICostStore(db)
	svc := NewCostService(source, store, source)

	// 模拟旧版本已保存的成本配置，验证新增可空列迁移不丢成本或分组。
	_, err = db.ExecContext(ctx, `ALTER TABLE account_cost_configs DROP COLUMN account_deleted_at`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO account_cost_configs
		(account_id, account_type, name, billing_group, api_multiplier_mode, api_multiplier_override, created_at, updated_at)
		VALUES (2, 'api', '旧名称', '历史组', 'manual', 0.2, now(), now())`)
	require.NoError(t, err)
	require.NoError(t, client.Schema.Create(ctx))
	require.NoError(t, client.Schema.Create(ctx))
	_, err = db.ExecContext(ctx, `CREATE TABLE accounts (
		id bigint PRIMARY KEY, name text, type text, platform text, rate_multiplier numeric,
		created_at timestamptz, expires_at timestamptz, updated_at timestamptz, deleted_at timestamptz);
		INSERT INTO accounts VALUES
		(1, '有效 OAuth', 'oauth', 'openai', 1, '2026-09-10T00:00:00Z', '2026-10-01T00:00:00Z', now(), NULL),
		(2, '已删除 API', 'apikey', 'anthropic', 0.7, '2026-09-12T00:00:00Z', NULL, now(), '2026-09-13T00:00:00Z'),
		(3, '未知创建时间', 'apikey', 'openai', 1, NULL, NULL, now(), NULL),
		(4, '同日有效 API', 'apikey', 'anthropic', 1, '2026-09-12T00:00:00Z', NULL, now(), NULL)`)
	require.NoError(t, err)
	// 此时甚至没有 usage_logs 表；首次打开配置页就应获取所有上游账号。
	result, err := svc.GetConfig(ctx)
	require.NoError(t, err)
	require.Len(t, result.Accounts, 4)
	ids := make([]int64, 0, len(result.Accounts))
	for _, account := range result.Accounts {
		ids = append(ids, account.AccountID)
	}
	require.Equal(t, []int64{4, 2, 1, 3}, ids)
	deleted := result.Accounts[1]
	require.NotNil(t, deleted.AccountDeletedAt)
	require.Equal(t, "已删除 API", deleted.Name)
	require.Equal(t, "历史组", deleted.BillingGroup)
	require.Equal(t, 0.2, *deleted.APIMultiplierOverride)
	require.Nil(t, result.Accounts[0].AccountDeletedAt)
	require.Nil(t, result.Accounts[3].AccountCreatedAt)
	require.NotNil(t, result.Accounts[2].AccountExpiresAt)
	require.Equal(t, "2026-10-01T00:00:00Z", result.Accounts[2].AccountExpiresAt.UTC().Format(time.RFC3339))

	persisted, err := store.ListAccountCostConfigs(ctx)
	require.NoError(t, err)
	require.Len(t, persisted, 1, "读取账号列表不应执行全量建档")
	// 后台同步仍独立保存历史元数据；成本与分组不能被覆盖。
	_, err = svc.Sync(ctx)
	require.NoError(t, err)

	// 新账号无需使用记录或手工同步，重新加载后即可保存采购价并参与合并计费。
	_, err = db.ExecContext(ctx, `INSERT INTO accounts VALUES
		(5, '新建未使用 OAuth', 'oauth', 'openai', 1, '2026-09-14T00:00:00Z', NULL, now(), NULL)`)
	require.NoError(t, err)
	result, err = svc.GetConfig(ctx)
	require.NoError(t, err)
	require.Len(t, result.Accounts, 5)
	newAccount := result.Accounts[0]
	require.Equal(t, int64(5), newAccount.AccountID)
	require.Nil(t, newAccount.OAuthAccountCost)
	cost := 12.5
	newAccount.OAuthAccountCost = &cost
	saved, err := svc.SaveAccountConfig(ctx, newAccount)
	require.NoError(t, err)
	require.Equal(t, cost, *saved.OAuthAccountCost)
	result, err = svc.SaveBillingGroup(ctx, ops.BillingGroupUpdate{AccountIDs: []int64{5, 4}, BillingGroup: "未使用账号组"})
	require.NoError(t, err)
	result, err = svc.GetConfig(ctx)
	require.NoError(t, err)
	require.Equal(t, "未使用账号组", result.Accounts[0].BillingGroup)
	require.Equal(t, "未使用账号组", result.Accounts[1].BillingGroup)
	require.Equal(t, cost, *result.Accounts[0].OAuthAccountCost)
	require.Equal(t, 0.2, *result.Accounts[2].APIMultiplierOverride)

	// 编辑成本不得通过响应中的同步字段篡改删除状态。
	for _, value := range []*time.Time{nil, new(time.Time)} {
		edit := deleted
		edit.AccountDeletedAt = value
		saved, saveErr := svc.SaveAccountConfig(ctx, edit)
		require.NoError(t, saveErr)
		require.Equal(t, deleted.AccountDeletedAt, saved.AccountDeletedAt)
	}

	_, err = db.ExecContext(ctx, `CREATE TABLE usage_logs (
		account_id bigint, created_at timestamptz, total_cost numeric, actual_cost numeric, account_rate_multiplier numeric);
		INSERT INTO usage_logs VALUES (2, '2026-09-12T01:00:00Z', 100, 200, 0.5)`)
	require.NoError(t, err)
	start := time.Date(2026, 9, 12, 0, 0, 0, 0, time.UTC)
	consumption, err := svc.Query(ctx, ops.ConsumptionQuery{StartTime: start, EndTime: start.Add(24 * time.Hour)})
	require.NoError(t, err)
	require.True(t, consumption.RevenueAvailable)
	require.Equal(t, "actual_cost", consumption.RevenueSource)
	require.Equal(t, 200.0, consumption.TotalRevenue)
	require.Equal(t, 50.0, consumption.TotalAPICost)
	require.Len(t, consumption.Accounts, 1)
	require.Equal(t, "历史组", consumption.Accounts[0].BillingGroup)

	// 上游恢复账号后，下一次同步必须清除旧删除标记。
	_, err = db.ExecContext(ctx, `UPDATE accounts SET deleted_at = NULL WHERE id = 2`)
	require.NoError(t, err)
	result, err = svc.Sync(ctx)
	require.NoError(t, err)
	require.Nil(t, result.Accounts[2].AccountDeletedAt)
	require.Equal(t, 0.2, *result.Accounts[2].APIMultiplierOverride)

	// 兼容没有删除时间列的旧版上游表。
	_, err = db.ExecContext(ctx, `ALTER TABLE accounts DROP COLUMN deleted_at`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `ALTER TABLE accounts DROP COLUMN expires_at`)
	require.NoError(t, err)
	upstream, err := source.ListAccounts(ctx)
	require.NoError(t, err)
	require.Len(t, upstream, 5)
	for _, account := range upstream {
		require.Nil(t, account.DeletedAt)
	}

	t.Run("large account list avoids per-account writes", func(t *testing.T) {
		_, err := db.ExecContext(ctx, `INSERT INTO accounts (id, name, type, platform, rate_multiplier)
			SELECT n, '未使用账号 ' || n, 'apikey', 'openai', 0.7 FROM generate_series(100, 1599) n`)
		require.NoError(t, err)
		// 每次数据库操作注入 6ms 延迟；旧版全量同步在此负载下超过 15 秒。
		delayed := ent.NewClient(ent.Driver(costLatencyDriver{Driver: entsql.OpenDB("postgres", db)}))
		fastService := NewCostService(nil, NewEntCostConfigStore(delayed), source)
		readCtx, readCancel := context.WithTimeout(ctx, 2*time.Second)
		defer readCancel()
		result, err := fastService.GetConfig(readCtx)
		require.NoError(t, err)
		require.Len(t, result.Accounts, 1505)
		persisted, err := store.ListAccountCostConfigs(ctx)
		require.NoError(t, err)
		require.Len(t, persisted, 5, "读取大量未使用账号不应逐条建档")

		result, err = fastService.SaveBillingGroup(ctx, ops.BillingGroupUpdate{AccountIDs: []int64{100, 101}, BillingGroup: "新账号合并组"})
		require.NoError(t, err)
		require.Len(t, result.Accounts, 1505, "保存后未建档账号不得消失")
		persisted, err = store.ListAccountCostConfigs(ctx)
		require.NoError(t, err)
		require.Len(t, persisted, 7, "仅所选的两个新账号需要建档")
	})

	t.Run("concurrent first sync can recover unique conflict", func(t *testing.T) {
		started, release := make(chan struct{}, 2), make(chan struct{})
		client.AccountCostConfig.Use(func(next ent.Mutator) ent.Mutator {
			return ent.MutateFunc(func(ctx context.Context, mutation ent.Mutation) (ent.Value, error) {
				if mutation.Op().Is(ent.OpCreate) {
					started <- struct{}{}
					select {
					case <-release:
					case <-ctx.Done():
						return nil, ctx.Err()
					}
				}
				return next.Mutate(ctx, mutation)
			})
		})
		done := make(chan error, 2)
		for range 2 {
			go func() {
				done <- store.SyncAccounts(ctx, []ops.Sub2APIAccount{{ID: 9000, Name: "并发新账号", Type: "api", RateMultiplier: 0.5}})
			}()
		}
		for range 2 {
			select {
			case <-started:
			case <-ctx.Done():
				close(release)
				<-done
				<-done
				t.Fatal("并发建档未进入测试屏障")
			}
		}
		close(release)
		err1, err2 := <-done, <-done
		require.NoError(t, err1)
		require.NoError(t, err2)
	})

}

// costLatencyDriver 模拟网络数据库往返延迟，覆盖真实 SQL 路径的性能回归。
type costLatencyDriver struct{ dialect.Driver }

func costDatabaseDelay(ctx context.Context) error {
	timer := time.NewTimer(6 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (d costLatencyDriver) Query(ctx context.Context, query string, args, result any) error {
	if err := costDatabaseDelay(ctx); err != nil {
		return err
	}
	return d.Driver.Query(ctx, query, args, result)
}
func (d costLatencyDriver) Exec(ctx context.Context, query string, args, result any) error {
	if err := costDatabaseDelay(ctx); err != nil {
		return err
	}
	return d.Driver.Exec(ctx, query, args, result)
}
