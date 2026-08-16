package admin

import (
	"time"

	"aux-system/internal/pkg/response"

	"github.com/gin-gonic/gin"
)

// ExampleStatusResponse 是 API 示例页展示的附属服务状态。
type ExampleStatusResponse struct {
	Service    string `json:"service"`
	Status     string `json:"status"`
	ServerTime string `json:"server_time"`
}

// ExampleHandler 提供无外部依赖的管理员 API 示例。
type ExampleHandler struct{}

// NewExampleHandler 创建示例 handler。
func NewExampleHandler() *ExampleHandler {
	return &ExampleHandler{}
}

// GetStatus 返回附属服务的当前状态和服务器 UTC 时间。
func (h *ExampleHandler) GetStatus(c *gin.Context) {
	response.Success(c, ExampleStatusResponse{
		Service:    "aux-system",
		Status:     "ok",
		ServerTime: time.Now().UTC().Format(time.RFC3339),
	})
}
