// Package web 提供附属内容系统的 Web 处理器（健康检查等）。
package web

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// HealthResponse 健康检查响应体。
type HealthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}

// HealthHandler 健康检查处理器。
type HealthHandler struct{}

// NewHealthHandler 创建健康检查处理器。
func NewHealthHandler() *HealthHandler {
	return &HealthHandler{}
}

// Health 处理 GET /health 请求。
func (h *HealthHandler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, HealthResponse{
		Status:  "ok",
		Service: "sub2api-extension",
	})
}
