package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"sub2api-extension/internal/ops"
)

type costAccountSourceFunc func(context.Context) ([]ops.Sub2APIAccount, error)

func (f costAccountSourceFunc) ListAccounts(ctx context.Context) ([]ops.Sub2APIAccount, error) {
	return f(ctx)
}

type costLoadingTestStore struct {
	billingGroupTestStore
	syncErr error
	synced  []ops.Sub2APIAccount
}

func (s *costLoadingTestStore) SyncAccounts(_ context.Context, accounts []ops.Sub2APIAccount) error {
	s.synced = accounts
	return s.syncErr
}

func TestGetCostConfigRefreshesAccountList(t *testing.T) {
	upstream := []ops.Sub2APIAccount{{ID: 42, Name: "尚未使用的账号", Type: "oauth"}}
	store := &costLoadingTestStore{billingGroupTestStore: billingGroupTestStore{
		accounts: []ops.AccountCostConfig{{AccountID: 42, Name: upstream[0].Name, AccountType: "oauth"}},
	}}
	calls := 0
	source := costAccountSourceFunc(func(context.Context) ([]ops.Sub2APIAccount, error) {
		calls++
		return upstream, nil
	})
	svc := NewCostService(nil, store, source)

	for i := 1; i <= 2; i++ {
		result, err := svc.GetConfig(context.Background())
		require.NoError(t, err)
		require.Equal(t, upstream, store.synced)
		require.Equal(t, store.accounts, result.Accounts)
		require.Equal(t, i, calls, "每次加载只读取一次上游账号列表")
	}
}

func TestGetCostConfigPropagatesAccountRefreshFailures(t *testing.T) {
	for _, stage := range []string{"source", "store"} {
		t.Run(stage, func(t *testing.T) {
			failure := errors.New("refresh failed")
			store := &costLoadingTestStore{}
			source := costAccountSourceFunc(func(context.Context) ([]ops.Sub2APIAccount, error) {
				if stage == "source" {
					return nil, failure
				}
				return []ops.Sub2APIAccount{{ID: 42}}, nil
			})
			if stage == "store" {
				store.syncErr = failure
			}
			_, err := NewCostService(nil, store, source).GetConfig(context.Background())
			require.ErrorIs(t, err, failure)
			if stage == "source" {
				require.Nil(t, store.synced)
			}
		})
	}
}

func TestGetCostConfigWithoutAccountSourceKeepsLocalSettings(t *testing.T) {
	store := &billingGroupTestStore{accounts: []ops.AccountCostConfig{{AccountID: 42, BillingGroup: "历史组"}}}
	result, err := NewCostService(nil, store).GetConfig(context.Background())
	require.NoError(t, err)
	require.Equal(t, store.accounts, result.Accounts)
}

func TestCostRefreshWaitCanBeCanceled(t *testing.T) {
	started, release, done := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	source := costAccountSourceFunc(func(ctx context.Context) ([]ops.Sub2APIAccount, error) {
		close(started)
		select {
		case <-release:
			return []ops.Sub2APIAccount{}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	})
	svc := NewCostService(nil, &costLoadingTestStore{}, source)
	go func() {
		_, err := svc.Sync(ctx)
		done <- err
	}()
	defer func() {
		close(release)
		require.NoError(t, <-done)
	}()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("同步任务未启动")
	}
	waitCtx, cancelWait := context.WithCancel(ctx)
	cancelWait()
	_, err := svc.GetConfig(waitCtx)
	require.ErrorIs(t, err, context.Canceled)
}

func TestSaveBillingGroupDoesNotRefreshAfterSaving(t *testing.T) {
	store := &billingGroupTestStore{accounts: []ops.AccountCostConfig{
		{AccountID: 1, AccountType: "api"}, {AccountID: 2, AccountType: "oauth"},
	}}
	source := costAccountSourceFunc(func(context.Context) ([]ops.Sub2APIAccount, error) {
		t.Fatal("保存计费组的响应不应再次依赖上游读取")
		return nil, nil
	})
	result, err := NewCostService(nil, store, source).SaveBillingGroup(context.Background(), ops.BillingGroupUpdate{
		AccountIDs: []int64{1, 2}, BillingGroup: "合并组",
	})
	require.NoError(t, err)
	for _, account := range result.Accounts {
		require.Equal(t, "合并组", account.BillingGroup)
	}
}
