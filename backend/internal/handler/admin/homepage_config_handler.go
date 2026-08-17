// Package admin 提供官网首页的管理员配置端点。
package admin

import (
	"context"

	"aux-system/internal/pkg/response"
	"aux-system/internal/service"

	"github.com/gin-gonic/gin"
)

type homepageConfigProvider interface {
	Get(ctx context.Context) (service.HomepageConfig, error)
	Save(ctx context.Context, config service.HomepageConfig) (service.HomepageConfig, error)
}

// HomepageConfigHandler 同时提供公开读取和管理员写入。
type HomepageConfigHandler struct {
	provider homepageConfigProvider
}

func NewHomepageConfigHandler(svc *service.HomepageConfigService) *HomepageConfigHandler {
	return &HomepageConfigHandler{provider: svc}
}

func (h *HomepageConfigHandler) GetPublicConfig(c *gin.Context) {
	h.get(c, true)
}

func (h *HomepageConfigHandler) GetConfig(c *gin.Context) {
	h.get(c, false)
}

func (h *HomepageConfigHandler) get(c *gin.Context, fallbackToDefaults bool) {
	if h == nil || h.provider == nil {
		response.Success(c, service.DefaultHomepageConfig())
		return
	}
	config, err := h.provider.Get(c.Request.Context())
	if err != nil {
		// 公开首页在配置库暂时不可用时仍然可用默认文案；管理员读取则提示错误。
		if fallbackToDefaults {
			response.Success(c, service.DefaultHomepageConfig())
			return
		}
		response.InternalError(c, "failed to fetch homepage config")
		return
	}
	response.Success(c, config)
}

func (h *HomepageConfigHandler) UpdateConfig(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.InternalError(c, "homepage config store is unavailable")
		return
	}
	var config service.HomepageConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		response.BadRequest(c, "invalid homepage config")
		return
	}
	saved, err := h.provider.Save(c.Request.Context(), config)
	if err != nil {
		response.InternalError(c, "failed to save homepage config")
		return
	}
	response.Success(c, saved)
}
