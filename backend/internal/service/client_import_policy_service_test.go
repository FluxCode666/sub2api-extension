package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type memoryClientImportPolicyStore struct {
	policy *ClientImportPolicy
	saves  int
}

func (s *memoryClientImportPolicyStore) GetClientImportPolicy(_ context.Context) (*ClientImportPolicy, error) {
	return s.policy, nil
}

func (s *memoryClientImportPolicyStore) SaveClientImportPolicy(_ context.Context, policy ClientImportPolicy) error {
	s.policy = &policy
	s.saves++
	return nil
}

func int64Ptr(value int64) *int64 { return &value }

func TestClientImportPolicy_DefaultAllowsEveryClientForGroupedKeys(t *testing.T) {
	svc := NewClientImportPolicyService(&memoryClientImportPolicyStore{})

	policy, err := svc.Get(context.Background())

	require.NoError(t, err)
	assert.Empty(t, policy.Platforms)
	assert.Empty(t, policy.Groups)
	assert.Equal(t, ClientImportClientIDs, policy.AllowedClients(int64Ptr(5), "anthropic"))
	assert.Empty(t, policy.AllowedClients(nil, "anthropic"), "ungrouped keys can never import")
	assert.Equal(t, ClientImportMultiModelCapableIDs, policy.MultiModelClients, "every multi-model capable client is enabled by default")
}

func TestClientImportPolicy_GroupRuleOverridesPlatformRule(t *testing.T) {
	policy := ClientImportPolicy{
		Platforms: []ClientImportPlatformRule{{Platform: "anthropic", AllowedClients: []string{"claude-code", "claude-desktop"}}},
		Groups:    []ClientImportGroupRule{{GroupID: 9, AllowedClients: []string{}}},
	}

	assert.Equal(t, []string{"claude-code", "claude-desktop"}, policy.AllowedClients(int64Ptr(5), "Anthropic"))
	assert.Empty(t, policy.AllowedClients(int64Ptr(9), "anthropic"), "an empty group rule blocks every client")
	assert.Equal(t, ClientImportClientIDs, policy.AllowedClients(int64Ptr(5), "openai"), "platforms without rules stay unrestricted")
	assert.Equal(t, ClientImportClientIDs, policy.AllowedClients(int64Ptr(5), ""))
}

func TestClientImportPolicy_AllowedClientsReturnsCopies(t *testing.T) {
	policy := ClientImportPolicy{Groups: []ClientImportGroupRule{{GroupID: 1, AllowedClients: []string{"codex"}}}}

	allowed := policy.AllowedClients(int64Ptr(1), "openai")
	allowed[0] = "pi"

	assert.Equal(t, []string{"codex"}, policy.Groups[0].AllowedClients)
}

func TestClientImportPolicyService_SaveNormalizesRules(t *testing.T) {
	store := &memoryClientImportPolicyStore{}
	svc := NewClientImportPolicyService(store)

	saved, err := svc.Save(context.Background(), ClientImportPolicy{
		Platforms: []ClientImportPlatformRule{
			{Platform: " OpenAI ", AllowedClients: []string{"pi", "codex", "pi"}},
			{Platform: "anthropic", AllowedClients: nil},
		},
		Groups: []ClientImportGroupRule{
			{GroupID: 8, AllowedClients: []string{"chatbox"}},
			{GroupID: 3, AllowedClients: []string{"workbuddy", "claude-code"}},
		},
		MultiModelClients: []string{"pi", " zcode ", "pi"},
	})

	require.NoError(t, err)
	assert.Equal(t, []ClientImportPlatformRule{
		{Platform: "anthropic", AllowedClients: []string{}},
		{Platform: "openai", AllowedClients: []string{"codex", "pi"}},
	}, saved.Platforms)
	assert.Equal(t, []ClientImportGroupRule{
		{GroupID: 3, AllowedClients: []string{"claude-code", "workbuddy"}},
		{GroupID: 8, AllowedClients: []string{"chatbox"}},
	}, saved.Groups)
	assert.Equal(t, []string{"zcode", "pi"}, saved.MultiModelClients)
	require.NotNil(t, store.policy)
	assert.Equal(t, saved, *store.policy)
}

func TestClientImportPolicyService_SaveRejectsInvalidRules(t *testing.T) {
	cases := map[string]ClientImportPolicy{
		"unknown client":               {Platforms: []ClientImportPlatformRule{{Platform: "openai", AllowedClients: []string{"cursor"}}}},
		"invalid platform":             {Platforms: []ClientImportPlatformRule{{Platform: "open ai", AllowedClients: []string{}}}},
		"empty platform":               {Platforms: []ClientImportPlatformRule{{Platform: " ", AllowedClients: []string{}}}},
		"duplicate platform":           {Platforms: []ClientImportPlatformRule{{Platform: "openai"}, {Platform: "OPENAI"}}},
		"invalid group":                {Groups: []ClientImportGroupRule{{GroupID: 0}}},
		"duplicate group":              {Groups: []ClientImportGroupRule{{GroupID: 2}, {GroupID: 2}}},
		"unknown multi-model client":   {MultiModelClients: []string{"cursor"}},
		"single-model client multiple": {MultiModelClients: []string{"pi", "codex"}},
	}
	for name, policy := range cases {
		t.Run(name, func(t *testing.T) {
			store := &memoryClientImportPolicyStore{}
			_, err := NewClientImportPolicyService(store).Save(context.Background(), policy)

			require.ErrorIs(t, err, ErrInvalidClientImportPolicy)
			assert.Zero(t, store.saves)
		})
	}
}

func TestClientImportPolicyService_GetNormalizesStoredPolicy(t *testing.T) {
	store := &memoryClientImportPolicyStore{policy: &ClientImportPolicy{
		Platforms: []ClientImportPlatformRule{{Platform: "Gemini", AllowedClients: []string{"gemini", "gemini"}}},
	}}

	policy, err := NewClientImportPolicyService(store).Get(context.Background())

	require.NoError(t, err)
	assert.Equal(t, []ClientImportPlatformRule{{Platform: "gemini", AllowedClients: []string{"gemini"}}}, policy.Platforms)
	assert.NotNil(t, policy.Groups)
}

func TestClientImportPolicyService_MultiModelClientsKeepExplicitEmptyList(t *testing.T) {
	store := &memoryClientImportPolicyStore{}
	svc := NewClientImportPolicyService(store)

	saved, err := svc.Save(context.Background(), ClientImportPolicy{MultiModelClients: []string{}})
	require.NoError(t, err)
	assert.Equal(t, []string{}, saved.MultiModelClients)

	loaded, err := svc.Get(context.Background())
	require.NoError(t, err)
	assert.Equal(t, []string{}, loaded.MultiModelClients, "an explicit empty list disables multi-model for every client")
	assert.Empty(t, loaded.EffectiveMultiModelClients())
}

func TestClientImportPolicyService_LegacyPolicyEnablesEveryMultiModelClient(t *testing.T) {
	store := &memoryClientImportPolicyStore{policy: &ClientImportPolicy{
		Groups: []ClientImportGroupRule{{GroupID: 4, AllowedClients: []string{"pi"}}},
	}}

	policy, err := NewClientImportPolicyService(store).Get(context.Background())

	require.NoError(t, err)
	assert.Equal(t, ClientImportMultiModelCapableIDs, policy.MultiModelClients)
	assert.Equal(t, ClientImportMultiModelCapableIDs, ClientImportPolicy{}.EffectiveMultiModelClients())
}
