package service

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/stretchr/testify/require"

	"sub2api-extension/internal/ops"
)

type billingGroupTestStore struct {
	accounts      []ops.AccountCostConfig
	savedIDs      []int64
	savedGroup    string
	savedAccounts []ops.AccountCostConfig
}

func (s *billingGroupTestStore) GetCostConfig(context.Context) (ops.CostConfig, error) {
	return ops.DefaultCostConfig(), nil
}
func (s *billingGroupTestStore) SaveCostConfig(context.Context, ops.CostConfig) error { return nil }
func (s *billingGroupTestStore) ListAccountCostConfigs(context.Context) ([]ops.AccountCostConfig, error) {
	return append([]ops.AccountCostConfig(nil), s.accounts...), nil
}
func (s *billingGroupTestStore) SaveAccountCostConfig(_ context.Context, config ops.AccountCostConfig) (ops.AccountCostConfig, error) {
	s.savedAccounts = append(s.savedAccounts, config)
	return config, nil
}
func (s *billingGroupTestStore) SetAccountBillingGroup(_ context.Context, accountIDs []int64, billingGroup string) error {
	s.savedIDs = append([]int64(nil), accountIDs...)
	s.savedGroup = billingGroup
	for i := range s.accounts {
		for _, id := range accountIDs {
			if s.accounts[i].AccountID == id {
				s.accounts[i].BillingGroup = billingGroup
			}
		}
	}
	return nil
}
func (s *billingGroupTestStore) SyncAccounts(context.Context, []ops.Sub2APIAccount) error { return nil }

func TestSaveBillingGroupUpdatesMultipleSameTypeAccounts(t *testing.T) {
	store := &billingGroupTestStore{accounts: []ops.AccountCostConfig{
		{AccountID: 11, AccountType: "oauth"},
		{AccountID: 12, AccountType: "oauth"},
		{AccountID: 13, AccountType: "api"},
	}}
	service := NewCostService(nil, store)

	response, err := service.SaveBillingGroup(context.Background(), ops.BillingGroupUpdate{
		AccountIDs: []int64{12, 11, 12}, BillingGroup: " renewed-account ",
	})
	if err != nil {
		t.Fatalf("SaveBillingGroup() error = %v", err)
	}
	if !reflect.DeepEqual(store.savedIDs, []int64{12, 11}) || store.savedGroup != "renewed-account" {
		t.Fatalf("saved update = ids %v group %q", store.savedIDs, store.savedGroup)
	}
	if response.Accounts[0].BillingGroup != "renewed-account" || response.Accounts[1].BillingGroup != "renewed-account" {
		t.Fatalf("response did not include updated group: %+v", response.Accounts)
	}
}

func TestSaveBillingGroupAcceptsMixedAccountTypes(t *testing.T) {
	store := &billingGroupTestStore{accounts: []ops.AccountCostConfig{
		{AccountID: 11, AccountType: "oauth"},
		{AccountID: 12, AccountType: "api"},
	}}
	service := NewCostService(nil, store)

	response, err := service.SaveBillingGroup(context.Background(), ops.BillingGroupUpdate{
		AccountIDs: []int64{11, 12}, BillingGroup: "mixed",
	})
	if err != nil {
		t.Fatalf("SaveBillingGroup() error = %v, want nil", err)
	}
	if !reflect.DeepEqual(store.savedIDs, []int64{11, 12}) || store.savedGroup != "mixed" {
		t.Fatalf("saved update = ids %v group %q", store.savedIDs, store.savedGroup)
	}
	if len(response.Accounts) != 2 || response.Accounts[0].BillingGroup != "mixed" || response.Accounts[1].BillingGroup != "mixed" {
		t.Fatalf("response did not include updated mixed group: %+v", response.Accounts)
	}
}

func TestSaveBillingGroupRejectsDifferentOAuthCosts(t *testing.T) {
	firstCost := 10.0
	secondCost := 12.0
	store := &billingGroupTestStore{accounts: []ops.AccountCostConfig{
		{AccountID: 11, AccountType: "oauth", OAuthAccountCost: &firstCost},
		{AccountID: 12, AccountType: "oauth", OAuthAccountCost: &secondCost},
	}}
	service := NewCostService(nil, store)

	_, err := service.SaveBillingGroup(context.Background(), ops.BillingGroupUpdate{
		AccountIDs: []int64{11, 12}, BillingGroup: "conflict",
	})
	if !errors.Is(err, ErrBillingGroupOAuthCostConflict) {
		t.Fatalf("SaveBillingGroup() error = %v, want OAuth cost conflict", err)
	}
	if len(store.savedIDs) != 0 {
		t.Fatalf("invalid update persisted ids %v", store.savedIDs)
	}
}

func TestSaveBillingGroupAllowsUnsetOAuthCostWhenOneAccountIsConfigured(t *testing.T) {
	cost := 12.5
	store := &billingGroupTestStore{accounts: []ops.AccountCostConfig{
		{AccountID: 11, AccountType: "oauth", OAuthAccountCost: &cost},
		{AccountID: 12, AccountType: "oauth", OAuthAccountCost: nil},
	}}
	service := NewCostService(nil, store)

	if _, err := service.SaveBillingGroup(context.Background(), ops.BillingGroupUpdate{
		AccountIDs: []int64{11, 12}, BillingGroup: "继承成本组",
	}); err != nil {
		t.Fatalf("SaveBillingGroup() error = %v, want nil", err)
	}
	if !reflect.DeepEqual(store.savedIDs, []int64{11, 12}) || store.savedGroup != "继承成本组" {
		t.Fatalf("saved update = ids %v group %q", store.savedIDs, store.savedGroup)
	}
}

func TestSaveAccountConfigValidatesOnlyExplicitOAuthCosts(t *testing.T) {
	cost, other, zero := 12.5, 20.0, 0.0
	for _, tc := range []struct {
		name                              string
		savedCost, incomingCost, peerCost *float64
		conflict                          bool
	}{
		{"未设置账号加入有成本的组", nil, nil, &cost, false},
		{"有成本账号加入未设置的组", nil, &cost, nil, false},
		{"多个明确成本相同", nil, &cost, &cost, false},
		{"多个明确成本不同", nil, &other, &cost, true},
		{"明确零成本也参与冲突判断", nil, &zero, &cost, true},
		{"清空成本后继承同组成本", &cost, nil, &cost, false},
		{"修改唯一明确成本时忽略自身旧值", &cost, &other, nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &billingGroupTestStore{accounts: []ops.AccountCostConfig{
				{AccountID: 11, AccountType: "oauth", BillingGroup: " Shared ", OAuthAccountCost: tc.savedCost},
				{AccountID: 12, AccountType: "oauth", BillingGroup: "SHARED", OAuthAccountCost: tc.peerCost},
			}}
			_, err := NewCostService(nil, store).SaveAccountConfig(context.Background(), ops.AccountCostConfig{
				AccountID: 11, AccountType: "oauth", BillingGroup: "shared", OAuthAccountCost: tc.incomingCost,
			})
			if tc.conflict {
				require.ErrorIs(t, err, ErrBillingGroupOAuthCostConflict)
				require.Empty(t, store.savedAccounts)
			} else {
				require.NoError(t, err)
				require.Len(t, store.savedAccounts, 1)
				require.Equal(t, tc.incomingCost, store.savedAccounts[0].OAuthAccountCost)
			}
		})
	}
}

func TestSaveBillingGroupChecksExistingGroupExplicitCosts(t *testing.T) {
	cost, other := 12.5, 20.0
	for _, tc := range []struct {
		name     string
		cost     *float64
		conflict bool
	}{
		{"选中账号未设置时继承已有组", nil, false},
		{"选中账号与已有组成本一致", &cost, false},
		{"选中账号与已有组成本冲突", &other, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &billingGroupTestStore{accounts: []ops.AccountCostConfig{
				{AccountID: 11, AccountType: "oauth", OAuthAccountCost: tc.cost},
				{AccountID: 12, AccountType: "oauth"},
				{AccountID: 13, AccountType: "oauth", BillingGroup: " SHARED ", OAuthAccountCost: &cost},
				{AccountID: 14, AccountType: "api", BillingGroup: "shared", OAuthAccountCost: &other},
			}}
			_, err := NewCostService(nil, store).SaveBillingGroup(context.Background(), ops.BillingGroupUpdate{
				AccountIDs: []int64{11, 12}, BillingGroup: "shared",
			})
			if tc.conflict {
				require.ErrorIs(t, err, ErrBillingGroupOAuthCostConflict)
				require.Empty(t, store.savedIDs)
			} else {
				require.NoError(t, err)
				require.Equal(t, []int64{11, 12}, store.savedIDs)
			}
		})
	}
}
