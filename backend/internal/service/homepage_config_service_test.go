package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type memoryHomepageConfigStore struct {
	config *HomepageConfig
}

func (s *memoryHomepageConfigStore) GetHomepageConfig(_ context.Context) (*HomepageConfig, error) {
	return s.config, nil
}

func (s *memoryHomepageConfigStore) SaveHomepageConfig(_ context.Context, config HomepageConfig) error {
	s.config = &config
	return nil
}

func TestHomepageConfigService_GetDefaultsWhenEmpty(t *testing.T) {
	svc := NewHomepageConfigService(&memoryHomepageConfigStore{})

	config, err := svc.Get(context.Background())

	require.NoError(t, err)
	assert.Equal(t, "TERALEMO", config.HeroTitle)
	assert.Empty(t, config.TrustedPartners)
}

func TestHomepageConfigService_SaveNormalizesPartnersAndLinks(t *testing.T) {
	store := &memoryHomepageConfigStore{}
	svc := NewHomepageConfigService(store)

	saved, err := svc.Save(context.Background(), HomepageConfig{
		HeroLabel:       " 生产级网关 ",
		HeroTitle:       "新的首页标题",
		HeroDescription: "新的首页简介",
		PrimaryCTA:      "开始接入",
		PrimaryHref:     "javascript:alert(1)",
		DocsCTA:         "阅读文档",
		DocsHref:        "https://docs.example.com",
		ConsoleHref:     "javascript:alert(1)",
		TrustedPartners: []TrustedPartner{
			{Name: " Alpha ", LogoURL: "javascript:bad", LinkURL: "https://alpha.example.com"},
			{Name: "   ", LogoURL: "https://example.com/ignored.svg"},
		},
	})

	require.NoError(t, err)
	assert.Equal(t, "生产级网关", saved.HeroLabel)
	assert.Equal(t, "#contact", saved.PrimaryHref)
	assert.Equal(t, "https://docs.example.com", saved.DocsHref)
	assert.Equal(t, "/admin", saved.ConsoleHref)
	require.Len(t, saved.TrustedPartners, 1)
	assert.Equal(t, "Alpha", saved.TrustedPartners[0].Name)
	assert.Empty(t, saved.TrustedPartners[0].LogoURL)
	assert.Equal(t, "https://alpha.example.com", saved.TrustedPartners[0].LinkURL)
	assert.Equal(t, &saved, store.config)
}
