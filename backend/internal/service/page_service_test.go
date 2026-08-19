package service

import (
	"context"
	"testing"
)

// fakePageStore 内存实现, 用于服务层单测(不依赖数据库)。
type fakePageStore struct {
	pages  map[int]*Page
	nextID int
}

func newFakePageStore() *fakePageStore {
	return &fakePageStore{pages: map[int]*Page{}, nextID: 1}
}

func (s *fakePageStore) Create(ctx context.Context, input PageInput) (*Page, error) {
	p := &Page{
		ID: s.nextID, Slug: input.Slug, Title: input.Title,
		Visibility: input.Visibility, ContentType: input.ContentType,
		ContentHTML: input.ContentHTML, ContentReact: input.ContentReact,
		Enabled: true, PageID: pageID(input.Slug),
	}
	if input.Enabled != nil {
		p.Enabled = *input.Enabled
	}
	s.pages[s.nextID] = p
	s.nextID++
	return p, nil
}

func (s *fakePageStore) List(ctx context.Context) ([]PageListItem, error) {
	items := make([]PageListItem, 0, len(s.pages))
	for _, p := range s.pages {
		items = append(items, PageListItem{
			ID: p.ID, Slug: p.Slug, Title: p.Title, Visibility: p.Visibility,
			ContentType: p.ContentType, Enabled: p.Enabled, Route: pageRoute(p.Slug, p.Visibility),
			PageID: p.PageID, UpdatedAt: p.UpdatedAt,
		})
	}
	return items, nil
}

func (s *fakePageStore) GetByID(ctx context.Context, id int) (*Page, error) {
	if p, ok := s.pages[id]; ok {
		return p, nil
	}
	return nil, errFakeNotFound
}

func (s *fakePageStore) GetBySlug(ctx context.Context, slug string) (*Page, error) {
	for _, p := range s.pages {
		if p.Slug == slug {
			return p, nil
		}
	}
	return nil, errFakeNotFound
}

func (s *fakePageStore) Update(ctx context.Context, id int, input PageInput) (*Page, error) {
	p, ok := s.pages[id]
	if !ok {
		return nil, errFakeNotFound
	}
	if input.Slug != "" {
		p.Slug = input.Slug
		p.PageID = pageID(input.Slug)
	}
	if input.Title != "" {
		p.Title = input.Title
	}
	if input.Visibility != "" {
		p.Visibility = input.Visibility
	}
	if input.ContentType != "" {
		p.ContentType = input.ContentType
	}
	if input.ContentHTML != "" {
		p.ContentHTML = input.ContentHTML
	}
	if input.ContentReact != "" {
		p.ContentReact = input.ContentReact
	}
	if input.Enabled != nil {
		p.Enabled = *input.Enabled
	}
	return p, nil
}

func (s *fakePageStore) Delete(ctx context.Context, id int) error {
	delete(s.pages, id)
	return nil
}

func (s *fakePageStore) SlugExists(ctx context.Context, slug string, excludeID int) (bool, error) {
	for id, p := range s.pages {
		if p.Slug == slug && id != excludeID {
			return true, nil
		}
	}
	return false, nil
}

var errFakeNotFound = errFake("not found")

type errFake string

func (e errFake) Error() string { return string(e) }

func TestPageService_Create_Validation(t *testing.T) {
	store := newFakePageStore()
	svc := NewPageService(store)
	ctx := context.Background()

	// 有效创建
	p, err := svc.Create(ctx, PageInput{Slug: "landing", Title: "Landing", Visibility: VisibilityPublic, ContentType: ContentTypeHTML, ContentHTML: "<h1>Hi</h1>"})
	if err != nil {
		t.Fatalf("Create valid: unexpected err %v", err)
	}
	if p.Slug != "landing" || p.PageID != "page:landing" {
		t.Errorf("Create: slug=%s pageID=%s, want landing/page:landing", p.Slug, p.PageID)
	}

	// 官网首页现在是数据库动态页，home slug 可以由页面管理维护。
	if _, err := svc.Create(ctx, PageInput{Slug: "home", Title: "Homepage"}); err != nil {
		t.Fatalf("Create: home should be a dynamic page slug: %v", err)
	}

	// slug 冲突静态核心页
	if _, err := svc.Create(ctx, PageInput{Slug: "dashboard", Title: "X"}); err == nil {
		t.Error("Create: expected err for slug conflicting with static core id 'dashboard'")
	}

	// slug 格式非法
	if _, err := svc.Create(ctx, PageInput{Slug: "Bad Slug", Title: "X"}); err == nil {
		t.Error("Create: expected err for invalid slug format")
	}

	// slug 重复
	if _, err := svc.Create(ctx, PageInput{Slug: "landing", Title: "Dup"}); err == nil {
		t.Error("Create: expected ErrSlugConflict for duplicate slug")
	}

	// title 缺失
	if _, err := svc.Create(ctx, PageInput{Slug: "notitle", Title: ""}); err == nil {
		t.Error("Create: expected err for missing title")
	}

	// 内容超限
	big := make([]byte, maxContentBytes+1)
	for i := range big {
		big[i] = 'a'
	}
	if _, err := svc.Create(ctx, PageInput{Slug: "toobig", Title: "Big", ContentHTML: string(big)}); err == nil {
		t.Error("Create: expected err for content exceeding size limit")
	}

	// Logo 元数据只接受 HTTP(S) 地址；图片内容由图片资源页以文件形式管理。
	if _, err := svc.Create(ctx, PageInput{Slug: "logo-url", Title: "Logo URL", Metadata: map[string]interface{}{"logo": "https://example.com/logo.svg"}}); err != nil {
		t.Fatalf("Create: valid logo URL returned err %v", err)
	}
	if _, err := svc.Create(ctx, PageInput{Slug: "logo-data", Title: "Logo Data", Metadata: map[string]interface{}{"logo": "data:image/png;base64,AAAA"}}); err == nil {
		t.Error("Create: expected err for data URL logo")
	}
	if _, err := svc.Create(ctx, PageInput{Slug: "logo-invalid", Title: "Logo Invalid", Metadata: map[string]interface{}{"logo": "javascript:alert(1)"}}); err == nil {
		t.Error("Create: expected err for invalid logo URL")
	}
}

func TestPageService_GetPublicBySlug(t *testing.T) {
	store := newFakePageStore()
	svc := NewPageService(store)
	ctx := context.Background()

	// 创建 public 页 + admin 页 + 停用页
	store.pages[1] = &Page{ID: 1, Slug: "pub", Title: "Pub", Visibility: VisibilityPublic, Enabled: true, PageID: "page:pub"}
	store.pages[2] = &Page{ID: 2, Slug: "adm", Title: "Adm", Visibility: VisibilityAdmin, Enabled: true, PageID: "page:adm"}
	store.pages[3] = &Page{ID: 3, Slug: "off", Title: "Off", Visibility: VisibilityPublic, Enabled: false, PageID: "page:off"}

	// public 页可取
	if _, err := svc.GetPublicBySlug(ctx, "pub"); err != nil {
		t.Errorf("GetPublicBySlug(pub): unexpected err %v", err)
	}
	// admin 页 404(公开端不暴露)
	if _, err := svc.GetPublicBySlug(ctx, "adm"); err == nil {
		t.Error("GetPublicBySlug(adm): expected err for admin page on public fetch")
	}
	// 停用页 404
	if _, err := svc.GetPublicBySlug(ctx, "off"); err == nil {
		t.Error("GetPublicBySlug(off): expected err for disabled page")
	}
}

func TestPageService_Update(t *testing.T) {
	store := newFakePageStore()
	svc := NewPageService(store)
	ctx := context.Background()

	p, _ := svc.Create(ctx, PageInput{Slug: "orig", Title: "Orig", Visibility: VisibilityPublic, ContentType: ContentTypeHTML})
	enabled := false
	updated, err := svc.Update(ctx, p.ID, PageInput{Title: "Updated", Enabled: &enabled})
	if err != nil {
		t.Fatalf("Update: unexpected err %v", err)
	}
	if updated.Title != "Updated" {
		t.Errorf("Update: title=%s, want Updated", updated.Title)
	}
	if updated.Enabled != false {
		t.Errorf("Update: enabled=%v, want false", updated.Enabled)
	}
}

func TestPageRoute(t *testing.T) {
	if r := pageRoute("foo", VisibilityPublic); r != "/p/foo" {
		t.Errorf("pageRoute(public): %s, want /p/foo", r)
	}
	if r := pageRoute("bar", VisibilityAdmin); r != "/admin/p/bar" {
		t.Errorf("pageRoute(admin): %s, want /admin/p/bar", r)
	}
}
