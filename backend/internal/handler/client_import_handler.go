package handler

import (
	"errors"
	"log"
	"strings"
	"time"

	"aux-system/internal/integration"
	"aux-system/internal/pkg/response"
	"aux-system/internal/server/middleware"

	"github.com/gin-gonic/gin"
)

// ClientImportHandler 为用户端客户端导入页提供受保护的 API Key 列表。
type ClientImportHandler struct {
	client *integration.Sub2APIClient
}

// NewClientImportHandler 创建客户端导入 handler。
func NewClientImportHandler(client *integration.Sub2APIClient) *ClientImportHandler {
	return &ClientImportHandler{client: client}
}

// Guard 验证 Sub2API 用户 token，导入页不接受 query 中的 user_id 作为身份依据。
func (h *ClientImportHandler) Guard() gin.HandlerFunc {
	if h == nil {
		return middleware.UserGuard(nil)
	}
	return middleware.UserGuard(h.client)
}

// ListKeys 返回当前用户的有效 API Key 及其分组信息。
func (h *ClientImportHandler) ListKeys(c *gin.Context) {
	if h == nil || h.client == nil {
		response.ServiceUnavailable(c, "client import service is unavailable")
		return
	}

	token := strings.TrimSpace(c.GetHeader("X-Aux-Token"))
	keys, err := h.client.ListUserAPIKeys(c.Request.Context(), token)
	if err != nil {
		switch {
		case errors.Is(err, integration.ErrInvalidToken):
			response.Unauthorized(c, "valid sub2api login is required")
		case errors.Is(err, integration.ErrSub2APIUnreachable):
			response.ServiceUnavailable(c, "sub2api api keys are temporarily unavailable")
		default:
			log.Printf("[ClientImportHandler.ListKeys] failed: %v", err)
			response.InternalError(c, "failed to list api keys")
		}
		return
	}

	items := make([]clientImportKeyResponse, 0, len(keys))
	for _, key := range keys {
		items = append(items, clientImportKeyResponse{
			ID:        key.ID,
			Key:       key.Key,
			Name:      key.Name,
			GroupID:   key.GroupID,
			Status:    key.Status,
			ExpiresAt: key.ExpiresAt,
			CreatedAt: key.CreatedAt,
			Group:     key.Group,
		})
	}
	response.Success(c, gin.H{"items": items})
}

type clientImportKeyResponse struct {
	ID        int64                        `json:"id"`
	Key       string                       `json:"key"`
	Name      string                       `json:"name"`
	GroupID   *int64                       `json:"group_id"`
	Status    string                       `json:"status"`
	ExpiresAt *time.Time                   `json:"expires_at"`
	CreatedAt time.Time                    `json:"created_at"`
	Group     *integration.Sub2APIKeyGroup `json:"group,omitempty"`
}
