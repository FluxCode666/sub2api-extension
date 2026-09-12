// Package admin 提供兼容 homepage.config 的系统配置端点。
package admin

import (
	"context"
	"log"

	"sub2api-extension/internal/pkg/response"
	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
)

type homepageConfigProvider interface {
	Get(ctx context.Context) (service.HomepageConfig, error)
	Save(ctx context.Context, config service.HomepageConfig) (service.HomepageConfig, error)
}

type homepageMenuPublisher interface {
	SetHomepageMenu(context.Context, bool, string) error
}

// HomepageConfigHandler 同时提供公开读取和管理员写入。
type HomepageConfigHandler struct {
	provider  homepageConfigProvider
	publisher homepageMenuPublisher
}

func NewHomepageConfigHandler(svc *service.HomepageConfigService, publishers ...homepageMenuPublisher) *HomepageConfigHandler {
	var publisher homepageMenuPublisher
	if len(publishers) > 0 {
		publisher = publishers[0]
	}
	return &HomepageConfigHandler{provider: svc, publisher: publisher}
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
		log.Printf("[HomepageConfigHandler] failed to read config fallback=%t: %v", fallbackToDefaults, err)
		// 公开首页在配置库暂时不可用时仍然可用默认文案；管理员读取则提示错误。
		if fallbackToDefaults {
			response.Success(c, service.DefaultHomepageConfig())
			return
		}
		response.InternalError(c, "failed to fetch homepage config")
		return
	}
	if fallbackToDefaults {
		config.Sub2APIPublished = false
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
		log.Printf("[HomepageConfigHandler.UpdateConfig] invalid request body: %v", err)
		response.BadRequest(c, "invalid homepage config")
		return
	}
	saved, err := h.provider.Save(c.Request.Context(), config)
	if err != nil {
		log.Printf("[HomepageConfigHandler.UpdateConfig] save failed: %v", err)
		response.InternalError(c, "failed to save homepage config")
		return
	}
	if h.publisher != nil {
		if err := h.publisher.SetHomepageMenu(c.Request.Context(), saved.Sub2APIPublished, saved.SiteName); err != nil {
			log.Printf("[HomepageConfigHandler.UpdateConfig] menu sync failed published=%t: %v", saved.Sub2APIPublished, err)
			response.SuccessWithReason(c, saved, "homepage config saved with warning", "系统配置已保存，但 Sub2API 菜单同步失败，请检查数据库连接和公开域名")
			return
		}
	}
	response.Success(c, saved)
}
