package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

type memoryTobHomepageConfigStore struct{ config *TobHomepageConfig }

func (s *memoryTobHomepageConfigStore) GetTobHomepageConfig(context.Context) (*TobHomepageConfig, error) {
	return s.config, nil
}

func (s *memoryTobHomepageConfigStore) SaveTobHomepageConfig(_ context.Context, config TobHomepageConfig) error {
	s.config = &config
	return nil
}

type memoryHomepageConfigReader struct{ config HomepageConfig }

func (r memoryHomepageConfigReader) Get(context.Context) (HomepageConfig, error) {
	return r.config, nil
}

func TestTobHomepageConfigService_ClonesCurrentHomepageWhenMissing(t *testing.T) {
	homepage := DefaultHomepageConfig()
	homepage.SiteName = "企业测试站"
	homepage.HeroTitle = "现有官网标题"
	homepage.TrustedPartners = []TrustedPartner{{Name: "现有合作伙伴"}}

	config, err := NewTobHomepageConfigService(&memoryTobHomepageConfigStore{}, memoryHomepageConfigReader{config: homepage}).Get(context.Background())
	require.NoError(t, err)
	require.Equal(t, homepage.SiteName, config.SiteName)
	require.Equal(t, homepage.HeroTitle, config.HeroTitle)
	require.Equal(t, homepage.TrustedPartners, config.TrustedPartners)
	require.Contains(t, config.NavigationItems, HomepageNavigationItem{Label: "全球网络", Href: "#network"})
	require.Len(t, config.PrimaryServers, 1)
	require.NotNil(t, config.MapSettings)
	require.True(t, config.MapSettings.ShowNodeLabels)
	require.True(t, config.MapSettings.FlowAnimation)
}

func TestTobHomepageConfigService_PreservesNavigation(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected []HomepageNavigationItem
	}{
		{
			name:  "removed network menu",
			input: `{"navigationItems":[{"label":"数据安全","href":"#security"},{"label":"企业能力","href":"#capabilities"}]}`,
			expected: []HomepageNavigationItem{
				{Label: "数据安全", Href: "#security"},
				{Label: "企业能力", Href: "#capabilities"},
			},
		},
		{
			name:  "changed network destination",
			input: `{"navigationItems":[{"label":"全球网络","href":"https://example.com/network"}]}`,
			expected: []HomepageNavigationItem{
				{Label: "全球网络", Href: "https://example.com/network"},
			},
		},
		{
			name:  "renamed network menu",
			input: `{"navigationItems":[{"label":"服务覆盖","href":"#network"}]}`,
			expected: []HomepageNavigationItem{
				{Label: "服务覆盖", Href: "#network"},
			},
		},
		{
			name:     "cleared navigation",
			input:    `{"navigationItems":[]}`,
			expected: []HomepageNavigationItem{},
		},
		{
			name:     "missing legacy navigation",
			input:    `{}`,
			expected: defaultTobNavigationItems(),
		},
		{
			name:     "null legacy navigation",
			input:    `{"navigationItems":null}`,
			expected: defaultTobNavigationItems(),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var config TobHomepageConfig
			require.NoError(t, json.Unmarshal([]byte(test.input), &config))

			t.Run("read stored config", func(t *testing.T) {
				store := &memoryTobHomepageConfigStore{config: &config}
				loaded, err := NewTobHomepageConfigService(store).Get(context.Background())
				require.NoError(t, err)
				require.Equal(t, test.expected, loaded.NavigationItems)
			})

			t.Run("save and reload", func(t *testing.T) {
				store := &memoryTobHomepageConfigStore{}
				service := NewTobHomepageConfigService(store)
				saved, err := service.Save(context.Background(), config)
				require.NoError(t, err)
				require.Equal(t, test.expected, saved.NavigationItems)
				require.Equal(t, test.expected, store.config.NavigationItems)

				// 按持久化 JSON 往返，确认空数组不会变成缺省字段并恢复默认菜单。
				encoded, err := json.Marshal(store.config)
				require.NoError(t, err)
				var persisted TobHomepageConfig
				require.NoError(t, json.Unmarshal(encoded, &persisted))
				store.config = &persisted
				loaded, err := NewTobHomepageConfigService(store).Get(context.Background())
				require.NoError(t, err)
				require.Equal(t, test.expected, loaded.NavigationItems)
			})
		})
	}
}

func TestTobHomepageConfigService_NormalizesNodes(t *testing.T) {
	service := NewTobHomepageConfigService(&memoryTobHomepageConfigStore{})
	config, err := service.Save(context.Background(), TobHomepageConfig{
		PrimaryServers: []TobMapNode{
			{Name: " 上海 ", Latitude: 31.23, Longitude: 121.47},
			{Name: "越界", Latitude: 91, Longitude: 181},
		},
		CDNLocations: []TobMapNode{{Name: "东京", Latitude: 35.68, Longitude: 139.69}},
	})
	require.NoError(t, err)
	require.Len(t, config.PrimaryServers, 1)
	require.Equal(t, "上海", config.PrimaryServers[0].Name)
	require.Len(t, config.CDNLocations, 1)
	require.Equal(t, DefaultHomepageConfig().HeroTitle, config.HeroTitle)
}

func TestTobHomepageConfigService_BoundsNodes(t *testing.T) {
	nodes := make([]TobMapNode, 40)
	for index := range nodes {
		nodes[index] = TobMapNode{Name: "node", Latitude: 0, Longitude: 0}
	}
	config, err := NewTobHomepageConfigService(&memoryTobHomepageConfigStore{}).Save(context.Background(), TobHomepageConfig{CustomerLocations: nodes})
	require.NoError(t, err)
	require.Len(t, config.CustomerLocations, 32)
}

func TestTobHomepageConfigService_NormalizesMapSettings(t *testing.T) {
	config, err := NewTobHomepageConfigService(&memoryTobHomepageConfigStore{}).Save(context.Background(), TobHomepageConfig{
		MapSettings: &TobMapSettings{
			ShowNodeLabels:     false,
			RouteCurvature:     150,
			NodeSize:           20,
			PrimaryServerColor: "#112233",
			CDNColor:           "not-a-color",
			CustomerColor:      "#ABCDEF",
			RouteStyle:         "unknown",
			FlowAnimation:      false,
		},
	})
	require.NoError(t, err)
	require.NotNil(t, config.MapSettings)
	require.False(t, config.MapSettings.ShowNodeLabels)
	require.Equal(t, float64(100), config.MapSettings.RouteCurvature)
	require.Equal(t, float64(20), config.MapSettings.NodeSize)
	require.Equal(t, "#112233", config.MapSettings.PrimaryServerColor)
	require.Equal(t, "#497d96", config.MapSettings.CDNColor)
	require.Equal(t, "#ABCDEF", config.MapSettings.CustomerColor)
	require.Equal(t, "dashed", config.MapSettings.RouteStyle)
	require.False(t, config.MapSettings.FlowAnimation)
}

func TestTobHomepageConfigService_NormalizesNodeSizeBounds(t *testing.T) {
	tests := []struct {
		name     string
		input    float64
		expected float64
	}{
		{name: "minimum", input: 10, expected: 10},
		{name: "maximum", input: 200, expected: 200},
		{name: "below minimum", input: 9, expected: 100},
		{name: "above maximum", input: 201, expected: 100},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			settings := normalizeTobMapSettings(&TobMapSettings{NodeSize: test.input})
			require.Equal(t, test.expected, settings.NodeSize)
		})
	}
}

func TestTobHomepageConfigService_DefaultsLegacyMapSettings(t *testing.T) {
	store := &memoryTobHomepageConfigStore{config: &TobHomepageConfig{}}
	config, err := NewTobHomepageConfigService(store).Get(context.Background())
	require.NoError(t, err)
	require.NotNil(t, config.MapSettings)
	require.Equal(t, defaultTobMapSettings(), *config.MapSettings)
}
