package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"sub2api-extension/ent"
	"sub2api-extension/ent/accountcostconfig"
	"sub2api-extension/ent/systemmeta"
	"sub2api-extension/internal/ops"
)

const CostConfigKey = "ops.cost.config"

type CostQueryStore interface {
	QueryConsumption(ctx context.Context, query ops.ConsumptionQuery, config ops.CostConfig, accounts []ops.AccountCostConfig) (*ops.ConsumptionResponse, error)
}

type CostAccountSource interface {
	ListAccounts(ctx context.Context) ([]ops.Sub2APIAccount, error)
}

type CostConfigStore interface {
	GetCostConfig(ctx context.Context) (ops.CostConfig, error)
	SaveCostConfig(ctx context.Context, config ops.CostConfig) error
	ListAccountCostConfigs(ctx context.Context) ([]ops.AccountCostConfig, error)
	SaveAccountCostConfig(ctx context.Context, config ops.AccountCostConfig) (ops.AccountCostConfig, error)
	SyncAccounts(ctx context.Context, accounts []ops.Sub2APIAccount) error
}

type CostService struct {
	queryStore    CostQueryStore
	configStore   CostConfigStore
	accountSource CostAccountSource
}

func NewCostService(queryStore CostQueryStore, configStore CostConfigStore, sources ...CostAccountSource) *CostService {
	var source CostAccountSource
	if len(sources) > 0 {
		source = sources[0]
	}
	return &CostService{queryStore: queryStore, configStore: configStore, accountSource: source}
}

func (s *CostService) Query(ctx context.Context, query ops.ConsumptionQuery) (*ops.ConsumptionResponse, error) {
	if s == nil || s.queryStore == nil || s.configStore == nil {
		return nil, errors.New("cost store is unavailable")
	}
	config, err := s.configStore.GetCostConfig(ctx)
	if err != nil {
		return nil, err
	}
	accounts, err := s.configStore.ListAccountCostConfigs(ctx)
	if err != nil {
		return nil, err
	}
	return s.queryStore.QueryConsumption(ctx, query, config, accounts)
}

func (s *CostService) GetConfig(ctx context.Context) (ops.CostConfigResponse, error) {
	if s == nil || s.configStore == nil {
		return ops.CostConfigResponse{Global: ops.DefaultCostConfig(), Accounts: []ops.AccountCostConfig{}}, errors.New("cost store is unavailable")
	}
	global, err := s.configStore.GetCostConfig(ctx)
	if err != nil {
		return ops.CostConfigResponse{}, err
	}
	accounts, err := s.configStore.ListAccountCostConfigs(ctx)
	if err != nil {
		return ops.CostConfigResponse{}, err
	}
	return makeCostConfigResponse(global, accounts), nil
}

func (s *CostService) SaveConfig(ctx context.Context, config ops.CostConfig) (ops.CostConfig, error) {
	config = normalizeCostConfig(config)
	if s == nil || s.configStore == nil {
		return config, errors.New("cost store is unavailable")
	}
	if err := s.configStore.SaveCostConfig(ctx, config); err != nil {
		return config, err
	}
	return config, nil
}

func (s *CostService) SaveAccountConfig(ctx context.Context, config ops.AccountCostConfig) (ops.AccountCostConfig, error) {
	config = normalizeAccountCostConfig(config)
	if s == nil || s.configStore == nil {
		return config, errors.New("cost store is unavailable")
	}
	return s.configStore.SaveAccountCostConfig(ctx, config)
}

func (s *CostService) Sync(ctx context.Context) (ops.CostConfigResponse, error) {
	if s == nil || s.accountSource == nil || s.configStore == nil {
		return ops.CostConfigResponse{}, errors.New("cost account sync is unavailable")
	}
	accounts, err := s.accountSource.ListAccounts(ctx)
	if err != nil {
		return ops.CostConfigResponse{}, err
	}
	if err := s.configStore.SyncAccounts(ctx, accounts); err != nil {
		return ops.CostConfigResponse{}, err
	}
	return s.GetConfig(ctx)
}

// StartPeriodicSync performs an initial best-effort sync and then refreshes
// the read-only Sub2API account multipliers on the configured interval.
func (s *CostService) StartPeriodicSync(ctx context.Context, interval time.Duration, report func(error)) {
	if s == nil || s.accountSource == nil || interval <= 0 {
		return
	}
	go func() {
		if _, err := s.Sync(ctx); err != nil && report != nil {
			report(err)
		}
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if _, err := s.Sync(ctx); err != nil && report != nil {
					report(err)
				}
			}
		}
	}()
}

func normalizeCostConfig(config ops.CostConfig) ops.CostConfig {
	defaults := ops.DefaultCostConfig()
	if config.OAuthAccountCost < 0 {
		config.OAuthAccountCost = defaults.OAuthAccountCost
	}
	if config.APICostMultiplier <= 0 {
		config.APICostMultiplier = defaults.APICostMultiplier
	}
	if config.TaxRate < 0 || config.TaxRate > 100 {
		config.TaxRate = defaults.TaxRate
	}
	config.Currency = strings.ToUpper(strings.TrimSpace(config.Currency))
	if config.Currency == "" {
		config.Currency = defaults.Currency
	}
	if len([]rune(config.Currency)) > 8 {
		config.Currency = string([]rune(config.Currency)[:8])
	}
	return config
}

func normalizeAccountCostConfig(config ops.AccountCostConfig) ops.AccountCostConfig {
	config.AccountType = strings.ToLower(strings.TrimSpace(config.AccountType))
	if config.AccountType != "oauth" {
		config.AccountType = "api"
	}
	config.APIMultiplierMode = strings.ToLower(strings.TrimSpace(config.APIMultiplierMode))
	if config.APIMultiplierMode != "manual" && config.APIMultiplierOverride != nil {
		config.APIMultiplierMode = "manual"
	}
	if config.APIMultiplierMode == "" {
		config.APIMultiplierMode = "sync"
	}
	if config.OAuthAccountCost != nil && *config.OAuthAccountCost < 0 {
		config.OAuthAccountCost = nil
	}
	if config.APIMultiplierOverride != nil && *config.APIMultiplierOverride <= 0 {
		config.APIMultiplierOverride = nil
		config.APIMultiplierMode = "sync"
	}
	return config
}

func makeCostConfigResponse(global ops.CostConfig, accounts []ops.AccountCostConfig) ops.CostConfigResponse {
	response := ops.CostConfigResponse{Global: global, Accounts: accounts}
	for _, account := range accounts {
		if account.LastSyncedAt != nil && (response.LastSyncAt == nil || account.LastSyncedAt.After(*response.LastSyncAt)) {
			value := *account.LastSyncedAt
			response.LastSyncAt = &value
		}
	}
	return response
}

// EntCostConfigStore keeps global settings and per-account policies in the
// extension-owned database. Sub2API's database is never written.
type EntCostConfigStore struct{ client *ent.Client }

func NewEntCostConfigStore(client *ent.Client) *EntCostConfigStore {
	return &EntCostConfigStore{client: client}
}

func (s *EntCostConfigStore) GetCostConfig(ctx context.Context) (ops.CostConfig, error) {
	defaults := ops.DefaultCostConfig()
	if s == nil || s.client == nil {
		return defaults, errors.New("cost config store is unavailable")
	}
	meta, err := s.client.SystemMeta.Query().Where(systemmeta.KeyEQ(CostConfigKey)).Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return defaults, nil
		}
		return defaults, err
	}
	var config ops.CostConfig
	if err := json.Unmarshal([]byte(meta.Value), &config); err != nil {
		return defaults, err
	}
	return normalizeCostConfig(config), nil
}

func (s *EntCostConfigStore) SaveCostConfig(ctx context.Context, config ops.CostConfig) error {
	if s == nil || s.client == nil {
		return errors.New("cost config store is unavailable")
	}
	encoded, err := json.Marshal(normalizeCostConfig(config))
	if err != nil {
		return err
	}
	meta, err := s.client.SystemMeta.Query().Where(systemmeta.KeyEQ(CostConfigKey)).Only(ctx)
	if err != nil {
		if !ent.IsNotFound(err) {
			return err
		}
		_, err = s.client.SystemMeta.Create().SetKey(CostConfigKey).SetValue(string(encoded)).Save(ctx)
		return err
	}
	_, err = meta.Update().SetValue(string(encoded)).Save(ctx)
	return err
}

func (s *EntCostConfigStore) ListAccountCostConfigs(ctx context.Context) ([]ops.AccountCostConfig, error) {
	if s == nil || s.client == nil {
		return nil, errors.New("cost config store is unavailable")
	}
	entities, err := s.client.AccountCostConfig.Query().Order(ent.Asc(accountcostconfig.FieldAccountID)).All(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]ops.AccountCostConfig, 0, len(entities))
	for _, entity := range entities {
		result = append(result, accountCostConfigFromEntity(entity))
	}
	return result, nil
}

func (s *EntCostConfigStore) SaveAccountCostConfig(ctx context.Context, config ops.AccountCostConfig) (ops.AccountCostConfig, error) {
	config = normalizeAccountCostConfig(config)
	if s == nil || s.client == nil {
		return config, errors.New("cost config store is unavailable")
	}
	if config.AccountID <= 0 {
		return config, errors.New("account id must be positive")
	}
	entity, err := s.client.AccountCostConfig.Query().Where(accountcostconfig.AccountIDEQ(config.AccountID)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return config, err
	}
	if ent.IsNotFound(err) {
		builder := s.client.AccountCostConfig.Create().
			SetAccountID(config.AccountID).
			SetAccountType(config.AccountType).
			SetAPIMultiplierMode(config.APIMultiplierMode)
		if config.Name != "" {
			builder.SetName(config.Name)
		}
		if config.Platform != "" {
			builder.SetPlatform(config.Platform)
		}
		builder.SetNillableOauthAccountCost(config.OAuthAccountCost).
			SetNillableAPIMultiplierOverride(config.APIMultiplierOverride).
			SetNillableSyncedAPIMultiplier(config.SyncedAPIMultiplier).
			SetNillableLastSyncedAt(config.LastSyncedAt)
		entity, err = builder.Save(ctx)
		if err != nil {
			return config, err
		}
		return accountCostConfigFromEntity(entity), nil
	}
	update := entity.Update().SetAccountType(config.AccountType).SetAPIMultiplierMode(config.APIMultiplierMode)
	if config.Name != "" {
		update.SetName(config.Name)
	}
	if config.Platform != "" {
		update.SetPlatform(config.Platform)
	}
	if config.OAuthAccountCost == nil {
		update.ClearOauthAccountCost()
	} else {
		update.SetOauthAccountCost(*config.OAuthAccountCost)
	}
	if config.APIMultiplierOverride == nil {
		update.ClearAPIMultiplierOverride()
	} else {
		update.SetAPIMultiplierOverride(*config.APIMultiplierOverride)
	}
	if config.SyncedAPIMultiplier != nil {
		update.SetSyncedAPIMultiplier(*config.SyncedAPIMultiplier)
	}
	if config.LastSyncedAt != nil {
		update.SetLastSyncedAt(*config.LastSyncedAt)
	}
	entity, err = update.Save(ctx)
	if err != nil {
		return config, err
	}
	return accountCostConfigFromEntity(entity), nil
}

func (s *EntCostConfigStore) SyncAccounts(ctx context.Context, accounts []ops.Sub2APIAccount) error {
	if s == nil || s.client == nil {
		return errors.New("cost config store is unavailable")
	}
	now := time.Now()
	for _, account := range accounts {
		entity, err := s.client.AccountCostConfig.Query().Where(accountcostconfig.AccountIDEQ(account.ID)).Only(ctx)
		if ent.IsNotFound(err) {
			_, err = s.client.AccountCostConfig.Create().
				SetAccountID(account.ID).
				SetAccountType(account.Type).
				SetName(account.Name).
				SetPlatform(account.Platform).
				SetSyncedAPIMultiplier(account.RateMultiplier).
				SetLastSyncedAt(now).
				Save(ctx)
		} else if err == nil {
			update := entity.Update().SetAccountType(account.Type).SetName(account.Name).SetPlatform(account.Platform).SetSyncedAPIMultiplier(account.RateMultiplier).SetLastSyncedAt(now)
			_, err = update.Save(ctx)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func accountCostConfigFromEntity(entity *ent.AccountCostConfig) ops.AccountCostConfig {
	return ops.AccountCostConfig{
		AccountID: entity.AccountID, AccountType: entity.AccountType, Name: entity.Name, Platform: entity.Platform,
		OAuthAccountCost: entity.OauthAccountCost, APIMultiplierOverride: entity.APIMultiplierOverride,
		SyncedAPIMultiplier: entity.SyncedAPIMultiplier, APIMultiplierMode: entity.APIMultiplierMode, LastSyncedAt: entity.LastSyncedAt,
	}
}
