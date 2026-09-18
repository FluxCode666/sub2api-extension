package service

import (
	"aux-system/internal/ops"
	"context"
	"errors"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

type costAccountSourceFunc func(context.Context) ([]ops.Sub2APIAccount, error)

func (f costAccountSourceFunc) ListAccounts(ctx context.Context) ([]ops.Sub2APIAccount, error) {
	return f(ctx)
}

type costLoadingTestStore struct {
	billingGroupTestStore
	synced  []ops.Sub2APIAccount
	readErr error
}

func (s *costLoadingTestStore) GetCostConfig(context.Context) (ops.CostConfig, error) {
	return ops.DefaultCostConfig(), s.readErr
}
func (s *costLoadingTestStore) SyncAccounts(_ context.Context, accounts []ops.Sub2APIAccount) error {
	s.synced = accounts
	s.accounts = mergeLiveAccountConfig(ops.CostConfigResponse{Accounts: s.accounts}, accounts).Accounts
	return nil
}

func TestGetCostConfigReadsLiveAccountsWithoutSync(t *testing.T) {
	created := time.Now()
	manual, cost := 0.2, 12.5
	upstream := []ops.Sub2APIAccount{
		{ID: 42, Name: "尚未使用的账号", Type: "oauth", CreatedAt: &created, RateMultiplier: 1},
		{ID: 2, Name: "新名称", Type: "api", RateMultiplier: 0.7},
	}
	store := &costLoadingTestStore{billingGroupTestStore: billingGroupTestStore{accounts: []ops.AccountCostConfig{
		{AccountID: 2, Name: "旧名称", AccountType: "api", BillingGroup: "历史组", APIMultiplierMode: "manual", APIMultiplierOverride: &manual, OAuthAccountCost: &cost, AccountDeletedAt: &created},
		{AccountID: 1, Name: "历史账号"},
	}}}
	calls := 0
	source := costAccountSourceFunc(func(context.Context) ([]ops.Sub2APIAccount, error) { calls++; return upstream, nil })
	svc := NewCostService(nil, store, source)
	// 模拟全量同步仍占用锁；读取必须立即完成。
	svc.accountSync <- struct{}{}
	defer func() { <-svc.accountSync }()
	for i := 1; i <= 2; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		result, err := svc.GetConfig(ctx)
		cancel()
		require.NoError(t, err)
		require.Nil(t, store.synced, "读取页面不得逐账号写库")
		require.Len(t, result.Accounts, 3)
		require.Equal(t, int64(42), result.Accounts[0].AccountID)
		require.Equal(t, "sync", result.Accounts[0].APIMultiplierMode)
		require.Equal(t, "新名称", result.Accounts[1].Name)
		require.Equal(t, "历史组", result.Accounts[1].BillingGroup)
		require.Equal(t, manual, *result.Accounts[1].APIMultiplierOverride)
		require.Equal(t, cost, *result.Accounts[1].OAuthAccountCost)
		require.Equal(t, 0.7, *result.Accounts[1].SyncedAPIMultiplier)
		require.Nil(t, result.Accounts[1].AccountDeletedAt)
		require.Equal(t, i, calls)
	}
}

func TestGetCostConfigPropagatesAccountRefreshFailures(t *testing.T) {
	for _, stage := range []string{"source", "store"} {
		t.Run(stage, func(t *testing.T) {
			failure := errors.New("read failed")
			store := &costLoadingTestStore{}
			source := costAccountSourceFunc(func(context.Context) ([]ops.Sub2APIAccount, error) {
				if stage == "source" {
					return nil, failure
				}
				return nil, nil
			})
			if stage == "store" {
				store.readErr = failure
			}
			_, err := NewCostService(nil, store, source).GetConfig(context.Background())
			require.ErrorIs(t, err, failure)
			require.Nil(t, store.synced)
		})
	}
}

func TestGetCostConfigWithoutAccountSourceKeepsLocalSettings(t *testing.T) {
	store := &billingGroupTestStore{accounts: []ops.AccountCostConfig{{AccountID: 42, BillingGroup: "历史组"}}}
	result, err := NewCostService(nil, store).GetConfig(context.Background())
	require.NoError(t, err)
	require.Equal(t, store.accounts, result.Accounts)
}

func TestCostSyncWaitCanBeCanceled(t *testing.T) {
	svc := NewCostService(nil, &costLoadingTestStore{}, costAccountSourceFunc(func(context.Context) ([]ops.Sub2APIAccount, error) {
		t.Fatal("等待同步锁期间不得访问上游")
		return nil, nil
	}))
	svc.accountSync <- struct{}{}
	defer func() { <-svc.accountSync }()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := svc.Sync(ctx)
	require.ErrorIs(t, err, context.Canceled)
}

func TestSaveBillingGroupIncludesUnsyncedAccountsWithoutReadingUpstreamAfterSave(t *testing.T) {
	store := &costLoadingTestStore{}
	source := costAccountSourceFunc(func(context.Context) ([]ops.Sub2APIAccount, error) {
		require.Nil(t, store.synced, "保存后不得再次读取上游")
		return []ops.Sub2APIAccount{{ID: 1, Type: "oauth"}, {ID: 2, Type: "api"}, {ID: 3, Type: "api"}}, nil
	})
	result, err := NewCostService(nil, store, source).SaveBillingGroup(context.Background(), ops.BillingGroupUpdate{AccountIDs: []int64{1, 2}, BillingGroup: "合并组"})
	require.NoError(t, err)
	require.Len(t, store.synced, 2, "仅建档选中的账号")
	require.Len(t, result.Accounts, 3, "保存后未建档账号仍可见")
	for _, account := range result.Accounts {
		if account.AccountID != 3 {
			require.Equal(t, "合并组", account.BillingGroup)
		}
	}
}

func TestSaveAccountOnlySyncsSelectedAccount(t *testing.T) {
	store := &costLoadingTestStore{}
	source := costAccountSourceFunc(func(context.Context) ([]ops.Sub2APIAccount, error) {
		return []ops.Sub2APIAccount{{ID: 1, Name: "真实名称", Type: "oauth"}, {ID: 2, Type: "api"}}, nil
	})
	cost := 12.5
	result, err := NewCostService(nil, store, source).SaveAccountConfig(context.Background(), ops.AccountCostConfig{AccountID: 1, Name: "客户端名称", AccountType: "api", OAuthAccountCost: &cost})
	require.NoError(t, err)
	require.Len(t, store.synced, 1)
	require.Equal(t, int64(1), store.synced[0].ID)
	require.Equal(t, "真实名称", result.Name)
	require.Equal(t, "oauth", result.AccountType)
	require.Equal(t, cost, *result.OAuthAccountCost)
}
