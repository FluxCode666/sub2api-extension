package admin

import (
	"context"
	"log"

	"aux-system/internal/pkg/response"
	"aux-system/internal/service"

	"github.com/gin-gonic/gin"
)

type tobHomepageConfigProvider interface {
	Get(context.Context) (service.TobHomepageConfig, error)
	Save(context.Context, service.TobHomepageConfig) (service.TobHomepageConfig, error)
}

type TobHomepageConfigHandler struct{ provider tobHomepageConfigProvider }

func NewTobHomepageConfigHandler(svc *service.TobHomepageConfigService) *TobHomepageConfigHandler {
	return &TobHomepageConfigHandler{provider: svc}
}

func (h *TobHomepageConfigHandler) GetPublicConfig(c *gin.Context) { h.get(c, true) }

func (h *TobHomepageConfigHandler) GetConfig(c *gin.Context) { h.get(c, false) }

func (h *TobHomepageConfigHandler) get(c *gin.Context, fallback bool) {
	if h == nil || h.provider == nil {
		response.Success(c, service.DefaultTobHomepageConfig())
		return
	}
	config, err := h.provider.Get(c.Request.Context())
	if err != nil {
		log.Printf("[TobHomepageConfigHandler] failed to read config fallback=%t: %v", fallback, err)
		if fallback {
			response.Success(c, service.DefaultTobHomepageConfig())
			return
		}
		response.InternalError(c, "failed to fetch tob homepage config")
		return
	}
	response.Success(c, config)
}

func (h *TobHomepageConfigHandler) UpdateConfig(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.InternalError(c, "tob homepage config store is unavailable")
		return
	}
	var config service.TobHomepageConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		response.BadRequest(c, "invalid tob homepage config")
		return
	}
	saved, err := h.provider.Save(c.Request.Context(), config)
	if err != nil {
		log.Printf("[TobHomepageConfigHandler] save failed: %v", err)
		response.InternalError(c, "failed to save tob homepage config")
		return
	}
	response.Success(c, saved)
}
