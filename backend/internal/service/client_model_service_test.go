package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"aux-system/internal/integration"

	"github.com/stretchr/testify/require"
)

type clientModelSourceStub struct {
	calls  []string
	groups []integration.Sub2APIPlazaGroup
	errFor map[string]error
}

func (s *clientModelSourceStub) ListModelPlaza(_ context.Context, token string) ([]integration.Sub2APIPlazaGroup, error) {
	s.calls = append(s.calls, token)
	if err := s.errFor[token]; err != nil {
		return nil, err
	}
	return s.groups, nil
}

func TestClientModelServiceAggregatesModelsAcrossGroups(t *testing.T) {
	source := &clientModelSourceStub{groups: []integration.Sub2APIPlazaGroup{
		{Platform: "openai", Models: []integration.Sub2APIPlazaModel{{Name: "gpt-6-astra"}, {Name: " "}}},
		{Platform: "antigravity", Models: []integration.Sub2APIPlazaModel{{Name: "claude-opus-5", Platform: "antigravity"}}},
		{Platform: "anthropic", Models: []integration.Sub2APIPlazaModel{{Name: "claude-opus-5", Platform: "anthropic"}}},
	}}

	list, err := NewClientModelService(source).List(context.Background(), "")

	require.NoError(t, err)
	require.Equal(t, []ClientModel{
		{ID: "claude-opus-5", Platforms: []string{"anthropic", "antigravity"}},
		{ID: "gpt-6-astra", Platforms: []string{"openai"}},
	}, list.Items)
}

func TestClientModelServiceCachesOnlySuccessfulAnonymousLists(t *testing.T) {
	source := &clientModelSourceStub{errFor: map[string]error{"": integration.ErrSub2APIUnreachable}}
	svc := NewClientModelService(source)
	now := time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return now }

	_, err := svc.List(context.Background(), "")
	require.ErrorIs(t, err, integration.ErrSub2APIUnreachable)

	source.errFor = nil
	source.groups = []integration.Sub2APIPlazaGroup{{Platform: "openai", Models: []integration.Sub2APIPlazaModel{{Name: "gpt-6-astra"}}}}
	_, err = svc.List(context.Background(), "")
	require.NoError(t, err)
	_, err = svc.List(context.Background(), "")
	require.NoError(t, err)
	require.Len(t, source.calls, 2, "a failed read must not be cached; a successful one must be")

	now = now.Add(clientModelCacheTTL)
	_, err = svc.List(context.Background(), "")
	require.NoError(t, err)
	require.Len(t, source.calls, 3)
}

func TestClientModelServiceUsesTokenAndFallsBackWhenItExpires(t *testing.T) {
	source := &clientModelSourceStub{
		groups: []integration.Sub2APIPlazaGroup{{Platform: "anthropic", Models: []integration.Sub2APIPlazaModel{{Name: "claude-opus-5"}}}},
		errFor: map[string]error{"expired": integration.ErrInvalidToken, "broken": integration.ErrSub2APIUnreachable},
	}
	svc := NewClientModelService(source)

	_, err := svc.List(context.Background(), "valid")
	require.NoError(t, err)
	_, err = svc.List(context.Background(), "valid")
	require.NoError(t, err)
	list, err := svc.List(context.Background(), "expired")
	require.NoError(t, err)
	require.Equal(t, "claude-opus-5", list.Items[0].ID)
	require.Equal(t, []string{"valid", "valid", "expired", ""}, source.calls, "user lists are never cached")

	_, err = svc.List(context.Background(), "broken")
	require.True(t, errors.Is(err, integration.ErrSub2APIUnreachable))
}
