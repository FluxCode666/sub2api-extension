// Package handler 提供动态页面的公开获取端点。
//
// 端点(不经 AdminGuard, 在公开分组 /api/aux/pages):
//   - GET /api/aux/pages          列出已启用的公开页面(不含内容, 供前端 bootstrap 注册表合并)
//   - GET /api/aux/pages/:slug    按 slug 获取启用的公开页面(含内容, 供渲染)
//
// 公开端点返回 enabled 且 visibility=public 的页面。admin 页面不在此暴露。
// 上报埋点走现有 /api/aux/telemetry/* 端点。
package handler

import (
	"context"
	"errors"

	"sub2api-extension/internal/pkg/response"
	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
)

// pagePublicProvider 抽象 page service 的公开读取能力, 便于单测注入 mock。
type pagePublicProvider interface {
	List(ctx context.Context) ([]service.PageListItem, error)
	GetPublicBySlug(ctx context.Context, slug string) (*service.Page, error)
}

// PagePublicHandler 处理动态页面的公开获取。
type PagePublicHandler struct {
	provider pagePublicProvider
}

func NewPagePublicHandler(svc *service.PageService) *PagePublicHandler {
	return &PagePublicHandler{provider: svc}
}

// newPagePublicHandlerWithProvider 用任意 pagePublicProvider 构造 handler(测试友好)。
func newPagePublicHandlerWithProvider(provider pagePublicProvider) *PagePublicHandler {
	return &PagePublicHandler{provider: provider}
}

// List GET /api/aux/pages
// 只返回已启用的公开页面元数据, 不返回 admin 页面标题、slug 或 route。
// 管理端侧边栏需要 admin 页面时, 通过受 AdminGuard 保护的 /admin/pages 获取完整清单。
func (h *PagePublicHandler) List(c *gin.Context) {
	if h == nil || h.provider == nil {
		// store 不可用时返回空列表, 不阻塞前端 bootstrap(静态页仍可用)。
		response.Success(c, gin.H{"items": []any{}})
		return
	}
	items, err := h.provider.List(c.Request.Context())
	if err != nil {
		response.Success(c, gin.H{"items": []any{}})
		return
	}
	publicItems := make([]service.PageListItem, 0, len(items))
	for _, item := range items {
		if item.Enabled && item.Visibility == service.VisibilityPublic {
			// sub2api 菜单名称/角色属于管理配置，不通过公开页面清单暴露。
			item.Sub2APIPublished = false
			item.Sub2APIVisibility = ""
			item.Sub2APIMenuName = ""
			publicItems = append(publicItems, item)
		}
	}
	response.Success(c, gin.H{"items": publicItems})
}

// GetBySlug GET /api/aux/pages/:slug
// 返回启用的公开页面(含内容)。admin 页或停用页返回 404。
func (h *PagePublicHandler) GetBySlug(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.Error(c, 404, "page not found")
		return
	}
	slug := c.Param("slug")
	if slug == "" {
		response.BadRequest(c, "slug is required")
		return
	}
	p, err := h.provider.GetPublicBySlug(c.Request.Context(), slug)
	if err != nil {
		if errors.Is(err, service.ErrPageNotFound) {
			response.Error(c, 404, "page not found")
			return
		}
		response.Error(c, 404, "page not found")
		return
	}
	// 上架配置仅供管理端使用；公开页面响应不应携带角色、菜单名或内部开关。
	p.Sub2APIPublished = false
	p.Sub2APIVisibility = ""
	p.Sub2APIMenuName = ""
	if p.Metadata != nil {
		metadata := make(map[string]interface{}, len(p.Metadata))
		for key, value := range p.Metadata {
			if key != "sub2api_published" && key != "sub2api_visibility" && key != "sub2api_menu_name" {
				metadata[key] = value
			}
		}
		p.Metadata = metadata
	}
	response.Success(c, p)
}
