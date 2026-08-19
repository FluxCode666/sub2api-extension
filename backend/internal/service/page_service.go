// Package service 提供动态页面管理的业务逻辑。
//
// Page 管理员可创建/编辑/删除/启停动态页面。与只追加埋点表(PageView/FeatureClick)
// 不同, Page 是可变实体。page_id 在埋点表里为 "page:<slug>"(命名空间隔离),
// 避免与静态核心页 id 冲突。
//
// 风格镜像 homepage_config_service.go: Store interface seam + entStore 实现 + 校验。
package service

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"sub2api-extension/ent"
	"sub2api-extension/ent/page"
)

// PageVisibility 页面可见性。
type PageVisibility string

const (
	VisibilityPublic PageVisibility = "public"
	VisibilityAdmin  PageVisibility = "admin"
)

// PageContentType 页面内容类型。
type PageContentType string

const (
	ContentTypeHTML  PageContentType = "html"
	ContentTypeReact PageContentType = "react"
)

// maxContentBytes 单页内容大小上限(256KB), 防止无界内容拖慢渲染/API。
const maxContentBytes = 256 * 1024

// logo 元数据只保存图片 URL；图片文件通过图片资源页上传，不内联写入页面 JSON。
const maxLogoURLBytes = 4096

// slugPattern slug 允许的字符: 小写字母/数字/连字符, 1-128 字符。
var slugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// staticCorePageIDs 静态核心页 id, slug 不得与之冲突(避免 page_id 命名空间碰撞)。
var staticCorePageIDs = map[string]bool{
	"dashboard": true,
}

// PageInput 创建/更新页面的输入。
type PageInput struct {
	Slug         string                 `json:"slug"`
	Title        string                 `json:"title"`
	Visibility   PageVisibility         `json:"visibility"`
	ContentType  PageContentType        `json:"content_type"`
	ContentHTML  string                 `json:"content_html"`
	ContentReact string                 `json:"content_react"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"` // 页面元数据(键值对)
	Enabled      *bool                  `json:"enabled"`            // 指针: 更新时 nil 表示不改
}

// Page 动态页面实体(对外契约)。
type Page struct {
	ID           int                    `json:"id"`
	Slug         string                 `json:"slug"`
	Title        string                 `json:"title"`
	Visibility   PageVisibility         `json:"visibility"`
	ContentType  PageContentType        `json:"content_type"`
	ContentHTML  string                 `json:"content_html,omitempty"`
	ContentReact string                 `json:"content_react,omitempty"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"` // 页面元数据(键值对)
	Enabled      bool                   `json:"enabled"`
	PageID       string                 `json:"page_id"` // "page:<slug>", 埋点命名空间
	CreatedAt    time.Time              `json:"created_at"`
	UpdatedAt    time.Time              `json:"updated_at"`
}

// PageListItem 列表项(不含内容, 减小负载)。
type PageListItem struct {
	ID          int             `json:"id"`
	Slug        string          `json:"slug"`
	Title       string          `json:"title"`
	Visibility  PageVisibility  `json:"visibility"`
	ContentType PageContentType `json:"content_type"`
	Enabled     bool            `json:"enabled"`
	Route       string          `json:"route"` // /p/<slug> 或 /admin/p/<slug>
	PageID      string          `json:"page_id"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

// PageStore 抽象页面存储, 便于服务层单测注入内存实现。
type PageStore interface {
	Create(ctx context.Context, input PageInput) (*Page, error)
	List(ctx context.Context) ([]PageListItem, error)
	GetByID(ctx context.Context, id int) (*Page, error)
	GetBySlug(ctx context.Context, slug string) (*Page, error)
	Update(ctx context.Context, id int, input PageInput) (*Page, error)
	Delete(ctx context.Context, id int) error
	SlugExists(ctx context.Context, slug string, excludeID int) (bool, error)
}

// PageService 负责校验与持久化。
type PageService struct {
	store PageStore
}

func NewPageService(store PageStore) *PageService {
	return &PageService{store: store}
}

// Create 创建页面。校验 slug/visibility/content_type/content 大小。
func (s *PageService) Create(ctx context.Context, input PageInput) (*Page, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("page store is unavailable")
	}
	if err := validatePageInput(input, true); err != nil {
		return nil, err
	}
	exists, err := s.store.SlugExists(ctx, input.Slug, 0)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, ErrSlugConflict
	}
	return s.store.Create(ctx, normalizeInput(input))
}

// List 列出所有页面(不含内容)。
func (s *PageService) List(ctx context.Context) ([]PageListItem, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("page store is unavailable")
	}
	return s.store.List(ctx)
}

// GetByID 按 id 获取(含内容, 管理端用)。
func (s *PageService) GetByID(ctx context.Context, id int) (*Page, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("page store is unavailable")
	}
	return s.store.GetByID(ctx, id)
}

// GetPublicBySlug 按 slug 获取启用的公开页面(不含 admin 页, 公开渲染用)。
func (s *PageService) GetPublicBySlug(ctx context.Context, slug string) (*Page, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("page store is unavailable")
	}
	p, err := s.store.GetBySlug(ctx, slug)
	if err != nil {
		return nil, err
	}
	if !p.Enabled || p.Visibility != VisibilityPublic {
		return nil, ErrPageNotFound
	}
	return p, nil
}

// GetAdminBySlug 按 slug 获取启用的页面(admin 页, 管理端渲染用)。
func (s *PageService) GetAdminBySlug(ctx context.Context, slug string) (*Page, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("page store is unavailable")
	}
	p, err := s.store.GetBySlug(ctx, slug)
	if err != nil {
		return nil, err
	}
	if !p.Enabled || p.Visibility != VisibilityAdmin {
		return nil, ErrPageNotFound
	}
	return p, nil
}

// Update 更新页面。校验 slug 唯一性(排除自身)。
func (s *PageService) Update(ctx context.Context, id int, input PageInput) (*Page, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("page store is unavailable")
	}
	if err := validatePageInput(input, false); err != nil {
		return nil, err
	}
	if input.Slug != "" {
		exists, err := s.store.SlugExists(ctx, input.Slug, id)
		if err != nil {
			return nil, err
		}
		if exists {
			return nil, ErrSlugConflict
		}
	}
	return s.store.Update(ctx, id, normalizeInput(input))
}

// Delete 删除页面。埋点历史(page_views/feature_clicks)保留(只追加表不动)。
func (s *PageService) Delete(ctx context.Context, id int) error {
	if s == nil || s.store == nil {
		return errors.New("page store is unavailable")
	}
	return s.store.Delete(ctx, id)
}

// 服务层错误。
var (
	ErrSlugConflict = errors.New("slug already exists")
	ErrPageNotFound = errors.New("page not found")
)

// validatePageInput 校验输入。requireSlug=true 时 slug 必填(创建场景)。
func validatePageInput(input PageInput, requireSlug bool) error {
	if requireSlug {
		if !slugPattern.MatchString(input.Slug) {
			return fmt.Errorf("invalid slug: must match %s", slugPattern.String())
		}
		if staticCorePageIDs[input.Slug] {
			return fmt.Errorf("slug '%s' conflicts with a static core page id", input.Slug)
		}
	} else if input.Slug != "" && !slugPattern.MatchString(input.Slug) {
		return fmt.Errorf("invalid slug: must match %s", slugPattern.String())
	}
	if strings.TrimSpace(input.Title) == "" {
		return errors.New("title is required")
	}
	if len([]rune(input.Title)) > 256 {
		return errors.New("title exceeds 256 characters")
	}
	if input.Visibility != "" && input.Visibility != VisibilityPublic && input.Visibility != VisibilityAdmin {
		return fmt.Errorf("invalid visibility: %s", input.Visibility)
	}
	if input.ContentType != "" && input.ContentType != ContentTypeHTML && input.ContentType != ContentTypeReact {
		return fmt.Errorf("invalid content_type: %s", input.ContentType)
	}
	if len(input.ContentHTML) > maxContentBytes {
		return fmt.Errorf("content_html exceeds %d bytes", maxContentBytes)
	}
	if len(input.ContentReact) > maxContentBytes {
		return fmt.Errorf("content_react exceeds %d bytes", maxContentBytes)
	}
	if err := validatePageMetadata(input.Metadata); err != nil {
		return err
	}
	return nil
}

func validatePageMetadata(metadata map[string]interface{}) error {
	if metadata == nil {
		return nil
	}
	raw, ok := metadata["logo"]
	if !ok || raw == nil {
		return nil
	}
	logo, ok := raw.(string)
	if !ok {
		return errors.New("metadata.logo must be a string")
	}
	logo = strings.TrimSpace(logo)
	if logo == "" {
		return nil
	}
	if len(logo) > maxLogoURLBytes {
		return fmt.Errorf("metadata.logo exceeds %d bytes", maxLogoURLBytes)
	}
	if !strings.HasPrefix(strings.ToLower(logo), "http://") &&
		!strings.HasPrefix(strings.ToLower(logo), "https://") {
		return errors.New("metadata.logo must be an http(s) URL")
	}
	return nil
}

// normalizeInput 填充默认值(visibility/content_type/enabled)。
func normalizeInput(input PageInput) PageInput {
	if input.Visibility == "" {
		input.Visibility = VisibilityPublic
	}
	if input.ContentType == "" {
		input.ContentType = ContentTypeHTML
	}
	input.Slug = strings.ToLower(strings.TrimSpace(input.Slug))
	input.Title = strings.TrimSpace(input.Title)
	return input
}

// pageRoute 根据 visibility 计算路由路径。
func pageRoute(slug string, visibility PageVisibility) string {
	if visibility == VisibilityAdmin {
		return "/admin/p/" + slug
	}
	return "/p/" + slug
}

// pageID 计算 page_id(埋点命名空间)。
func pageID(slug string) string {
	return "page:" + slug
}

// --- ent store 实现 ---

// entPageStore 将 Page 持久化到 ent.Page。
type entPageStore struct {
	client *ent.Client
}

func NewEntPageStore(client *ent.Client) PageStore {
	return &entPageStore{client: client}
}

func (s *entPageStore) Create(ctx context.Context, input PageInput) (*Page, error) {
	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	metadata := input.Metadata
	if metadata == nil {
		metadata = map[string]interface{}{}
	}
	p, err := s.client.Page.Create().
		SetSlug(input.Slug).
		SetTitle(input.Title).
		SetVisibility(string(input.Visibility)).
		SetContentType(string(input.ContentType)).
		SetNillableContentHTML(nillableString(input.ContentHTML)).
		SetNillableContentReact(nillableString(input.ContentReact)).
		SetMetadata(metadata).
		SetEnabled(enabled).
		Save(ctx)
	if err != nil {
		return nil, err
	}
	return entPageToPage(p), nil
}

func (s *entPageStore) List(ctx context.Context) ([]PageListItem, error) {
	pages, err := s.client.Page.Query().Order(ent.Asc(page.FieldSlug)).All(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]PageListItem, 0, len(pages))
	for _, p := range pages {
		items = append(items, PageListItem{
			ID:          p.ID,
			Slug:        p.Slug,
			Title:       p.Title,
			Visibility:  PageVisibility(p.Visibility),
			ContentType: PageContentType(p.ContentType),
			Enabled:     p.Enabled,
			Route:       pageRoute(p.Slug, PageVisibility(p.Visibility)),
			PageID:      pageID(p.Slug),
			UpdatedAt:   p.UpdatedAt,
		})
	}
	return items, nil
}

func (s *entPageStore) GetByID(ctx context.Context, id int) (*Page, error) {
	p, err := s.client.Page.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	return entPageToPage(p), nil
}

func (s *entPageStore) GetBySlug(ctx context.Context, slug string) (*Page, error) {
	p, err := s.client.Page.Query().Where(page.SlugEQ(slug)).Only(ctx)
	if err != nil {
		return nil, err
	}
	return entPageToPage(p), nil
}

func (s *entPageStore) Update(ctx context.Context, id int, input PageInput) (*Page, error) {
	p, err := s.client.Page.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	upd := p.Update()
	if input.Slug != "" {
		upd.SetSlug(input.Slug)
	}
	if input.Title != "" {
		upd.SetTitle(input.Title)
	}
	if input.Visibility != "" {
		upd.SetVisibility(string(input.Visibility))
	}
	if input.ContentType != "" {
		upd.SetContentType(string(input.ContentType))
	}
	if input.ContentHTML != "" || input.ContentType == ContentTypeHTML {
		upd.SetNillableContentHTML(nillableString(input.ContentHTML))
	}
	if input.ContentReact != "" || input.ContentType == ContentTypeReact {
		upd.SetNillableContentReact(nillableString(input.ContentReact))
	}
	if input.Metadata != nil {
		upd.SetMetadata(input.Metadata)
	}
	if input.Enabled != nil {
		upd.SetEnabled(*input.Enabled)
	}
	updated, err := upd.Save(ctx)
	if err != nil {
		return nil, err
	}
	return entPageToPage(updated), nil
}

func (s *entPageStore) Delete(ctx context.Context, id int) error {
	return s.client.Page.DeleteOneID(id).Exec(ctx)
}

func (s *entPageStore) SlugExists(ctx context.Context, slug string, excludeID int) (bool, error) {
	q := s.client.Page.Query().Where(page.SlugEQ(slug))
	if excludeID > 0 {
		q = q.Where(page.IDNEQ(excludeID))
	}
	n, err := q.Count(ctx)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// entPageToPage 将 ent.Page 转为对外 Page。
func entPageToPage(p *ent.Page) *Page {
	return &Page{
		ID:           p.ID,
		Slug:         p.Slug,
		Title:        p.Title,
		Visibility:   PageVisibility(p.Visibility),
		ContentType:  PageContentType(p.ContentType),
		ContentHTML:  p.ContentHTML,
		ContentReact: p.ContentReact,
		Metadata:     p.Metadata,
		Enabled:      p.Enabled,
		PageID:       pageID(p.Slug),
		CreatedAt:    p.CreatedAt,
		UpdatedAt:    p.UpdatedAt,
	}
}

// nillableString 空字符串转 nil(Optional 字段)。
func nillableString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
