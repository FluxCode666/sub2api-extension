package service

import (
	"context"
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
