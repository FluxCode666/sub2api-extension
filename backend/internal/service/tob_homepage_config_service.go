package service

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"regexp"

	"aux-system/ent"
	"aux-system/ent/systemmeta"
)

const TobHomepageConfigKey = "homepage.tob.config"

var tobMapHexColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// TobMapNode 描述官网地图上的基础设施或客户位置。
// 这里只保存公开展示需要的名称、坐标和说明，不接受地址或凭据。
type TobMapNode struct {
	Name        string  `json:"name"`
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	Description string  `json:"description,omitempty"`
}

// TobMapSettings 控制公开官网地图的展示方式。
// 使用指针挂载在配置上，以便旧配置缺少整个对象时恢复兼容默认值。
type TobMapSettings struct {
	ShowNodeLabels     bool    `json:"showNodeLabels"`
	RouteCurvature     float64 `json:"routeCurvature"`
	NodeSize           float64 `json:"nodeSize"`
	PrimaryServerColor string  `json:"primaryServerColor"`
	CDNColor           string  `json:"cdnColor"`
	CustomerColor      string  `json:"customerColor"`
	RouteStyle         string  `json:"routeStyle"`
	FlowAnimation      bool    `json:"flowAnimation"`
}

// TobHomepageConfig 是现有官网配置的独立副本，并追加全球网络节点。
// 匿名嵌入让 JSON 字段与 HomepageConfig 保持完全一致。
type TobHomepageConfig struct {
	HomepageConfig
	PrimaryServers    []TobMapNode    `json:"primaryServers"`
	CDNLocations      []TobMapNode    `json:"cdnLocations"`
	CustomerLocations []TobMapNode    `json:"customerLocations"`
	MapSettings       *TobMapSettings `json:"mapSettings"`
}

func defaultTobMapSettings() TobMapSettings {
	return TobMapSettings{
		ShowNodeLabels:     true,
		RouteCurvature:     24,
		NodeSize:           100,
		PrimaryServerColor: "#d97706",
		CDNColor:           "#497d96",
		CustomerColor:      "#15803d",
		RouteStyle:         "dashed",
		FlowAnimation:      true,
	}
}

func DefaultTobHomepageConfig() TobHomepageConfig {
	return newTobHomepageConfig(DefaultHomepageConfig())
}

func newTobHomepageConfig(homepage HomepageConfig) TobHomepageConfig {
	homepage = normalizeHomepageConfig(homepage)
	if !hasHomepageNavigationHref(homepage.NavigationItems, "#network") && len(homepage.NavigationItems) < 8 {
		homepage.NavigationItems = append(homepage.NavigationItems, HomepageNavigationItem{Label: "全球网络", Href: "#network"})
	}
	// ToB 官网有独立配置，不通过原官网的 Sub2API 菜单发布开关同步。
	homepage.Sub2APIPublished = false
	return TobHomepageConfig{
		HomepageConfig: homepage,
		PrimaryServers: []TobMapNode{
			{Name: "华东主站", Latitude: 31.23, Longitude: 121.47, Description: "核心 API 与控制面"},
		},
		CDNLocations:      []TobMapNode{},
		CustomerLocations: []TobMapNode{},
		MapSettings:       pointerTo(defaultTobMapSettings()),
	}
}

func pointerTo[T any](value T) *T { return &value }

func hasHomepageNavigationHref(items []HomepageNavigationItem, href string) bool {
	for _, item := range items {
		if item.Href == href {
			return true
		}
	}
	return false
}

type TobHomepageConfigStore interface {
	GetTobHomepageConfig(context.Context) (*TobHomepageConfig, error)
	SaveTobHomepageConfig(context.Context, TobHomepageConfig) error
}

type homepageConfigReader interface {
	Get(context.Context) (HomepageConfig, error)
}

type TobHomepageConfigService struct {
	store  TobHomepageConfigStore
	source homepageConfigReader
}

func NewTobHomepageConfigService(store TobHomepageConfigStore, sources ...homepageConfigReader) *TobHomepageConfigService {
	var source homepageConfigReader
	if len(sources) > 0 {
		source = sources[0]
	}
	return &TobHomepageConfigService{store: store, source: source}
}

func (s *TobHomepageConfigService) Get(ctx context.Context) (TobHomepageConfig, error) {
	defaults := DefaultTobHomepageConfig()
	if s == nil || s.store == nil {
		return defaults, nil
	}
	config, err := s.store.GetTobHomepageConfig(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return s.cloneCurrentHomepage(ctx), nil
		}
		return defaults, err
	}
	if config == nil {
		return s.cloneCurrentHomepage(ctx), nil
	}
	return normalizeTobHomepageConfig(*config), nil
}

func (s *TobHomepageConfigService) cloneCurrentHomepage(ctx context.Context) TobHomepageConfig {
	if s == nil || s.source == nil {
		return DefaultTobHomepageConfig()
	}
	homepage, err := s.source.Get(ctx)
	if err != nil {
		return DefaultTobHomepageConfig()
	}
	return newTobHomepageConfig(homepage)
}

func (s *TobHomepageConfigService) Save(ctx context.Context, config TobHomepageConfig) (TobHomepageConfig, error) {
	config = normalizeTobHomepageConfig(config)
	if s == nil || s.store == nil {
		return config, errors.New("tob homepage config store is unavailable")
	}
	if err := s.store.SaveTobHomepageConfig(ctx, config); err != nil {
		return config, err
	}
	return config, nil
}

func normalizeTobHomepageConfig(config TobHomepageConfig) TobHomepageConfig {
	config.HomepageConfig = normalizeHomepageConfig(config.HomepageConfig)
	if !hasHomepageNavigationHref(config.NavigationItems, "#network") && len(config.NavigationItems) < 8 {
		config.NavigationItems = append(config.NavigationItems, HomepageNavigationItem{Label: "全球网络", Href: "#network"})
	}
	config.Sub2APIPublished = false
	defaults := DefaultTobHomepageConfig()
	config.PrimaryServers = normalizeTobNodes(config.PrimaryServers, defaults.PrimaryServers)
	config.CDNLocations = normalizeTobNodes(config.CDNLocations, defaults.CDNLocations)
	config.CustomerLocations = normalizeTobNodes(config.CustomerLocations, defaults.CustomerLocations)
	config.MapSettings = normalizeTobMapSettings(config.MapSettings)
	return config
}

func normalizeTobMapSettings(settings *TobMapSettings) *TobMapSettings {
	defaults := defaultTobMapSettings()
	if settings == nil {
		return &defaults
	}
	normalized := *settings
	if math.IsNaN(normalized.RouteCurvature) || math.IsInf(normalized.RouteCurvature, 0) {
		normalized.RouteCurvature = defaults.RouteCurvature
	}
	normalized.RouteCurvature = math.Max(0, math.Min(100, normalized.RouteCurvature))
	if math.IsNaN(normalized.NodeSize) || math.IsInf(normalized.NodeSize, 0) || normalized.NodeSize < 10 || normalized.NodeSize > 200 {
		normalized.NodeSize = defaults.NodeSize
	}
	normalized.PrimaryServerColor = normalizeTobMapColor(normalized.PrimaryServerColor, defaults.PrimaryServerColor)
	normalized.CDNColor = normalizeTobMapColor(normalized.CDNColor, defaults.CDNColor)
	normalized.CustomerColor = normalizeTobMapColor(normalized.CustomerColor, defaults.CustomerColor)
	if normalized.RouteStyle != "solid" && normalized.RouteStyle != "dashed" {
		normalized.RouteStyle = defaults.RouteStyle
	}
	return &normalized
}

func normalizeTobMapColor(value, fallback string) string {
	if !tobMapHexColorPattern.MatchString(value) {
		return fallback
	}
	return value
}

func normalizeTobNodes(nodes, fallback []TobMapNode) []TobMapNode {
	if nodes == nil {
		nodes = fallback
	}
	result := make([]TobMapNode, 0, min(len(nodes), 32))
	for _, node := range nodes {
		name := boundedText(node.Name, "", 80)
		if name == "" || math.IsNaN(node.Latitude) || math.IsNaN(node.Longitude) || math.IsInf(node.Latitude, 0) || math.IsInf(node.Longitude, 0) || node.Latitude < -90 || node.Latitude > 90 || node.Longitude < -180 || node.Longitude > 180 {
			continue
		}
		result = append(result, TobMapNode{Name: name, Latitude: node.Latitude, Longitude: node.Longitude, Description: boundedText(node.Description, "", 160)})
		if len(result) == 32 {
			break
		}
	}
	return result
}

type entTobHomepageConfigStore struct{ client *ent.Client }

func NewEntTobHomepageConfigStore(client *ent.Client) TobHomepageConfigStore {
	return &entTobHomepageConfigStore{client: client}
}

func (s *entTobHomepageConfigStore) GetTobHomepageConfig(ctx context.Context) (*TobHomepageConfig, error) {
	meta, err := s.client.SystemMeta.Query().Where(systemmeta.KeyEQ(TobHomepageConfigKey)).Only(ctx)
	if err != nil {
		return nil, err
	}
	var config TobHomepageConfig
	if err := json.Unmarshal([]byte(meta.Value), &config); err != nil {
		return nil, err
	}
	return &config, nil
}

func (s *entTobHomepageConfigStore) SaveTobHomepageConfig(ctx context.Context, config TobHomepageConfig) error {
	encoded, err := json.Marshal(config)
	if err != nil {
		return err
	}
	meta, err := s.client.SystemMeta.Query().Where(systemmeta.KeyEQ(TobHomepageConfigKey)).Only(ctx)
	if err != nil {
		if !ent.IsNotFound(err) {
			return err
		}
		_, err = s.client.SystemMeta.Create().SetKey(TobHomepageConfigKey).SetValue(string(encoded)).Save(ctx)
		return err
	}
	_, err = meta.Update().SetValue(string(encoded)).Save(ctx)
	return err
}
