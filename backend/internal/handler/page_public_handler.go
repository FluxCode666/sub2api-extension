// Package handler 提供动态页面的公开获取端点。
//
// 端点(不经 AdminGuard, 在公开分组 /api/aux/pages):
//   - GET /api/aux/pages          列出公开页面(不含内容, 供前端 bootstrap 注册表合并)
//   - GET /api/aux/pages/:slug    按 slug 获取启用的公开页面(含内容, 供渲染)
//
// 公开端点返回 enabled 且 visibility=public 的页面。admin 页面不在此暴露。
// 上报埋点走现有 /api/aux/telemetry/* 端点。
package handler

import (
	"context"
	"errors"

	"aux-system/internal/pkg/response"
	"aux-system/internal/service"

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

// List GET /api/aux/pages
// 返回所有页面(含 admin 页)的 slug/title/visibility, 不含内容。
// 前端 bootstrap 时 fetch 此端点, 与静态 PAGE_REGISTRY 合并为统一注册表。
// 注: 返回所有页面(不限 public)以便管理端侧边栏也能用同一端点; 但内容获取需对应权限。
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
	response.Success(c, gin.H{"items": items})
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
	response.Success(c, p)
}
