package service

import (
	"context"
	"encoding/json"
	"strings"
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
	assert.Equal(t, "Sub2API", config.SiteName)
	assert.Equal(t, "99.99%", config.Availability)
	assert.Equal(t, "≤ 200ms", config.FirstTokenResponseTime)
	assert.Equal(t, "≥ 85%", config.PromptCacheRate)
	assert.Equal(t, "gpt-6-astra", config.Model)
	require.NotNil(t, config.ShowDevelopersSection)
	assert.True(t, *config.ShowDevelopersSection)
	require.NotNil(t, config.ShowQuickstartSection)
	assert.True(t, *config.ShowQuickstartSection)
	assert.Empty(t, config.TrustedPartners)
	assert.Empty(t, config.Integrations)
}

func TestHomepageConfigService_MigratesLegacyDefaultModel(t *testing.T) {
	store := &memoryHomepageConfigStore{config: &HomepageConfig{Model: legacyHomepageModel}}
	svc := NewHomepageConfigService(store)

	config, err := svc.Get(context.Background())

	require.NoError(t, err)
	assert.Equal(t, "gpt-6-astra", config.Model)
}

func TestHomepageConfigService_NavigationCompatibility(t *testing.T) {
	for _, test := range []struct {
		name string
		data string
		want []HomepageNavigationItem
	}{
		{name: "legacy", data: `{"siteName":"Legacy"}`, want: DefaultHomepageConfig().NavigationItems},
		{name: "empty", data: `{"navigationItems":[]}`, want: []HomepageNavigationItem{}},
		{name: "custom", data: `{"navigationItems":[{"label":"文档","href":"https://docs.example.com"}]}`, want: []HomepageNavigationItem{{Label: "文档", Href: "https://docs.example.com"}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			var config HomepageConfig
			require.NoError(t, json.Unmarshal([]byte(test.data), &config))
			store := &memoryHomepageConfigStore{config: &config}
			svc := NewHomepageConfigService(store)
			saved, err := svc.Save(context.Background(), config)
			require.NoError(t, err)
			encoded, err := json.Marshal(saved)
			require.NoError(t, err)
			require.NoError(t, json.Unmarshal(encoded, &config))
			store.config = &config
			loaded, err := svc.Get(context.Background())
			require.NoError(t, err)
			assert.Equal(t, test.want, loaded.NavigationItems)
		})
	}
}

func TestHomepageConfigService_NormalizesNavigationAndPreservesOrder(t *testing.T) {
	svc := NewHomepageConfigService(&memoryHomepageConfigStore{})
	saved, err := svc.Save(context.Background(), HomepageConfig{NavigationItems: []HomepageNavigationItem{
		{Label: " 文档 ", Href: " https://docs.example.com "},
		{Label: "脚本", Href: "javascript:alert(1)"},
		{Label: "协议相对地址", Href: "//example.com"},
		{Label: "反斜杠", Href: `/\example.com`},
		{Label: " ", Href: "/ignored"},
		{Label: "缺少地址", Href: ""},
		{Label: "服务指标", Href: "#metrics"},
		{Label: "价格", Href: "/pricing"},
	}})
	require.NoError(t, err)
	assert.Equal(t, []HomepageNavigationItem{
		{Label: "文档", Href: "https://docs.example.com"},
		{Label: "服务指标", Href: "#metrics"},
		{Label: "价格", Href: "/pricing"},
	}, saved.NavigationItems)
}

func TestHomepageConfigService_BoundsNavigation(t *testing.T) {
	items := make([]HomepageNavigationItem, 10)
	for index := range items {
		items[index] = HomepageNavigationItem{Label: strings.Repeat("菜", 30), Href: "/guide"}
	}
	svc := NewHomepageConfigService(&memoryHomepageConfigStore{})
	saved, err := svc.Save(context.Background(), HomepageConfig{NavigationItems: items})
	require.NoError(t, err)
	require.Len(t, saved.NavigationItems, 8)
	assert.Equal(t, strings.Repeat("菜", 24), saved.NavigationItems[0].Label)
}

func TestHomepageConfigService_DefaultsDevelopersSectionForLegacyConfig(t *testing.T) {
	store := &memoryHomepageConfigStore{config: &HomepageConfig{SiteName: "Legacy"}}
	svc := NewHomepageConfigService(store)

	config, err := svc.Get(context.Background())

	require.NoError(t, err)
	require.NotNil(t, config.ShowDevelopersSection)
	assert.True(t, *config.ShowDevelopersSection)
}

func TestHomepageConfigService_DefaultsQuickstartSectionForLegacyConfig(t *testing.T) {
	store := &memoryHomepageConfigStore{config: &HomepageConfig{SiteName: "Legacy"}}
	svc := NewHomepageConfigService(store)

	config, err := svc.Get(context.Background())

	require.NoError(t, err)
	require.NotNil(t, config.ShowQuickstartSection)
	assert.True(t, *config.ShowQuickstartSection)
}

func TestHomepageConfigService_PersistsDevelopersDocsURL(t *testing.T) {
	for _, test := range []struct {
		name  string
		value string
		want  string
	}{
		{name: "external", value: " https://docs.example.com/quickstart ", want: "https://docs.example.com/quickstart"},
		{name: "internal", value: "/guide", want: "/guide"},
		{name: "anchor", value: "#quickstart", want: "#quickstart"},
		{name: "empty"},
		{name: "unsafe", value: "javascript:alert(1)"},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc := NewHomepageConfigService(&memoryHomepageConfigStore{})
			_, err := svc.Save(context.Background(), HomepageConfig{
				DevelopersDocsURL: test.value,
				DocumentationURL:  "https://docs.example.com",
			})
			require.NoError(t, err)
			loaded, err := svc.Get(context.Background())
			require.NoError(t, err)
			assert.Equal(t, test.want, loaded.DevelopersDocsURL)
			assert.Equal(t, "https://docs.example.com", loaded.DocumentationURL)
		})
	}
}

func TestHomepageConfigService_SaveNormalizesPartnersAndLinks(t *testing.T) {
	store := &memoryHomepageConfigStore{}
	svc := NewHomepageConfigService(store)
	showDevelopersSection := false
	showQuickstartSection := false

	saved, err := svc.Save(context.Background(), HomepageConfig{
		SiteName:                          " My Sub2API ",
		SystemDomain:                      " https://gateway.example.com/ ",
		SiteLogoURL:                       "https://example.com/logo.svg",
		HeroLabel:                         " 生产级网关 ",
		HeroTitle:                         "新的首页标题",
		HeroDescription:                   "新的首页简介",
		Availability:                      "99.95%",
		AvailabilityDescription:           "可用性说明",
		FirstTokenResponseTime:            "≤ 180ms",
		FirstTokenResponseTimeDescription: "首 Token 说明",
		PromptCacheRate:                   "≥ 80%",
		PromptCacheRateDescription:        "缓存率说明",
		PrimaryCTA:                        "开始接入",
		PrimaryHref:                       "javascript:alert(1)",
		DocsCTA:                           "阅读文档",
		DocsHref:                          "https://docs.example.com",
		ConsoleHref:                       "javascript:alert(1)",
		ShowDevelopersSection:             &showDevelopersSection,
		ShowQuickstartSection:             &showQuickstartSection,
		TrustedPartners: []TrustedPartner{
			{Name: " Alpha ", LogoURL: "javascript:bad", LinkURL: "https://alpha.example.com"},
			{Name: "   ", LogoURL: "https://example.com/ignored.svg"},
		},
		Integrations: []IntegrationApp{
			{Name: " OpenAI ", LogoURL: "https://example.com/openai.svg", DocumentationURL: "https://docs.example.com/openai"},
			{Name: " Unsafe Logo ", LogoURL: "javascript:bad", DocumentationURL: "javascript:bad"},
			{Name: "   ", LogoURL: "https://example.com/ignored.svg"},
		},
	})

	require.NoError(t, err)
	assert.Equal(t, "生产级网关", saved.HeroLabel)
	assert.Equal(t, "My Sub2API", saved.SiteName)
	assert.Equal(t, "https://gateway.example.com/", saved.SystemDomain)
	assert.Equal(t, "https://example.com/logo.svg", saved.SiteLogoURL)
	assert.Equal(t, "99.95%", saved.Availability)
	assert.Equal(t, "可用性说明", saved.AvailabilityDescription)
	assert.Equal(t, "≤ 180ms", saved.FirstTokenResponseTime)
	assert.Equal(t, "首 Token 说明", saved.FirstTokenResponseTimeDescription)
	assert.Equal(t, "≥ 80%", saved.PromptCacheRate)
	assert.Equal(t, "缓存率说明", saved.PromptCacheRateDescription)
	assert.Equal(t, "/login", saved.PrimaryHref)
	assert.Equal(t, "https://docs.example.com", saved.DocsHref)
	assert.Equal(t, "/admin", saved.ConsoleHref)
	require.NotNil(t, saved.ShowDevelopersSection)
	assert.False(t, *saved.ShowDevelopersSection)
	require.NotNil(t, saved.ShowQuickstartSection)
	assert.False(t, *saved.ShowQuickstartSection)
	require.Len(t, saved.TrustedPartners, 1)
	assert.Equal(t, "Alpha", saved.TrustedPartners[0].Name)
	assert.Empty(t, saved.TrustedPartners[0].LogoURL)
	assert.Equal(t, "https://alpha.example.com", saved.TrustedPartners[0].LinkURL)
	require.Len(t, saved.Integrations, 2)
	assert.Equal(t, "OpenAI", saved.Integrations[0].Name)
	assert.Equal(t, "https://example.com/openai.svg", saved.Integrations[0].LogoURL)
	assert.Equal(t, "https://docs.example.com/openai", saved.Integrations[0].DocumentationURL)
	assert.Empty(t, saved.Integrations[1].LogoURL)
	assert.Empty(t, saved.Integrations[1].DocumentationURL)
	assert.Equal(t, &saved, store.config)
}

func TestHomepageConfigService_PersistsSiteLogoURL(t *testing.T) {
	for _, test := range []struct {
		name  string
		value string
		want  string
	}{
		{name: "external", value: " https://cdn.example.com/logo.svg ", want: "https://cdn.example.com/logo.svg"},
		{name: "uploaded asset", value: "/api/aux/assets/2", want: "/api/aux/assets/2"},
		{name: "protocol relative", value: "//cdn.example.com/logo.svg"},
		{name: "unsafe scheme", value: "javascript:alert(1)"},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := &memoryHomepageConfigStore{}
			svc := NewHomepageConfigService(store)
			saved, err := svc.Save(context.Background(), HomepageConfig{SiteLogoURL: test.value})
			require.NoError(t, err)
			assert.Equal(t, test.want, saved.SiteLogoURL)

			loaded, err := svc.Get(context.Background())
			require.NoError(t, err)
			assert.Equal(t, test.want, loaded.SiteLogoURL)
		})
	}
}
