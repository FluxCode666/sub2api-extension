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
	"log"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"sub2api-extension/ent"
	"sub2api-extension/ent/page"
	"sub2api-extension/internal/sub2apimenu"
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

// logo 元数据只保存图片 URL；图片文件通过文件管理页上传，不内联写入页面 JSON。
const maxLogoURLBytes = 4096

// slugPattern slug 允许的字符: 小写字母/数字/连字符, 1-128 字符。
var slugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// staticCorePageIDs 静态核心页 id, slug 不得与之冲突(避免 page_id 命名空间碰撞)。
var staticCorePageIDs = map[string]bool{
	"dashboard": true,
}

// PageInput 创建/更新页面的输入。
type PageInput struct {
	Slug              string                 `json:"slug"`
	Title             string                 `json:"title"`
	Visibility        PageVisibility         `json:"visibility"`
	ContentType       PageContentType        `json:"content_type"`
	ContentHTML       string                 `json:"content_html"`
	ContentReact      string                 `json:"content_react"`
	Metadata          map[string]interface{} `json:"metadata,omitempty"` // 页面元数据(键值对)
	Enabled           *bool                  `json:"enabled"`            // 指针: 更新时 nil 表示不改
	Sub2APIPublished  *bool                  `json:"sub2api_published,omitempty"`
	Sub2APIVisibility string                 `json:"sub2api_visibility,omitempty"` // user 或 admin
	Sub2APIMenuName   string                 `json:"sub2api_menu_name,omitempty"`
}

// Page 动态页面实体(对外契约)。
type Page struct {
	ID                int                    `json:"id"`
	Slug              string                 `json:"slug"`
	Title             string                 `json:"title"`
	Visibility        PageVisibility         `json:"visibility"`
	ContentType       PageContentType        `json:"content_type"`
	ContentHTML       string                 `json:"content_html,omitempty"`
	ContentReact      string                 `json:"content_react,omitempty"`
	Metadata          map[string]interface{} `json:"metadata,omitempty"` // 页面元数据(键值对)
	Enabled           bool                   `json:"enabled"`
	PageID            string                 `json:"page_id"` // "page:<slug>", 埋点命名空间
	CreatedAt         time.Time              `json:"created_at"`
	UpdatedAt         time.Time              `json:"updated_at"`
	Sub2APIPublished  bool                   `json:"sub2api_published"`
	Sub2APIVisibility string                 `json:"sub2api_visibility,omitempty"`
	Sub2APIMenuName   string                 `json:"sub2api_menu_name,omitempty"`
}

// PageListItem 列表项(不含内容, 减小负载)。
type PageListItem struct {
	ID                int             `json:"id"`
	Slug              string          `json:"slug"`
	Title             string          `json:"title"`
	Visibility        PageVisibility  `json:"visibility"`
	ContentType       PageContentType `json:"content_type"`
	Enabled           bool            `json:"enabled"`
	Route             string          `json:"route"` // /p/<slug> 或 /admin/p/<slug>
	PageID            string          `json:"page_id"`
	MenuIcon          string          `json:"menu_icon,omitempty"` // 管理员侧边栏图标名(metadata.menu_icon)
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
	Sub2APIPublished  bool            `json:"sub2api_published"`
	Sub2APIVisibility string          `json:"sub2api_visibility,omitempty"`
	Sub2APIMenuName   string          `json:"sub2api_menu_name,omitempty"`
}

// PagePublisher 将页面上架配置同步到 sub2api。它是可选依赖，未配置 sub2api
// 数据库时页面 CRUD 仍可正常工作。
type PagePublisher = sub2apimenu.Publisher

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
	store     PageStore
	publisher PagePublisher
}

func NewPageService(store PageStore, publishers ...PagePublisher) *PageService {
	var publisher PagePublisher
	if len(publishers) > 0 {
		publisher = publishers[0]
	}
	return &PageService{store: store, publisher: publisher}
}

// Create 创建页面。校验 slug/visibility/content_type/content 大小。
func (s *PageService) Create(ctx context.Context, input PageInput) (*Page, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("page store is unavailable")
	}
	if err := validatePageInput(input, true); err != nil {
		log.Printf("[PageService.Create] validation failed slug=%q: %v", input.Slug, err)
		return nil, err
	}
	exists, err := s.store.SlugExists(ctx, input.Slug, 0)
	if err != nil {
		log.Printf("[PageService.Create] slug existence check failed slug=%q: %v", input.Slug, err)
		return nil, err
	}
	if exists {
		log.Printf("[PageService.Create] slug conflict slug=%q", input.Slug)
		return nil, ErrSlugConflict
	}
	normalized := normalizeInput(input)
	created, err := s.store.Create(ctx, normalized)
	if err != nil {
		log.Printf("[PageService.Create] store create failed slug=%q: %v", normalized.Slug, err)
		return nil, err
	}
	applyPublicationFields(created, normalized)
	if err := s.syncPublication(ctx, nil, created); err != nil {
		log.Printf("[PageService.Create] page persisted with sub2api sync warning page_id=%d slug=%q published=%t: %v", created.ID, created.Slug, created.Sub2APIPublished, err)
		return created, &PublicationSyncError{Page: created, Err: err}
	}
	log.Printf("[PageService.Create] page persisted page_id=%d slug=%q published=%t", created.ID, created.Slug, created.Sub2APIPublished)
	return created, nil
}

// List 列出所有页面(不含内容)。
func (s *PageService) List(ctx context.Context) ([]PageListItem, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("page store is unavailable")
	}
	return s.store.List(ctx)
}

// ListAdmin 列出页面并从 sub2api custom_menu_items 补充上架状态。
// 公开页面清单不调用该方法，避免 sub2api 数据库短暂不可用影响公开页面。
func (s *PageService) ListAdmin(ctx context.Context) ([]PageListItem, error) {
	started := time.Now()
	items, err := s.List(ctx)
	if err != nil {
		log.Printf("[PageService.ListAdmin] page store list failed elapsed=%s: %v", time.Since(started), err)
		return items, err
	}
	if s.publisher == nil {
		for i := range items {
			// Without a live publisher there is no authoritative sub2api state.
			// Do not surface the page's last requested value as if it were verified.
			items[i].Sub2APIPublished = false
		}
		log.Printf("[PageService.ListAdmin] publisher unavailable pages=%d published=0 elapsed=%s", len(items), time.Since(started))
		return items, err
	}
	published, err := s.publisher.List(ctx)
	if err != nil {
		log.Printf("[PageService.ListAdmin] sub2api menu list failed pages=%d: %v", len(items), err)
		// 不要把 sub2api 查询错误降级为成功：调用方需要感知真实故障，
		// 否则管理页会显示可能已经过期的上架状态。
		return nil, err
	}
	matchedCount := 0
	mismatchCount := 0
	for i := range items {
		items[i].Sub2APIPublished = false
		expected := pagePublicationForFields(items[i].ID, items[i].PageID, items[i].Slug, items[i].Title, items[i].Visibility, items[i].Sub2APIVisibility, items[i].Sub2APIMenuName)
		if publication, ok := published[expected.MenuID]; ok {
			matched, reason := s.publicationMatches(expected, publication)
			if matched {
				matchedCount++
				items[i].Sub2APIPublished = true
				items[i].Sub2APIVisibility = publication.Visibility
				items[i].Sub2APIMenuName = publication.Label
			} else {
				mismatchCount++
				log.Printf("[PageService.ListAdmin] sub2api publication mismatch page_id=%d menu_id=%q: %s", items[i].ID, expected.MenuID, reason)
			}
		}
	}
	log.Printf("[PageService.ListAdmin] loaded pages=%d menu_items=%d matched=%d mismatched=%d elapsed=%s", len(items), len(published), matchedCount, mismatchCount, time.Since(started))
	return items, nil
}

// GetByID 按 id 获取(含内容, 管理端用)。
func (s *PageService) GetByID(ctx context.Context, id int) (*Page, error) {
	started := time.Now()
	if s == nil || s.store == nil {
		return nil, errors.New("page store is unavailable")
	}
	p, err := s.store.GetByID(ctx, id)
	if err != nil {
		log.Printf("[PageService.GetByID] page store get failed page_id=%d elapsed=%s: %v", id, time.Since(started), err)
		return p, err
	}
	if s.publisher == nil {
		p.Sub2APIPublished = false
		log.Printf("[PageService.GetByID] publisher unavailable page_id=%d elapsed=%s", id, time.Since(started))
		return p, err
	}
	published, err := s.publisher.List(ctx)
	if err != nil {
		log.Printf("[PageService.GetByID] sub2api menu list failed page_id=%d: %v", p.ID, err)
		// 不吞掉同步查询错误，避免返回不可信的上架状态。
		return nil, err
	}
	expected := pagePublicationForPage(p)
	if publication, ok := published[expected.MenuID]; ok {
		matched, reason := s.publicationMatches(expected, publication)
		if matched {
			p.Sub2APIPublished = true
			p.Sub2APIVisibility = publication.Visibility
			p.Sub2APIMenuName = publication.Label
		} else {
			p.Sub2APIPublished = false
			log.Printf("[PageService.GetByID] sub2api publication mismatch page_id=%d menu_id=%q: %s", p.ID, expected.MenuID, reason)
		}
	} else {
		p.Sub2APIPublished = false
	}
	log.Printf("[PageService.GetByID] loaded page_id=%d published=%t elapsed=%s", p.ID, p.Sub2APIPublished, time.Since(started))
	return p, nil
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
		log.Printf("[PageService.Update] validation failed page_id=%d slug=%q: %v", id, input.Slug, err)
		return nil, err
	}
	if input.Slug != "" {
		exists, err := s.store.SlugExists(ctx, input.Slug, id)
		if err != nil {
			log.Printf("[PageService.Update] slug existence check failed page_id=%d slug=%q: %v", id, input.Slug, err)
			return nil, err
		}
		if exists {
			log.Printf("[PageService.Update] slug conflict page_id=%d slug=%q", id, input.Slug)
			return nil, ErrSlugConflict
		}
	}
	previous, err := s.store.GetByID(ctx, id)
	if err != nil {
		log.Printf("[PageService.Update] load page failed page_id=%d: %v", id, err)
		return nil, err
	}
	input = mergePublicationInput(previous, input)
	normalized := normalizeInput(input)
	updated, err := s.store.Update(ctx, id, normalized)
	if err != nil {
		log.Printf("[PageService.Update] store update failed page_id=%d: %v", id, err)
		return nil, err
	}
	applyPublicationFields(updated, normalized)
	if err := s.syncPublication(ctx, previous, updated); err != nil {
		log.Printf("[PageService.Update] page persisted with sub2api sync warning page_id=%d slug=%q published=%t: %v", updated.ID, updated.Slug, updated.Sub2APIPublished, err)
		return updated, &PublicationSyncError{Page: updated, Err: err}
	}
	log.Printf("[PageService.Update] page persisted page_id=%d slug=%q published=%t", updated.ID, updated.Slug, updated.Sub2APIPublished)
	return updated, nil
}

// Delete 删除页面。埋点历史(page_views/feature_clicks)保留(只追加表不动)。
func (s *PageService) Delete(ctx context.Context, id int) error {
	if s == nil || s.store == nil {
		return errors.New("page store is unavailable")
	}
	previous, err := s.store.GetByID(ctx, id)
	if err != nil {
		log.Printf("[PageService.Delete] load page failed page_id=%d: %v", id, err)
		return err
	}
	if s.publisher == nil && previous.Sub2APIPublished {
		err := errors.New("sub2api menu publisher is unavailable")
		log.Printf("[PageService.Delete] cannot unpublish published page_id=%d: %v", previous.ID, err)
		return err
	}
	if s.publisher != nil {
		menuID := menuIDForPageID(strconv.Itoa(previous.ID))
		log.Printf("[PageService.Delete] unpublish before delete page_id=%d menu_id=%q", previous.ID, menuID)
		if err := s.publisher.Unpublish(ctx, menuID); err != nil {
			log.Printf("[PageService.Delete] unpublish failed page_id=%d menu_id=%q: %v", previous.ID, menuID, err)
			return err
		}
	}
	if err := s.store.Delete(ctx, id); err != nil {
		log.Printf("[PageService.Delete] store delete failed page_id=%d: %v", id, err)
		return err
	}
	log.Printf("[PageService.Delete] deleted page_id=%d slug=%q", previous.ID, previous.Slug)
	return nil
}

func menuIDForPageID(pageID string) string {
	// sub2api 限制 custom menu id 最长 32 字符；数字主键既稳定又足够短。
	return "aux-page-" + pageID
}

func pagePublicationForPage(page *Page) sub2apimenu.PagePublication {
	if page == nil {
		return sub2apimenu.PagePublication{}
	}
	return pagePublicationForFields(page.ID, page.PageID, page.Slug, page.Title, page.Visibility, page.Sub2APIVisibility, page.Sub2APIMenuName)
}

func pagePublicationForFields(id int, pageID, slug, title string, pageVisibility PageVisibility, sub2apiVisibility, menuName string) sub2apimenu.PagePublication {
	visibility := sub2apiVisibility
	if visibility != "user" && visibility != "admin" {
		visibility = "user"
		if pageVisibility == VisibilityAdmin {
			visibility = "admin"
		}
	}
	label := strings.TrimSpace(menuName)
	if label == "" {
		label = strings.TrimSpace(title)
	}
	return sub2apimenu.PagePublication{
		MenuID:     menuIDForPageID(strconv.Itoa(id)),
		PageID:     pageID,
		Slug:       slug,
		Label:      label,
		URL:        pageRoute(slug, pageVisibility),
		Visibility: visibility,
	}
}

func (s *PageService) publicationMatches(expected, actual sub2apimenu.PagePublication) (bool, string) {
	if matcher, ok := s.publisher.(sub2apimenu.PublicationMatcher); ok {
		return matcher.PublicationMatches(expected, actual)
	}
	if expected.MenuID != actual.MenuID {
		return false, "menu id changed"
	}
	if expected.Label != actual.Label {
		return false, "menu label changed"
	}
	if expected.Visibility != actual.Visibility {
		return false, "menu visibility changed"
	}
	if expected.PageSlug != actual.PageSlug {
		return false, "menu page_slug changed"
	}
	actualURL, err := url.ParseRequestURI(strings.TrimSpace(actual.URL))
	if err != nil || actualURL.Path != expected.URL || actualURL.RawQuery != "" || actualURL.Fragment != "" {
		return false, "menu URL changed"
	}
	return true, ""
}

func (s *PageService) syncPublication(ctx context.Context, previous, current *Page) error {
	started := time.Now()
	if current == nil {
		return nil
	}
	if s.publisher == nil {
		needsSync := current.Sub2APIPublished || (previous != nil && previous.Sub2APIPublished && !current.Sub2APIPublished)
		if needsSync {
			err := errors.New("sub2api menu publisher is unavailable")
			log.Printf("[PageService.syncPublication] cannot synchronize page_id=%d slug=%q published=%t: %v", current.ID, current.Slug, current.Sub2APIPublished, err)
			return err
		}
		log.Printf("[PageService.syncPublication] skipped page_id=%d slug=%q publisher_configured=false published=false elapsed=%s", current.ID, current.Slug, time.Since(started))
		return nil
	}
	if previous != nil && previous.Sub2APIPublished && !current.Sub2APIPublished {
		log.Printf("[PageService.syncPublication] unpublish page_id=%d slug=%q", current.ID, current.Slug)
		menuID := menuIDForPageID(strconv.Itoa(previous.ID))
		if err := s.publisher.Unpublish(ctx, menuID); err != nil {
			log.Printf("[PageService.syncPublication] unpublish failed page_id=%d menu_id=%q elapsed=%s: %v", current.ID, menuID, time.Since(started), err)
			return err
		}
		log.Printf("[PageService.syncPublication] unpublish succeeded page_id=%d menu_id=%q elapsed=%s", current.ID, menuID, time.Since(started))
		return nil
	}
	if !current.Sub2APIPublished {
		log.Printf("[PageService.syncPublication] no-op unpublished page_id=%d slug=%q", current.ID, current.Slug)
		return nil
	}
	publication := pagePublicationForPage(current)
	visibility := publication.Visibility
	log.Printf("[PageService.syncPublication] publish page_id=%d slug=%q menu_id=%q visibility=%q", current.ID, current.Slug, menuIDForPageID(strconv.Itoa(current.ID)), visibility)
	err := s.publisher.Publish(ctx, publication)
	if err != nil {
		log.Printf("[PageService.syncPublication] publish failed page_id=%d slug=%q elapsed=%s: %v", current.ID, current.Slug, time.Since(started), err)
		return err
	}
	log.Printf("[PageService.syncPublication] publish succeeded page_id=%d slug=%q elapsed=%s", current.ID, current.Slug, time.Since(started))
	return nil
}

func mergePublicationInput(previous *Page, input PageInput) PageInput {
	if input.Sub2APIPublished == nil {
		value := previous.Sub2APIPublished
		input.Sub2APIPublished = &value
	}
	if input.Sub2APIVisibility == "" {
		input.Sub2APIVisibility = previous.Sub2APIVisibility
	}
	if input.Sub2APIMenuName == "" {
		input.Sub2APIMenuName = previous.Sub2APIMenuName
	}
	if input.Metadata == nil {
		input.Metadata = previous.Metadata
	}
	return input
}

func applyPublicationFields(page *Page, input PageInput) {
	if page == nil {
		return
	}
	if input.Sub2APIPublished != nil {
		page.Sub2APIPublished = *input.Sub2APIPublished
	}
	if input.Sub2APIVisibility != "" {
		page.Sub2APIVisibility = input.Sub2APIVisibility
	}
	if input.Sub2APIMenuName != "" {
		page.Sub2APIMenuName = input.Sub2APIMenuName
	}
}

// 服务层错误。
var (
	ErrSlugConflict = errors.New("slug already exists")
	ErrPageNotFound = errors.New("page not found")
)

// PublicationSyncError 表示页面主数据已经持久化，但 sub2api 菜单同步失败。
// 该错误必须由管理端转换为 2xx + warning，避免用户重复提交造成重复页面。
type PublicationSyncError struct {
	Page *Page
	Err  error
}

func (e *PublicationSyncError) Error() string {
	if e == nil || e.Err == nil {
		return "sub2api publication sync failed after page persisted"
	}
	return "sub2api publication sync failed after page persisted: " + e.Err.Error()
}

func (e *PublicationSyncError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

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
	if input.Sub2APIVisibility != "" && input.Sub2APIVisibility != "user" && input.Sub2APIVisibility != "admin" {
		return fmt.Errorf("invalid sub2api_visibility: %s", input.Sub2APIVisibility)
	}
	if len([]rune(input.Sub2APIMenuName)) > 50 || len(input.Sub2APIMenuName) > 50 {
		return errors.New("sub2api_menu_name exceeds 50 characters or bytes")
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
	if input.Sub2APIVisibility == "" {
		if input.Visibility == VisibilityAdmin {
			input.Sub2APIVisibility = "admin"
		} else {
			input.Sub2APIVisibility = "user"
		}
	}
	input.Sub2APIMenuName = strings.TrimSpace(input.Sub2APIMenuName)
	if input.Sub2APIMenuName == "" {
		input.Sub2APIMenuName = input.Title
	}
	if input.Sub2APIPublished == nil {
		published := false
		input.Sub2APIPublished = &published
	}
	input.Metadata = withPublicationMetadata(input.Metadata, *input.Sub2APIPublished, input.Sub2APIVisibility, input.Sub2APIMenuName)
	return input
}

func withPublicationMetadata(metadata map[string]interface{}, published bool, visibility, menuName string) map[string]interface{} {
	if metadata == nil {
		metadata = map[string]interface{}{}
	} else {
		copy := make(map[string]interface{}, len(metadata)+3)
		for key, value := range metadata {
			copy[key] = value
		}
		metadata = copy
	}
	metadata["sub2api_published"] = published
	metadata["sub2api_visibility"] = visibility
	metadata["sub2api_menu_name"] = menuName
	return metadata
}

func publicationFromMetadata(metadata map[string]interface{}, pageVisibility PageVisibility, title string) (bool, string, string) {
	published, _ := metadata["sub2api_published"].(bool)
	visibility, _ := metadata["sub2api_visibility"].(string)
	if visibility != "user" && visibility != "admin" {
		visibility = "user"
		if pageVisibility == VisibilityAdmin {
			visibility = "admin"
		}
	}
	menuName, _ := metadata["sub2api_menu_name"].(string)
	if strings.TrimSpace(menuName) == "" {
		menuName = title
	}
	return published, visibility, strings.TrimSpace(menuName)
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
		menuIcon := ""
		if p.Visibility == string(VisibilityAdmin) {
			if raw, ok := p.Metadata["menu_icon"].(string); ok {
				menuIcon = strings.TrimSpace(raw)
			}
		}
		items = append(items, PageListItem{
			ID:          p.ID,
			Slug:        p.Slug,
			Title:       p.Title,
			Visibility:  PageVisibility(p.Visibility),
			ContentType: PageContentType(p.ContentType),
			Enabled:     p.Enabled,
			Route:       pageRoute(p.Slug, PageVisibility(p.Visibility)),
			PageID:      pageID(p.Slug),
			MenuIcon:    menuIcon,
			CreatedAt:   p.CreatedAt,
			UpdatedAt:   p.UpdatedAt,
			Sub2APIPublished: func() bool {
				published, _, _ := publicationFromMetadata(p.Metadata, PageVisibility(p.Visibility), p.Title)
				return published
			}(),
			Sub2APIVisibility: func() string {
				_, visibility, _ := publicationFromMetadata(p.Metadata, PageVisibility(p.Visibility), p.Title)
				return visibility
			}(),
			Sub2APIMenuName: func() string {
				_, _, menuName := publicationFromMetadata(p.Metadata, PageVisibility(p.Visibility), p.Title)
				return menuName
			}(),
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
	published, sub2apiVisibility, sub2apiMenuName := publicationFromMetadata(p.Metadata, PageVisibility(p.Visibility), p.Title)
	return &Page{
		ID:                p.ID,
		Slug:              p.Slug,
		Title:             p.Title,
		Visibility:        PageVisibility(p.Visibility),
		ContentType:       PageContentType(p.ContentType),
		ContentHTML:       p.ContentHTML,
		ContentReact:      p.ContentReact,
		Metadata:          p.Metadata,
		Enabled:           p.Enabled,
		PageID:            pageID(p.Slug),
		CreatedAt:         p.CreatedAt,
		UpdatedAt:         p.UpdatedAt,
		Sub2APIPublished:  published,
		Sub2APIVisibility: sub2apiVisibility,
		Sub2APIMenuName:   sub2apiMenuName,
	}
}

// nillableString 空字符串转 nil(Optional 字段)。
func nillableString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
