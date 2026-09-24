package admin

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"aux-system/internal/pkg/response"
	"aux-system/internal/service"

	"github.com/gin-gonic/gin"
)

type TicketHandler struct {
	service   *service.TicketService
	publisher ticketMenuPublisher
}

type ticketMenuPublisher interface {
	SetTicketMenu(context.Context, bool) error
}

type ticketMenuAvailability interface {
	TicketMenuPublishAvailable() bool
}

func NewTicketHandler(svc *service.TicketService, publishers ...ticketMenuPublisher) *TicketHandler {
	var publisher ticketMenuPublisher
	if len(publishers) > 0 {
		publisher = publishers[0]
	}
	return &TicketHandler{service: svc, publisher: publisher}
}

func (h *TicketHandler) GetFeature(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "ticket service is unavailable")
		return
	}
	enabled, err := h.service.FeatureEnabled(c.Request.Context())
	if err != nil {
		log.Printf("[TicketHandler.GetFeature] read config failed: %v", err)
		response.InternalError(c, "failed to read ticket publication setting")
		return
	}
	response.Success(c, gin.H{"enabled": enabled, "publish_available": h.publishAvailable()})
}

func (h *TicketHandler) SetFeature(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "ticket service is unavailable")
		return
	}
	var input struct {
		Enabled *bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.Enabled == nil {
		response.BadRequest(c, "enabled is required")
		return
	}
	if err := h.service.SetFeatureEnabled(c.Request.Context(), *input.Enabled); err != nil {
		log.Printf("[TicketHandler.SetFeature] save config failed: %v", err)
		response.InternalError(c, "failed to save ticket publication setting")
		return
	}
	if h.publisher != nil {
		if err := h.publisher.SetTicketMenu(c.Request.Context(), *input.Enabled); err != nil {
			log.Printf("[TicketHandler.SetFeature] menu sync failed enabled=%t: %v", *input.Enabled, err)
			response.SuccessWithReason(c, gin.H{"enabled": *input.Enabled, "published": false}, "ticket setting saved with warning", "设置已保存，但 Sub2API 菜单同步失败，请检查数据库连接和公开域名")
			return
		}
	}
	response.Success(c, gin.H{"enabled": *input.Enabled, "published": h.publishAvailable() && *input.Enabled})
}

func (h *TicketHandler) publishAvailable() bool {
	if h == nil || h.publisher == nil {
		return false
	}
	if availability, ok := h.publisher.(ticketMenuAvailability); ok {
		return availability.TicketMenuPublishAvailable()
	}
	return true
}

func (h *TicketHandler) List(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "ticket service is unavailable")
		return
	}
	page, pageSize := 1, 20
	var err error
	if value := strings.TrimSpace(c.Query("page")); value != "" {
		page, err = strconv.Atoi(value)
		if err != nil || page < 1 {
			response.BadRequest(c, "invalid page")
			return
		}
	}
	if value := strings.TrimSpace(c.Query("page_size")); value != "" {
		pageSize, err = strconv.Atoi(value)
		if err != nil || pageSize < 1 || pageSize > 100 {
			response.BadRequest(c, "invalid page_size")
			return
		}
	}
	status := service.TicketStatus(strings.ToUpper(strings.TrimSpace(c.Query("status"))))
	result, err := h.service.ListForAdmin(c.Request.Context(), service.TicketAdminFilters{
		Page: page, PageSize: pageSize, Keyword: c.Query("keyword"), Status: status,
	})
	if err != nil {
		h.fail(c, "list", err, 0)
		return
	}
	response.Success(c, result)
}

func (h *TicketHandler) Get(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "ticket service is unavailable")
		return
	}
	id, ok := adminTicketID(c)
	if !ok {
		return
	}
	result, err := h.service.GetForAdmin(c.Request.Context(), id)
	if err != nil {
		h.fail(c, "get", err, id)
		return
	}
	response.Success(c, result)
}

func (h *TicketHandler) Reply(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "ticket service is unavailable")
		return
	}
	id, ok := adminTicketID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16*1024)
	var input struct {
		Body string `json:"body"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "invalid ticket message")
		return
	}
	result, err := h.service.ReplyAsAdmin(c.Request.Context(), id, input.Body)
	if err != nil {
		h.fail(c, "reply", err, id)
		return
	}
	response.Success(c, result)
}

func (h *TicketHandler) UpdateStatus(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "ticket service is unavailable")
		return
	}
	id, ok := adminTicketID(c)
	if !ok {
		return
	}
	var input struct {
		Status service.TicketStatus `json:"status"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "invalid ticket status")
		return
	}
	result, err := h.service.UpdateStatus(c.Request.Context(), id, service.TicketStatus(strings.ToUpper(strings.TrimSpace(string(input.Status)))))
	if err != nil {
		h.fail(c, "update status", err, id)
		return
	}
	response.Success(c, result)
}

func (h *TicketHandler) fail(c *gin.Context, operation string, err error, ticketID int) {
	switch {
	case errors.Is(err, service.ErrTicketNotFound):
		response.Error(c, http.StatusNotFound, "ticket not found")
	case errors.Is(err, service.ErrTicketClosed):
		response.Error(c, http.StatusConflict, "ticket is closed")
	case errors.Is(err, service.ErrInvalidTicket):
		response.BadRequest(c, "invalid ticket")
	default:
		log.Printf("[TicketHandler.%s] ticket_id=%d failed: %v", operation, ticketID, err)
		response.InternalError(c, "ticket request failed")
	}
}

func adminTicketID(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		response.BadRequest(c, "invalid ticket ID")
		return 0, false
	}
	return id, true
}
