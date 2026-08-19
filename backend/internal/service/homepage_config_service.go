// Package service 保留旧版官网配置 API 的读取与持久化能力。
// 当前官网首页由 pages 表中的 slug=home 动态页面承载。
//
// 该兼容接口仍使用现有 system_meta 表保存旧版 JSON 文档，但不再参与
// /p/home 的渲染；新页面内容统一由 pages.content_html 管理。
package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strings"

	"sub2api-extension/ent"
	"sub2api-extension/ent/systemmeta"
)

const HomepageConfigKey = "homepage.config"

const (
	legacyHomepageHeroTitle       = "AI 网关，让接入、治理与运行统一"
	legacyHomepageHeroDescription = "TERALEMO 将安全准入、智能路由、稳定保障、用量管理与运行观测统一到同一网关层。"
)

// TrustedPartner 是官网“受信赖的伙伴”滚动项。
// LogoURL 留空时前端只展示名称，不渲染占位图标。
type TrustedPartner struct {
	Name    string `json:"name"`
	LogoURL string `json:"logoUrl,omitempty"`
	LinkURL string `json:"linkUrl,omitempty"`
}

// HomepageConfig 是可在管理端调整的官网首页内容。
type HomepageConfig struct {
	HeroLabel       string           `json:"heroLabel"`
	HeroTitle       string           `json:"heroTitle"`
	HeroDescription string           `json:"heroDescription"`
	Model           string           `json:"model"`
	PrimaryCTA      string           `json:"primaryCta"`
	PrimaryHref     string           `json:"primaryHref"`
	DocsCTA         string           `json:"docsCta"`
	DocsHref        string           `json:"docsHref"`
	ConsoleHref     string           `json:"consoleHref"`
	TrustedPartners []TrustedPartner `json:"trustedPartners"`
}

// DefaultHomepageConfig 是无配置或配置读取失败时使用的安全默认值。
// 伙伴列表故意为空，以便没有配置时不展示“受信赖的伙伴”区块。
func DefaultHomepageConfig() HomepageConfig {
	return HomepageConfig{
		HeroLabel:       "面向生产环境的 AI 网关",
		HeroTitle:       "TERALEMO",
		HeroDescription: "将安全准入、智能路由、稳定保障、用量管理与运行观测统一到同一网关层。",
		Model:           "gpt-5.6-sol",
		PrimaryCTA:      "获取接入方案",
		PrimaryHref:     "#contact",
		DocsCTA:         "查看开发者文档",
		DocsHref:        "#developers",
		ConsoleHref:     "/admin",
		TrustedPartners: []TrustedPartner{},
	}
}

// HomepageConfigStore 抽象官网配置存储，便于服务层单测注入内存实现。
type HomepageConfigStore interface {
	GetHomepageConfig(ctx context.Context) (*HomepageConfig, error)
	SaveHomepageConfig(ctx context.Context, config HomepageConfig) error
}

// HomepageConfigService 负责默认值、清洗和持久化。
type HomepageConfigService struct {
	store HomepageConfigStore
}

func NewHomepageConfigService(store HomepageConfigStore) *HomepageConfigService {
	return &HomepageConfigService{store: store}
}

func (s *HomepageConfigService) Get(ctx context.Context) (HomepageConfig, error) {
	defaults := DefaultHomepageConfig()
	if s == nil || s.store == nil {
		return defaults, nil
	}
	config, err := s.store.GetHomepageConfig(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return defaults, nil
		}
		return defaults, err
	}
	if config == nil {
		return defaults, nil
	}
	return normalizeHomepageConfig(*config), nil
}

func (s *HomepageConfigService) Save(ctx context.Context, config HomepageConfig) (HomepageConfig, error) {
	config = normalizeHomepageConfig(config)
	if s == nil || s.store == nil {
		return config, errors.New("homepage config store is unavailable")
	}
	if err := s.store.SaveHomepageConfig(ctx, config); err != nil {
		return config, err
	}
	return config, nil
}

func normalizeHomepageConfig(config HomepageConfig) HomepageConfig {
	defaults := DefaultHomepageConfig()
	if strings.TrimSpace(config.HeroTitle) == legacyHomepageHeroTitle {
		config.HeroTitle = defaults.HeroTitle
	}
	if strings.TrimSpace(config.HeroDescription) == legacyHomepageHeroDescription {
		config.HeroDescription = defaults.HeroDescription
	}
	config.HeroLabel = boundedText(config.HeroLabel, defaults.HeroLabel, 120)
	config.HeroTitle = boundedText(config.HeroTitle, defaults.HeroTitle, 160)
	config.HeroDescription = boundedText(config.HeroDescription, defaults.HeroDescription, 360)
	config.Model = boundedText(config.Model, defaults.Model, 120)
	config.PrimaryCTA = boundedText(config.PrimaryCTA, defaults.PrimaryCTA, 48)
	config.PrimaryHref = safeHref(config.PrimaryHref, defaults.PrimaryHref)
	config.DocsCTA = boundedText(config.DocsCTA, defaults.DocsCTA, 48)
	config.DocsHref = safeHref(config.DocsHref, defaults.DocsHref)
	config.ConsoleHref = safeHref(config.ConsoleHref, defaults.ConsoleHref)

	partners := make([]TrustedPartner, 0, min(len(config.TrustedPartners), 24))
	for _, partner := range config.TrustedPartners {
		name := boundedText(partner.Name, "", 80)
		if name == "" {
			continue
		}
		partners = append(partners, TrustedPartner{
			Name:    name,
			LogoURL: safeAssetURL(partner.LogoURL),
			LinkURL: safeHref(partner.LinkURL, ""),
		})
		if len(partners) == 24 {
			break
		}
	}
	config.TrustedPartners = partners
	return config
}

func boundedText(value, fallback string, max int) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	if len([]rune(value)) > max {
		return string([]rune(value)[:max])
	}
	return value
}

func safeHref(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	if strings.HasPrefix(value, "#") || strings.HasPrefix(value, "/") {
		return value
	}
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return fallback
	}
	return value
}

func safeAssetURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return ""
	}
	return value
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// entHomepageConfigStore 将配置 JSON 写入 system_meta。
type entHomepageConfigStore struct {
	client *ent.Client
}

func NewEntHomepageConfigStore(client *ent.Client) HomepageConfigStore {
	return &entHomepageConfigStore{client: client}
}

func (s *entHomepageConfigStore) GetHomepageConfig(ctx context.Context) (*HomepageConfig, error) {
	meta, err := s.client.SystemMeta.Query().Where(systemmeta.KeyEQ(HomepageConfigKey)).Only(ctx)
	if err != nil {
		return nil, err
	}
	var config HomepageConfig
	if err := json.Unmarshal([]byte(meta.Value), &config); err != nil {
		return nil, err
	}
	return &config, nil
}

func (s *entHomepageConfigStore) SaveHomepageConfig(ctx context.Context, config HomepageConfig) error {
	encoded, err := json.Marshal(config)
	if err != nil {
		return err
	}
	meta, err := s.client.SystemMeta.Query().Where(systemmeta.KeyEQ(HomepageConfigKey)).Only(ctx)
	if err != nil {
		if !ent.IsNotFound(err) {
			return err
		}
		_, err = s.client.SystemMeta.Create().SetKey(HomepageConfigKey).SetValue(string(encoded)).Save(ctx)
		return err
	}
	_, err = meta.Update().SetValue(string(encoded)).Save(ctx)
	return err
}
