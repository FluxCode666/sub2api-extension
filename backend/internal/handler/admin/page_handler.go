// Package admin 提供动态页面管理的管理员端点。
//
// 端点(受 AdminGuard 保护):
//   - GET    /api/aux/admin/pages          列出所有页面(不含内容)
//   - POST   /api/aux/admin/pages          创建页面
//   - GET    /api/aux/admin/pages/:id      按 id 获取(含内容)
//   - PUT    /api/aux/admin/pages/:id      更新页面
//   - DELETE /api/aux/admin/pages/:id      删除页面
//
// 风格镜像 homepage_config_handler.go: 小 provider interface + 构造函数 + envelope 响应。
package admin

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"sub2api-extension/ent"
	"sub2api-extension/internal/pkg/response"
	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
)

// pageProvider 抽象 page service, 便于单测注入 mock。
type pageProvider interface {
	Create(ctx context.Context, input service.PageInput) (*service.Page, error)
	List(ctx context.Context) ([]service.PageListItem, error)
	GetByID(ctx context.Context, id int) (*service.Page, error)
	GetAdminBySlug(ctx context.Context, slug string) (*service.Page, error)
	Update(ctx context.Context, id int, input service.PageInput) (*service.Page, error)
	Delete(ctx context.Context, id int) error
}

// PageHandler 处理动态页面管理端点。
type PageHandler struct {
	provider pageProvider
}

func NewPageHandler(svc *service.PageService) *PageHandler {
	return &PageHandler{provider: svc}
}

// List GET /api/aux/admin/pages
func (h *PageHandler) List(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.InternalError(c, "page store is unavailable")
		return
	}
	items, err := h.provider.List(c.Request.Context())
	if err != nil {
		response.InternalError(c, "failed to list pages")
		return
	}
	response.Success(c, gin.H{"items": items})
}

// Create POST /api/aux/admin/pages
func (h *PageHandler) Create(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.InternalError(c, "page store is unavailable")
		return
	}
	var input service.PageInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "invalid page input")
		return
	}
	p, err := h.provider.Create(c.Request.Context(), input)
	if err != nil {
		handlePageError(c, err)
		return
	}
	response.Created(c, p)
}

// GetByID GET /api/aux/admin/pages/:id
func (h *PageHandler) GetByID(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.InternalError(c, "page store is unavailable")
		return
	}
	id, err := parseID(c)
	if err != nil {
		response.BadRequest(c, "invalid page id")
		return
	}
	p, err := h.provider.GetByID(c.Request.Context(), id)
	if err != nil {
		handlePageError(c, err)
		return
	}
	response.Success(c, p)
}

// GetBySlug GET /api/aux/admin/pages/slug/:slug
// 管理端按 slug 获取启用的 admin 页面(含内容, 供 /admin/p/:slug 渲染)。
func (h *PageHandler) GetBySlug(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.InternalError(c, "page store is unavailable")
		return
	}
	slug := c.Param("slug")
	if slug == "" {
		response.BadRequest(c, "slug is required")
		return
	}
	p, err := h.provider.GetAdminBySlug(c.Request.Context(), slug)
	if err != nil {
		handlePageError(c, err)
		return
	}
	response.Success(c, p)
}

// Update PUT /api/aux/admin/pages/:id
func (h *PageHandler) Update(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.InternalError(c, "page store is unavailable")
		return
	}
	id, err := parseID(c)
	if err != nil {
		response.BadRequest(c, "invalid page id")
		return
	}
	var input service.PageInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "invalid page input")
		return
	}
	p, err := h.provider.Update(c.Request.Context(), id, input)
	if err != nil {
		handlePageError(c, err)
		return
	}
	response.Success(c, p)
}

// Delete DELETE /api/aux/admin/pages/:id
func (h *PageHandler) Delete(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.InternalError(c, "page store is unavailable")
		return
	}
	id, err := parseID(c)
	if err != nil {
		response.BadRequest(c, "invalid page id")
		return
	}
	if err := h.provider.Delete(c.Request.Context(), id); err != nil {
		handlePageError(c, err)
		return
	}
	response.Success(c, gin.H{"deleted": true})
}

// parseID 从 :id 路径参数解析正整数。
func parseID(c *gin.Context) (int, error) {
	return strconv.Atoi(c.Param("id"))
}

// handlePageError 将服务层错误映射为 HTTP 响应。
func handlePageError(c *gin.Context, err error) {
	if errors.Is(err, service.ErrSlugConflict) {
		response.ErrorWithReason(c, http.StatusConflict, "slug already exists", err.Error())
		return
	}
	if errors.Is(err, service.ErrPageNotFound) || ent.IsNotFound(err) {
		response.Error(c, http.StatusNotFound, "page not found")
		return
	}
	// 校验错误(格式/大小/冲突)返回 400
	if isValidationError(err) {
		response.BadRequest(c, err.Error())
		return
	}
	response.InternalError(c, "page operation failed")
}

// isValidationError 判断是否服务层校验错误(非 sentinel)。
func isValidationError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "invalid") || strings.Contains(msg, "required") || strings.Contains(msg, "exceeds") || strings.Contains(msg, "conflicts")
}
