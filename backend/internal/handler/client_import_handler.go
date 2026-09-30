package handler

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"aux-system/internal/integration"
	"aux-system/internal/pkg/response"
	"aux-system/internal/server/middleware"
	"aux-system/internal/service"

	"github.com/gin-gonic/gin"
)

type clientImportKeyLister interface {
	ListUserAPIKeys(ctx context.Context, token string) ([]integration.Sub2APIKeyInfo, error)
}

type clientImportModelLister interface {
	ListAPIKeyModels(ctx context.Context, apiKey string) ([]string, error)
}

type clientImportPolicyReader interface {
	Get(ctx context.Context) (service.ClientImportPolicy, error)
}

// ClientImportHandler 为用户端客户端导入页提供受保护的 API Key 列表。
type ClientImportHandler struct {
	client *integration.Sub2APIClient
	keys   clientImportKeyLister
	models clientImportModelLister
	policy clientImportPolicyReader
}

// NewClientImportHandler 创建客户端导入 handler；policy 为 nil 时不限制已分组密钥可导入的客户端。
func NewClientImportHandler(client *integration.Sub2APIClient, policy *service.ClientImportPolicyService) *ClientImportHandler {
	handler := &ClientImportHandler{client: client}
	if client != nil {
		handler.keys = client
		handler.models = client
	}
	if policy != nil {
		handler.policy = policy
	}
	return handler
}

// Guard 验证 Sub2API 用户 token，导入页不接受 query 中的 user_id 作为身份依据。
func (h *ClientImportHandler) Guard() gin.HandlerFunc {
	if h == nil {
		return middleware.UserGuard(nil)
	}
	return middleware.UserGuard(h.client)
}

// ListKeys 返回当前用户的有效 API Key、分组信息、按管理端导入限制解析出的可导入客户端，
// 以及允许配置多个模型 ID 的客户端。
func (h *ClientImportHandler) ListKeys(c *gin.Context) {
	if h == nil || h.keys == nil {
		response.ServiceUnavailable(c, "client import service is unavailable")
		return
	}

	token := strings.TrimSpace(c.GetHeader("X-Aux-Token"))
	keys, err := h.keys.ListUserAPIKeys(c.Request.Context(), token)
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

	policy := service.DefaultClientImportPolicy()
	if h.policy != nil {
		// 限制读取失败时拒绝返回，避免在配置不可用时放开被禁止的客户端。
		policy, err = h.policy.Get(c.Request.Context())
		if err != nil {
			log.Printf("[ClientImportHandler.ListKeys] load policy failed: %v", err)
			response.InternalError(c, "failed to load client import policy")
			return
		}
	}

	items := make([]clientImportKeyResponse, 0, len(keys))
	for _, key := range keys {
		platform := ""
		if key.Group != nil {
			platform = key.Group.Platform
		}
		items = append(items, clientImportKeyResponse{
			ID:        key.ID,
			Key:       key.Key,
			Name:      key.Name,
			GroupID:   key.GroupID,
			Status:    key.Status,
			ExpiresAt: key.ExpiresAt,
			CreatedAt: key.CreatedAt,
			Group:     key.Group,
			// Sub2API 不保证返回 group_id 与 group 同时存在；与前端一致，二者其一存在即视为已分组。
			AllowedClients: policy.AllowedClients(clientImportGroupID(key), platform),
		})
	}
	// multi_model_clients 是全局设置，前端仅在客户端同时允许导入时展示多模型选择。
	response.Success(c, gin.H{"items": items, "multi_model_clients": policy.EffectiveMultiModelClients()})
}

// ListKeyModels 使用当前用户自己的某个 API Key 读取 Sub2API 网关模型列表，供导入页选择默认模型。
// 前端只提交密钥 ID；密钥明文由后端按用户 token 重新读取，不出现在 URL 或日志中。
func (h *ClientImportHandler) ListKeyModels(c *gin.Context) {
	if h == nil || h.keys == nil || h.models == nil {
		response.ServiceUnavailable(c, "client import service is unavailable")
		return
	}
	keyID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || keyID <= 0 {
		response.BadRequest(c, "invalid api key id")
		return
	}

	token := strings.TrimSpace(c.GetHeader("X-Aux-Token"))
	keys, err := h.keys.ListUserAPIKeys(c.Request.Context(), token)
	if err != nil {
		switch {
		case errors.Is(err, integration.ErrInvalidToken):
			response.Unauthorized(c, "valid sub2api login is required")
		case errors.Is(err, integration.ErrSub2APIUnreachable):
			response.ServiceUnavailable(c, "sub2api api keys are temporarily unavailable")
		default:
			log.Printf("[ClientImportHandler.ListKeyModels] list keys failed: %v", err)
			response.InternalError(c, "failed to list api keys")
		}
		return
	}

	var key *integration.Sub2APIKeyInfo
	for index := range keys {
		if keys[index].ID == keyID {
			key = &keys[index]
			break
		}
	}
	// 只允许读取当前用户自己的有效密钥，其他 ID 统一视为不存在。
	if key == nil || key.Status != "active" || strings.TrimSpace(key.Key) == "" {
		response.Error(c, http.StatusNotFound, "api key not found")
		return
	}
	if clientImportGroupID(*key) == nil {
		response.ErrorWithReason(c, http.StatusConflict, "api key has no group", "API_KEY_UNGROUPED")
		return
	}

	models, err := h.models.ListAPIKeyModels(c.Request.Context(), key.Key)
	if err != nil {
		switch {
		case errors.Is(err, integration.ErrAPIKeyModelsRejected):
			response.ErrorWithReason(c, http.StatusUnprocessableEntity, "sub2api gateway rejected this api key", "API_KEY_MODELS_REJECTED")
		case errors.Is(err, integration.ErrSub2APIUnreachable):
			response.ServiceUnavailable(c, "sub2api gateway models are temporarily unavailable")
		default:
			log.Printf("[ClientImportHandler.ListKeyModels] list models failed key_id=%d: %v", keyID, err)
			response.InternalError(c, "failed to list api key models")
		}
		return
	}
	if models == nil {
		models = []string{}
	}
	response.Success(c, gin.H{"items": models})
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
	// AllowedClients 是该密钥允许导入的客户端 ID；未分组密钥始终为空。
	AllowedClients []string `json:"allowed_clients"`
}

func clientImportGroupID(key integration.Sub2APIKeyInfo) *int64 {
	if key.GroupID != nil {
		return key.GroupID
	}
	if key.Group != nil {
		unknown := int64(0)
		return &unknown
	}
	return nil
}
