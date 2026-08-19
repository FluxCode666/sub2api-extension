// Package handler 提供附属内容系统的 HTTP 处理器。
//
// TelemetryHandler 实现埋点上报端点:
//   - POST /api/aux/telemetry/page-view   页面访问埋点
//   - POST /api/aux/telemetry/feature-click 功能使用埋点
//
// 这些端点注册在公开分组(/api/aux),不经 AdminGuard —— 匿名访客也能上报(R8/R11)。
// 上报失败时返回明确错误码,但前端 SDK 会静默丢弃,不阻塞页面(KTD4)。
package handler

import (
	"errors"

	"sub2api-extension/internal/pkg/response"
	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
)

// TelemetryHandler 处理埋点上报。
type TelemetryHandler struct {
	telemetryService *service.TelemetryService
}

// NewTelemetryHandler 创建 telemetry handler。
func NewTelemetryHandler(telemetryService *service.TelemetryService) *TelemetryHandler {
	return &TelemetryHandler{telemetryService: telemetryService}
}

// PageViewRequest 页面访问埋点请求体。
type PageViewRequest struct {
	// PageID 来自 page-registry 的页面 id(KTD7)。
	PageID string `json:"page_id" binding:"required"`
	// VisitorID 匿名访客 id(localStorage 生成,持久化)。
	VisitorID string `json:"visitor_id" binding:"required"`
	// IsAdmin 是否管理员访问(前端从会话状态判断)。
	IsAdmin bool `json:"is_admin"`
}

// FeatureClickRequest 功能点击埋点请求体。
type FeatureClickRequest struct {
	// PageID 点击发生的页面 id。
	PageID string `json:"page_id" binding:"required"`
	// FeatureID 被点击的功能标识(前端约定)。
	FeatureID string `json:"feature_id" binding:"required"`
	// VisitorID 匿名访客 id。
	VisitorID string `json:"visitor_id" binding:"required"`
	// IsAdmin 是否管理员访问。
	IsAdmin bool `json:"is_admin"`
}

// TelemetryResponse 埋点上报成功响应。
type TelemetryResponse struct {
	// Recorded 是否已记录。
	Recorded bool `json:"recorded"`
}

// RecordPageView 处理 POST /api/aux/telemetry/page-view。
//
// 匿名可写(不经守卫)。校验通过后入库,返回 recorded=true。
// 校验失败(缺字段)→ 400;入库失败 → 500。
func (h *TelemetryHandler) RecordPageView(c *gin.Context) {
	var req PageViewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "page_id and visitor_id are required")
		return
	}

	if err := h.telemetryService.RecordPageView(c.Request.Context(), req.PageID, req.VisitorID, req.IsAdmin); err != nil {
		if errors.Is(err, service.ErrEmptyPageID) || errors.Is(err, service.ErrEmptyVisitorID) || errors.Is(err, service.ErrTooLongField) {
			response.BadRequest(c, err.Error())
			return
		}
		response.InternalError(c, "failed to record page view")
		return
	}

	response.Created(c, TelemetryResponse{Recorded: true})
}

// RecordFeatureClick 处理 POST /api/aux/telemetry/feature-click。
//
// 匿名可写(不经守卫)。校验通过后入库,返回 recorded=true。
func (h *TelemetryHandler) RecordFeatureClick(c *gin.Context) {
	var req FeatureClickRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "page_id, feature_id and visitor_id are required")
		return
	}

	if err := h.telemetryService.RecordFeatureClick(c.Request.Context(), req.PageID, req.FeatureID, req.VisitorID, req.IsAdmin); err != nil {
		if errors.Is(err, service.ErrEmptyPageID) || errors.Is(err, service.ErrEmptyFeatureID) || errors.Is(err, service.ErrEmptyVisitorID) || errors.Is(err, service.ErrTooLongField) {
			response.BadRequest(c, err.Error())
			return
		}
		response.InternalError(c, "failed to record feature click")
		return
	}

	response.Created(c, TelemetryResponse{Recorded: true})
}
