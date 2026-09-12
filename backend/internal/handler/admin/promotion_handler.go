package admin

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"sub2api-extension/internal/pkg/response"
	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
)

type promotionMenuPublisher interface {
	SetPromotionMenu(ctx context.Context, enabled bool) error
}

type PromotionAdminHandler struct {
	service   *service.PromotionService
	publisher promotionMenuPublisher
}

func NewPromotionAdminHandler(svc *service.PromotionService, publisher promotionMenuPublisher) *PromotionAdminHandler {
	return &PromotionAdminHandler{service: svc, publisher: publisher}
}

func (h *PromotionAdminHandler) GetFeature(c *gin.Context) {
	enabled, err := h.service.FeatureEnabled(c.Request.Context())
	if err != nil {
		response.InternalError(c, "failed to read promotion publication setting")
		return
	}
	response.Success(c, gin.H{"enabled": enabled, "publish_available": h.publisher != nil})
}

func (h *PromotionAdminHandler) SetFeature(c *gin.Context) {
	var input struct {
		Enabled *bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.Enabled == nil {
		response.BadRequest(c, "enabled is required")
		return
	}
	if err := h.service.SetFeatureEnabled(c.Request.Context(), *input.Enabled); err != nil {
		response.InternalError(c, "failed to save promotion publication setting")
		return
	}
	if h.publisher != nil {
		if err := h.publisher.SetPromotionMenu(c.Request.Context(), *input.Enabled); err != nil {
			response.SuccessWithReason(c, gin.H{"enabled": *input.Enabled, "published": false}, "promotion setting saved with warning", "设置已保存，但 Sub2API 菜单同步失败，请检查数据库连接和公开域名")
			return
		}
	}
	response.Success(c, gin.H{"enabled": *input.Enabled, "published": h.publisher != nil && *input.Enabled})
}

func (h *PromotionAdminHandler) List(c *gin.Context) {
	items, err := h.service.List(c.Request.Context(), false)
	if err != nil {
		log.Printf("[PromotionAdminHandler.List] failed: %v", err)
		response.InternalError(c, "failed to list promotions")
		return
	}
	for i := range items {
		stats, statsErr := h.service.Stats(c.Request.Context(), items[i].ID)
		if statsErr != nil {
			log.Printf("[PromotionAdminHandler.List] stats failed id=%d: %v", items[i].ID, statsErr)
			continue
		}
		items[i].Stats = stats
	}
	response.Success(c, gin.H{"items": items})
}

func (h *PromotionAdminHandler) Get(c *gin.Context) {
	id, ok := promotionID(c)
	if !ok {
		return
	}
	item, err := h.service.Get(c.Request.Context(), id)
	if errors.Is(err, service.ErrPromotionNotFound) {
		response.Error(c, http.StatusNotFound, "promotion not found")
		return
	}
	if err != nil {
		response.InternalError(c, "failed to read promotion")
		return
	}
	response.Success(c, item)
}

func (h *PromotionAdminHandler) Stats(c *gin.Context) {
	id, ok := promotionID(c)
	if !ok {
		return
	}
	stats, err := h.service.Stats(c.Request.Context(), id)
	if err != nil {
		log.Printf("[PromotionAdminHandler.Stats] failed id=%d: %v", id, err)
		response.InternalError(c, "failed to read promotion statistics")
		return
	}
	response.Success(c, stats)
}

func (h *PromotionAdminHandler) Create(c *gin.Context) {
	var input service.PromotionInput
	if !bindPromotion(c, &input) {
		return
	}
	item, err := h.service.Create(c.Request.Context(), input)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.Created(c, item)
}

func (h *PromotionAdminHandler) Update(c *gin.Context) {
	id, ok := promotionID(c)
	if !ok {
		return
	}
	var input service.PromotionInput
	if !bindPromotion(c, &input) {
		return
	}
	item, err := h.service.Update(c.Request.Context(), id, input)
	if errors.Is(err, service.ErrPromotionNotFound) {
		response.Error(c, http.StatusNotFound, "promotion not found")
		return
	}
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.Success(c, item)
}

func (h *PromotionAdminHandler) Delete(c *gin.Context) {
	id, ok := promotionID(c)
	if !ok {
		return
	}
	err := h.service.Delete(c.Request.Context(), id)
	if errors.Is(err, service.ErrPromotionNotFound) {
		response.Error(c, http.StatusNotFound, "promotion not found")
		return
	}
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.Success(c, gin.H{"deleted": true})
}

func (h *PromotionAdminHandler) Publish(c *gin.Context) {
	id, ok := promotionID(c)
	if !ok {
		return
	}
	var input struct {
		Published *bool `json:"published"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.Published == nil {
		response.BadRequest(c, "published is required")
		return
	}
	item, err := h.service.SetPublished(c.Request.Context(), id, *input.Published)
	if errors.Is(err, service.ErrPromotionNotFound) {
		response.Error(c, http.StatusNotFound, "promotion not found")
		return
	}
	if errors.Is(err, service.ErrPromotionInactive) {
		response.BadRequest(c, "disabled promotion cannot be published")
		return
	}
	if err != nil {
		response.InternalError(c, "failed to update promotion publication")
		return
	}
	response.Success(c, gin.H{"promotion": item})
}

func bindPromotion(c *gin.Context, input *service.PromotionInput) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64*1024)
	if err := c.ShouldBindJSON(input); err != nil {
		response.BadRequest(c, "invalid promotion request")
		return false
	}
	return true
}
func promotionID(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		response.BadRequest(c, "invalid promotion ID")
		return 0, false
	}
	return id, true
}

// Keep the parser close to the handler so the API accepts browser ISO-8601 values.
func parsePromotionTime(raw string) (*time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	value, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil, err
	}
	value = value.UTC()
	return &value, nil
}
