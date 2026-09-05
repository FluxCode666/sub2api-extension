package service

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"sub2api-extension/internal/ops"
)

type billingGroupTestStore struct {
	accounts   []ops.AccountCostConfig
	savedIDs   []int64
	savedGroup string
}

func (s *billingGroupTestStore) GetCostConfig(context.Context) (ops.CostConfig, error) {
	return ops.DefaultCostConfig(), nil
}
func (s *billingGroupTestStore) SaveCostConfig(context.Context, ops.CostConfig) error { return nil }
func (s *billingGroupTestStore) ListAccountCostConfigs(context.Context) ([]ops.AccountCostConfig, error) {
	return append([]ops.AccountCostConfig(nil), s.accounts...), nil
}
func (s *billingGroupTestStore) SaveAccountCostConfig(_ context.Context, config ops.AccountCostConfig) (ops.AccountCostConfig, error) {
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

func TestSaveBillingGroupRejectsMixedAccountTypes(t *testing.T) {
	store := &billingGroupTestStore{accounts: []ops.AccountCostConfig{
		{AccountID: 11, AccountType: "oauth"},
		{AccountID: 12, AccountType: "api"},
	}}
	service := NewCostService(nil, store)

	_, err := service.SaveBillingGroup(context.Background(), ops.BillingGroupUpdate{
		AccountIDs: []int64{11, 12}, BillingGroup: "mixed",
	})
	if !errors.Is(err, ErrInvalidBillingGroupUpdate) {
		t.Fatalf("SaveBillingGroup() error = %v, want ErrInvalidBillingGroupUpdate", err)
	}
	if len(store.savedIDs) != 0 {
		t.Fatalf("invalid update persisted ids %v", store.savedIDs)
	}
}
