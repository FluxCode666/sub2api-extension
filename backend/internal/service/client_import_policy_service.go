package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strings"

	"aux-system/ent"
	"aux-system/ent/systemmeta"
)

// ClientImportPolicyKey 是客户端导入限制在 system_meta 中的键。
// 该配置只由管理端读写，不与公开读取的 homepage.config 合并。
const ClientImportPolicyKey = "client_import.policy"

const (
	clientImportPolicyMaxPlatforms = 32
	clientImportPolicyMaxGroups    = 500
)

// ErrInvalidClientImportPolicy 表示提交的导入限制无法保存。
var ErrInvalidClientImportPolicy = errors.New("invalid client import policy")

// ClientImportClientIDs 与前端 client-import.ts 的 ClientImportTargetId 保持一致，顺序即展示顺序。
var ClientImportClientIDs = []string{
	"claude-code",
	"claude-desktop",
	"codex",
	"gemini",
	"grok-build",
	"opencode",
	"openclaw",
	"hermes",
	"cherry-studio",
	"chatbox",
	"zcode",
	"workbuddy",
	"pi",
}

// ClientImportMultiModelCapableIDs 是导入配置本身能写入多个模型 ID 的客户端：
// Chatbox 的导入配置与 ZCode、WorkBuddy、Pi 的配置文件都使用模型数组。
// CC Switch 深度链接只有单个 model 参数，Cherry Studio 导入数据不含模型，因此不在其中。
var ClientImportMultiModelCapableIDs = []string{"chatbox", "zcode", "workbuddy", "pi"}

var clientImportPlatformPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,31}$`)

// ClientImportPlatformRule 限制某个 Sub2API 分组平台可导入的客户端。
type ClientImportPlatformRule struct {
	Platform       string   `json:"platform"`
	AllowedClients []string `json:"allowedClients"`
}

// ClientImportGroupRule 限制某个 Sub2API 分组可导入的客户端，优先于平台规则。
type ClientImportGroupRule struct {
	GroupID        int64    `json:"groupId"`
	AllowedClients []string `json:"allowedClients"`
}

// ClientImportPolicy 是客户端导入的白名单配置。
// 没有规则的平台或分组允许导入全部客户端；规则中的空列表表示不允许导入任何客户端。
type ClientImportPolicy struct {
	Platforms []ClientImportPlatformRule `json:"platforms"`
	Groups    []ClientImportGroupRule    `json:"groups"`
	// MultiModelClients 是允许在导入页配置多个候选模型 ID 的客户端，只能取自 ClientImportMultiModelCapableIDs。
	// 旧配置没有该字段（nil）时视为全部可多选客户端均开启；空数组表示全部只允许单个模型。
	MultiModelClients []string `json:"multiModelClients"`
}

// DefaultClientImportPolicy 返回不做任何限制、可多选客户端全部开启的默认配置。
func DefaultClientImportPolicy() ClientImportPolicy {
	return ClientImportPolicy{
		Platforms:         []ClientImportPlatformRule{},
		Groups:            []ClientImportGroupRule{},
		MultiModelClients: append([]string{}, ClientImportMultiModelCapableIDs...),
	}
}

// EffectiveMultiModelClients 返回允许配置多个模型 ID 的客户端副本；未设置时按默认全部开启处理。
func (p ClientImportPolicy) EffectiveMultiModelClients() []string {
	if p.MultiModelClients == nil {
		return append([]string{}, ClientImportMultiModelCapableIDs...)
	}
	return append([]string{}, p.MultiModelClients...)
}

// AllowedClients 解析某个 API Key 可导入的客户端。
// 未绑定分组的密钥不允许导入；分组规则优先于其平台规则；都未配置时允许全部客户端。
func (p ClientImportPolicy) AllowedClients(groupID *int64, platform string) []string {
	if groupID == nil {
		return []string{}
	}
	for _, rule := range p.Groups {
		if rule.GroupID == *groupID {
			return append([]string{}, rule.AllowedClients...)
		}
	}
	normalized := strings.ToLower(strings.TrimSpace(platform))
	if normalized != "" {
		for _, rule := range p.Platforms {
			if rule.Platform == normalized {
				return append([]string{}, rule.AllowedClients...)
			}
		}
	}
	return append([]string{}, ClientImportClientIDs...)
}

// NormalizeClientImportPolicy 校验并规范化配置：平台小写、客户端去重并按标准顺序排列、规则按键去重排序；
// 未提交多模型客户端时使用默认值（全部可多选客户端开启）。
func NormalizeClientImportPolicy(policy ClientImportPolicy) (ClientImportPolicy, error) {
	if len(policy.Platforms) > clientImportPolicyMaxPlatforms {
		return ClientImportPolicy{}, fmt.Errorf("%w: too many platform rules", ErrInvalidClientImportPolicy)
	}
	if len(policy.Groups) > clientImportPolicyMaxGroups {
		return ClientImportPolicy{}, fmt.Errorf("%w: too many group rules", ErrInvalidClientImportPolicy)
	}

	result := DefaultClientImportPolicy()
	seenPlatforms := make(map[string]struct{}, len(policy.Platforms))
	for _, rule := range policy.Platforms {
		platform := strings.ToLower(strings.TrimSpace(rule.Platform))
		if !clientImportPlatformPattern.MatchString(platform) {
			return ClientImportPolicy{}, fmt.Errorf("%w: invalid platform %q", ErrInvalidClientImportPolicy, rule.Platform)
		}
		if _, ok := seenPlatforms[platform]; ok {
			return ClientImportPolicy{}, fmt.Errorf("%w: duplicate platform %q", ErrInvalidClientImportPolicy, platform)
		}
		seenPlatforms[platform] = struct{}{}
		clients, err := normalizeClientImportClients(rule.AllowedClients)
		if err != nil {
			return ClientImportPolicy{}, err
		}
		result.Platforms = append(result.Platforms, ClientImportPlatformRule{Platform: platform, AllowedClients: clients})
	}

	seenGroups := make(map[int64]struct{}, len(policy.Groups))
	for _, rule := range policy.Groups {
		if rule.GroupID <= 0 {
			return ClientImportPolicy{}, fmt.Errorf("%w: invalid group id %d", ErrInvalidClientImportPolicy, rule.GroupID)
		}
		if _, ok := seenGroups[rule.GroupID]; ok {
			return ClientImportPolicy{}, fmt.Errorf("%w: duplicate group id %d", ErrInvalidClientImportPolicy, rule.GroupID)
		}
		seenGroups[rule.GroupID] = struct{}{}
		clients, err := normalizeClientImportClients(rule.AllowedClients)
		if err != nil {
			return ClientImportPolicy{}, err
		}
		result.Groups = append(result.Groups, ClientImportGroupRule{GroupID: rule.GroupID, AllowedClients: clients})
	}

	if policy.MultiModelClients != nil {
		clients, err := normalizeClientImportClients(policy.MultiModelClients)
		if err != nil {
			return ClientImportPolicy{}, err
		}
		result.MultiModelClients = make([]string, 0, len(clients))
		for _, client := range clients {
			if !slices.Contains(ClientImportMultiModelCapableIDs, client) {
				return ClientImportPolicy{}, fmt.Errorf("%w: client %q cannot use multiple models", ErrInvalidClientImportPolicy, client)
			}
			result.MultiModelClients = append(result.MultiModelClients, client)
		}
	}

	sort.Slice(result.Platforms, func(i, j int) bool { return result.Platforms[i].Platform < result.Platforms[j].Platform })
	sort.Slice(result.Groups, func(i, j int) bool { return result.Groups[i].GroupID < result.Groups[j].GroupID })
	return result, nil
}

func normalizeClientImportClients(clients []string) ([]string, error) {
	requested := make(map[string]struct{}, len(clients))
	for _, client := range clients {
		requested[strings.TrimSpace(client)] = struct{}{}
	}
	result := make([]string, 0, len(requested))
	for _, id := range ClientImportClientIDs {
		if _, ok := requested[id]; ok {
			result = append(result, id)
			delete(requested, id)
		}
	}
	for unknown := range requested {
		return nil, fmt.Errorf("%w: unknown client %q", ErrInvalidClientImportPolicy, unknown)
	}
	return result, nil
}

// ClientImportPolicyStore 持久化客户端导入限制。
type ClientImportPolicyStore interface {
	GetClientImportPolicy(ctx context.Context) (*ClientImportPolicy, error)
	SaveClientImportPolicy(ctx context.Context, policy ClientImportPolicy) error
}

// ClientImportPolicyService 负责读取、校验和保存客户端导入限制。
type ClientImportPolicyService struct {
	store ClientImportPolicyStore
}

func NewClientImportPolicyService(store ClientImportPolicyStore) *ClientImportPolicyService {
	return &ClientImportPolicyService{store: store}
}

// Get 返回当前配置；尚未保存过时返回不限制的默认配置。
func (s *ClientImportPolicyService) Get(ctx context.Context) (ClientImportPolicy, error) {
	if s == nil || s.store == nil {
		return DefaultClientImportPolicy(), nil
	}
	policy, err := s.store.GetClientImportPolicy(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return DefaultClientImportPolicy(), nil
		}
		return ClientImportPolicy{}, err
	}
	if policy == nil {
		return DefaultClientImportPolicy(), nil
	}
	normalized, err := NormalizeClientImportPolicy(*policy)
	if err != nil {
		return ClientImportPolicy{}, fmt.Errorf("stored client import policy is invalid: %w", err)
	}
	return normalized, nil
}

// Save 校验后保存配置并返回规范化结果。
func (s *ClientImportPolicyService) Save(ctx context.Context, policy ClientImportPolicy) (ClientImportPolicy, error) {
	normalized, err := NormalizeClientImportPolicy(policy)
	if err != nil {
		return ClientImportPolicy{}, err
	}
	if s == nil || s.store == nil {
		return ClientImportPolicy{}, errors.New("client import policy store is unavailable")
	}
	if err := s.store.SaveClientImportPolicy(ctx, normalized); err != nil {
		return ClientImportPolicy{}, err
	}
	return normalized, nil
}

type entClientImportPolicyStore struct {
	client *ent.Client
}

func NewEntClientImportPolicyStore(client *ent.Client) ClientImportPolicyStore {
	return &entClientImportPolicyStore{client: client}
}

func (s *entClientImportPolicyStore) GetClientImportPolicy(ctx context.Context) (*ClientImportPolicy, error) {
	meta, err := s.client.SystemMeta.Query().Where(systemmeta.KeyEQ(ClientImportPolicyKey)).Only(ctx)
	if err != nil {
		return nil, err
	}
	var policy ClientImportPolicy
	if err := json.Unmarshal([]byte(meta.Value), &policy); err != nil {
		return nil, err
	}
	return &policy, nil
}

func (s *entClientImportPolicyStore) SaveClientImportPolicy(ctx context.Context, policy ClientImportPolicy) error {
	encoded, err := json.Marshal(policy)
	if err != nil {
		return err
	}
	meta, err := s.client.SystemMeta.Query().Where(systemmeta.KeyEQ(ClientImportPolicyKey)).Only(ctx)
	if err != nil {
		if !ent.IsNotFound(err) {
			return err
		}
		_, err = s.client.SystemMeta.Create().SetKey(ClientImportPolicyKey).SetValue(string(encoded)).Save(ctx)
		return err
	}
	_, err = meta.Update().SetValue(string(encoded)).Save(ctx)
	return err
}
