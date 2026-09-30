package handler

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"

	"aux-system/internal/integration"
	"aux-system/internal/pkg/response"
	"aux-system/internal/service"

	"github.com/gin-gonic/gin"
)

// clientModelLister 是接入文档模型列表 handler 依赖的最小服务接口。
type clientModelLister interface {
	List(ctx context.Context, token string) (service.ClientModelList, error)
}

// ClientModelHandler 为公开的客户端接入文档提供 Sub2API 模型列表。
type ClientModelHandler struct {
	models clientModelLister
}

// NewClientModelHandler 创建接入文档模型列表 handler。
func NewClientModelHandler(models clientModelLister) *ClientModelHandler {
	return &ClientModelHandler{models: models}
}

// List 返回 Sub2API 模型广场中的模型 ID。
//
// 端点公开可读：X-Aux-Token 仅用于让 Sub2API 返回该用户可见的分组，不作为授权依据；
// 上游不可用时返回 503，前端保留手动输入模型 ID。
func (h *ClientModelHandler) List(c *gin.Context) {
	if h == nil || h.models == nil {
		response.ServiceUnavailable(c, "client model list is unavailable")
		return
	}

	models, err := h.models.List(c.Request.Context(), strings.TrimSpace(c.GetHeader("X-Aux-Token")))
	if err != nil {
		switch {
		case errors.Is(err, integration.ErrModelPlazaDisabled):
			response.ErrorWithReason(c, http.StatusServiceUnavailable, "sub2api model plaza is disabled", "MODEL_PLAZA_DISABLED")
		case errors.Is(err, integration.ErrModelPlazaAuthRequired):
			response.ErrorWithReason(c, http.StatusServiceUnavailable, "sub2api model plaza requires login", "MODEL_PLAZA_AUTH_REQUIRED")
		case errors.Is(err, integration.ErrSub2APIUnreachable):
			log.Printf("[ClientModelHandler.List] sub2api model plaza unavailable: %v", err)
			response.ServiceUnavailable(c, "sub2api model list is temporarily unavailable")
		default:
			log.Printf("[ClientModelHandler.List] failed: %v", err)
			response.InternalError(c, "failed to list models")
		}
		return
	}
	response.Success(c, models)
}
