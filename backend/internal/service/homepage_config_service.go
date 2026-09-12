// Package service 保留旧版 homepage.config API 的读取与持久化能力。
// 当前配置端点服务于 Sub2API 官网与 API 文档；动态页面内容统一由
// pages.content_html / pages.content_react 管理。
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
	legacyHomepageModel           = "gpt-5.6-sol"
)

// TrustedPartner 是旧版配置中的兼容字段。
// LogoURL 留空时前端只展示名称，不渲染占位图标。
type TrustedPartner struct {
	Name    string `json:"name"`
	LogoURL string `json:"logoUrl,omitempty"`
	LinkURL string `json:"linkUrl,omitempty"`
}

// IntegrationApp 是官网“接入生态”板块中的应用节点。
// DocumentationURL 留空时节点仅展示 Logo 和名称，不渲染链接。
type IntegrationApp struct {
	Name             string `json:"name"`
	LogoURL          string `json:"logoUrl,omitempty"`
	DocumentationURL string `json:"documentationUrl,omitempty"`
}

type HomepageNavigationItem struct {
	Label string `json:"label"`
	Href  string `json:"href"`
}

// HomepageConfig 是可在管理端调整的官网首页内容。
type HomepageConfig struct {
	SiteName                          string `json:"siteName"`
	SystemDomain                      string `json:"systemDomain"`
	SiteLogoURL                       string `json:"siteLogoUrl"`
	HeroLabel                         string `json:"heroLabel"`
	HeroTitle                         string `json:"heroTitle"`
	HeroDescription                   string `json:"heroDescription"`
	Model                             string `json:"model"`
	Availability                      string `json:"availability"`
	AvailabilityDescription           string `json:"availabilityDescription"`
	FirstTokenResponseTime            string `json:"firstTokenResponseTime"`
	FirstTokenResponseTimeDescription string `json:"firstTokenResponseTimeDescription"`
	PromptCacheRate                   string `json:"promptCacheRate"`
	PromptCacheRateDescription        string `json:"promptCacheRateDescription"`
	PrimaryCTA                        string `json:"primaryCta"`
	PrimaryHref                       string `json:"primaryHref"`
	DocsCTA                           string `json:"docsCta"`
	DocsHref                          string `json:"docsHref"`
	ConsoleHref                       string `json:"consoleHref"`
	DocumentationURL                  string `json:"documentationUrl"`
	DevelopersDocsURL                 string `json:"developersDocsUrl"`
	TermsURL                          string `json:"termsUrl"`
	UserTermsURL                      string `json:"userTermsUrl"`
	PrivacyURL                        string `json:"privacyUrl"`
	Sub2APIPublished                  bool   `json:"sub2apiPublished"`
	// ShowDevelopersSection 使用指针区分旧配置中缺失字段与明确关闭。
	ShowDevelopersSection *bool                    `json:"showDevelopersSection"`
	ShowQuickstartSection *bool                    `json:"showQuickstartSection"`
	NavigationItems       []HomepageNavigationItem `json:"navigationItems"`
	TrustedPartners       []TrustedPartner         `json:"trustedPartners"`
	Integrations          []IntegrationApp         `json:"integrations"`
}

// DefaultHomepageConfig 是无配置或配置读取失败时使用的安全默认值。
func DefaultHomepageConfig() HomepageConfig {
	showDevelopersSection := true
	showQuickstartSection := true
	return HomepageConfig{
		SiteName:                          "Sub2API",
		SystemDomain:                      "",
		SiteLogoURL:                       "",
		HeroLabel:                         "面向生产环境的 AI 网关",
		HeroTitle:                         "AI API 网关，面向下一次调用",
		HeroDescription:                   "用一个清晰、稳定、可观测的入口，连接模型、团队与真实业务。",
		Model:                             "gpt-6-astra",
		Availability:                      "99.99%",
		AvailabilityDescription:           "核心 API 入口持续在线，异常请求自动隔离，保障业务稳定运行。",
		FirstTokenResponseTime:            "≤ 200ms",
		FirstTokenResponseTimeDescription: "从请求发出到首个 Token 返回，减少等待，保持交互流畅。",
		PromptCacheRate:                   "≥ 85%",
		PromptCacheRateDescription:        "重复提示词优先命中缓存，降低延迟与调用成本。",
		PrimaryCTA:                        "开始使用",
		PrimaryHref:                       "/login",
		DocsCTA:                           "查看开发文档",
		DocsHref:                          "#developers",
		ConsoleHref:                       "/admin",
		DocumentationURL:                  "",
		DevelopersDocsURL:                 "",
		TermsURL:                          "",
		UserTermsURL:                      "",
		PrivacyURL:                        "",
		Sub2APIPublished:                  false,
		ShowDevelopersSection:             &showDevelopersSection,
		ShowQuickstartSection:             &showQuickstartSection,
		NavigationItems: []HomepageNavigationItem{
			{Label: "安全", Href: "#security"},
			{Label: "指标", Href: "#metrics"},
			{Label: "开发者", Href: "#developers"},
			{Label: "生态", Href: "#ecosystem"},
			{Label: "合作伙伴", Href: "#partners"},
		},
		TrustedPartners: []TrustedPartner{},
		Integrations:    []IntegrationApp{},
	}
}

// HomepageConfigStore 抽象兼容配置存储，便于服务层单测注入内存实现。
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
	if config.ShowDevelopersSection == nil {
		config.ShowDevelopersSection = defaults.ShowDevelopersSection
	}
	if config.ShowQuickstartSection == nil {
		config.ShowQuickstartSection = defaults.ShowQuickstartSection
	}
	if strings.TrimSpace(config.HeroTitle) == legacyHomepageHeroTitle {
		config.HeroTitle = defaults.HeroTitle
	}
	if strings.TrimSpace(config.HeroDescription) == legacyHomepageHeroDescription {
		config.HeroDescription = defaults.HeroDescription
	}
	if strings.TrimSpace(config.Model) == legacyHomepageModel {
		config.Model = defaults.Model
	}
	config.HeroLabel = boundedText(config.HeroLabel, defaults.HeroLabel, 120)
	config.SiteName = boundedText(config.SiteName, defaults.SiteName, 80)
	config.SystemDomain = safeHref(config.SystemDomain, defaults.SystemDomain)
	config.SiteLogoURL = safeAssetURL(config.SiteLogoURL)
	config.HeroTitle = boundedText(config.HeroTitle, defaults.HeroTitle, 160)
	config.HeroDescription = boundedText(config.HeroDescription, defaults.HeroDescription, 360)
	config.Model = boundedText(config.Model, defaults.Model, 120)
	config.Availability = boundedText(config.Availability, defaults.Availability, 32)
	config.AvailabilityDescription = boundedText(config.AvailabilityDescription, defaults.AvailabilityDescription, 180)
	config.FirstTokenResponseTime = boundedText(config.FirstTokenResponseTime, defaults.FirstTokenResponseTime, 32)
	config.FirstTokenResponseTimeDescription = boundedText(config.FirstTokenResponseTimeDescription, defaults.FirstTokenResponseTimeDescription, 180)
	config.PromptCacheRate = boundedText(config.PromptCacheRate, defaults.PromptCacheRate, 32)
	config.PromptCacheRateDescription = boundedText(config.PromptCacheRateDescription, defaults.PromptCacheRateDescription, 180)
	config.PrimaryCTA = boundedText(config.PrimaryCTA, defaults.PrimaryCTA, 48)
	config.PrimaryHref = safeHref(config.PrimaryHref, defaults.PrimaryHref)
	config.DocsCTA = boundedText(config.DocsCTA, defaults.DocsCTA, 48)
	config.DocsHref = safeHref(config.DocsHref, defaults.DocsHref)
	config.ConsoleHref = safeHref(config.ConsoleHref, defaults.ConsoleHref)
	config.DocumentationURL = safeHref(config.DocumentationURL, defaults.DocumentationURL)
	config.DevelopersDocsURL = safeHref(config.DevelopersDocsURL, defaults.DevelopersDocsURL)
	config.TermsURL = safeHref(config.TermsURL, defaults.TermsURL)
	config.UserTermsURL = safeHref(config.UserTermsURL, defaults.UserTermsURL)
	config.PrivacyURL = safeHref(config.PrivacyURL, defaults.PrivacyURL)

	if config.NavigationItems == nil {
		config.NavigationItems = defaults.NavigationItems
	}
	navigationItems := make([]HomepageNavigationItem, 0, min(len(config.NavigationItems), 8))
	for _, item := range config.NavigationItems {
		label := boundedText(item.Label, "", 24)
		href := safeHref(item.Href, "")
		if label == "" || href == "" || strings.HasPrefix(href, "//") || strings.ContainsAny(href, "\\\r\n\t") {
			continue
		}
		navigationItems = append(navigationItems, HomepageNavigationItem{Label: label, Href: href})
		if len(navigationItems) == 8 {
			break
		}
	}
	config.NavigationItems = navigationItems

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

	integrations := make([]IntegrationApp, 0, min(len(config.Integrations), 12))
	for _, integration := range config.Integrations {
		name := boundedText(integration.Name, "", 80)
		if name == "" {
			continue
		}
		integrations = append(integrations, IntegrationApp{
			Name:             name,
			LogoURL:          safeAssetURL(integration.LogoURL),
			DocumentationURL: safeHref(integration.DocumentationURL, ""),
		})
		if len(integrations) == 12 {
			break
		}
	}
	config.Integrations = integrations
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
	// Uploaded image assets are exposed at same-origin paths such as
	// /api/aux/assets/2. Keep those paths usable while rejecting protocol-
	// relative URLs and control characters that could escape the site origin.
	if strings.HasPrefix(value, "/") {
		if strings.HasPrefix(value, "//") || strings.ContainsAny(value, "\\\r\n\t") {
			return ""
		}
		if _, err := url.Parse(value); err != nil {
			return ""
		}
		return value
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
