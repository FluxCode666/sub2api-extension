package admin

import (
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

type NotificationAdminHandler struct{ service *service.NotificationService }

func NewNotificationAdminHandler(svc *service.NotificationService) *NotificationAdminHandler {
	return &NotificationAdminHandler{service: svc}
}

func (h *NotificationAdminHandler) ListChannels(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "notification service is unavailable")
		return
	}
	items, err := h.service.ListChannels(c.Request.Context())
	if err != nil {
		log.Printf("[NotificationAdminHandler.ListChannels] %v", err)
		response.InternalError(c, "failed to list notification channels")
		return
	}
	response.Success(c, gin.H{"items": items})
}

func (h *NotificationAdminHandler) CreateChannel(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "notification service is unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256*1024)
	var input service.NotificationChannelInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "invalid notification channel")
		return
	}
	item, err := h.service.CreateChannel(c.Request.Context(), input)
	if err != nil {
		log.Printf("[NotificationAdminHandler.CreateChannel] %v", err)
		response.BadRequest(c, err.Error())
		return
	}
	response.Created(c, item)
}

func (h *NotificationAdminHandler) UpdateChannel(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "notification service is unavailable")
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		response.BadRequest(c, "invalid notification channel ID")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256*1024)
	var input service.NotificationChannelInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "invalid notification channel")
		return
	}
	item, err := h.service.UpdateChannel(c.Request.Context(), id, input)
	if errors.Is(err, service.ErrNotificationChannelNotFound) {
		response.Error(c, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		log.Printf("[NotificationAdminHandler.UpdateChannel] %v", err)
		response.BadRequest(c, err.Error())
		return
	}
	response.Success(c, item)
}

func (h *NotificationAdminHandler) DeleteChannel(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "notification service is unavailable")
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		response.BadRequest(c, "invalid notification channel ID")
		return
	}
	if err = h.service.DeleteChannel(c.Request.Context(), id); errors.Is(err, service.ErrNotificationChannelNotFound) {
		response.Error(c, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		log.Printf("[NotificationAdminHandler.DeleteChannel] %v", err)
		response.InternalError(c, "failed to delete notification channel")
		return
	}
	response.Success(c, gin.H{"deleted": true})
}

func (h *NotificationAdminHandler) TestChannel(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "notification service is unavailable")
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		response.BadRequest(c, "invalid notification channel ID")
		return
	}
	if err = h.service.TestChannel(c.Request.Context(), id); errors.Is(err, service.ErrNotificationChannelNotFound) {
		response.Error(c, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		log.Printf("[NotificationAdminHandler.TestChannel] channel_id=%d: %v", id, err)
		response.Error(c, http.StatusBadGateway, "notification channel test failed; check the notification log for details")
		return
	}
	response.Success(c, gin.H{"sent": true})
}

func (h *NotificationAdminHandler) GetEventConfig(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "notification service is unavailable")
		return
	}
	event := strings.TrimSpace(c.Param("event"))
	cfg, err := h.service.GetEventConfig(c.Request.Context(), event)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.Success(c, cfg)
}

func (h *NotificationAdminHandler) SetEventConfig(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "notification service is unavailable")
		return
	}
	event := strings.TrimSpace(c.Param("event"))
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32*1024)
	var input struct {
		ChannelIDs        []int               `json:"channel_ids"`
		ChannelRecipients map[string][]string `json:"channel_recipients"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "channel_ids is required")
		return
	}
	recipients := make(map[int][]string, len(input.ChannelRecipients))
	for key, values := range input.ChannelRecipients {
		id, parseErr := strconv.Atoi(strings.TrimSpace(key))
		if parseErr != nil || id <= 0 {
			response.BadRequest(c, "channel_recipients contains an invalid channel ID")
			return
		}
		recipients[id] = values
	}
	cfg, err := h.service.SetEventChannelsWithRecipients(c.Request.Context(), event, input.ChannelIDs, recipients)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.Success(c, cfg)
}

func (h *NotificationAdminHandler) ListDeliveries(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "notification service is unavailable")
		return
	}
	page, err := service.ParseInvoicePage(c.Query("page"))
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	pageSize, err := service.ParseInvoicePageSize(c.Query("page_size"), 20)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	startAt, err := service.ParseNotificationDateTime(firstNotificationQuery(c, "start_at", "start_time", "from", "start"))
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	endAt, err := service.ParseNotificationDateTime(firstNotificationQuery(c, "end_at", "end_time", "to", "end"))
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	// datetime-local values have minute precision; make the selected end
	// minute inclusive while preserving RFC3339 second precision for API users.
	if rawEnd := firstNotificationQuery(c, "end_at", "end_time", "to", "end"); len(rawEnd) == len("2006-01-02T15:04") {
		endAt = endAt.Add(time.Minute)
	}
	if !startAt.IsZero() && !endAt.IsZero() && !startAt.Before(endAt) {
		response.BadRequest(c, "start_at must be before end_at")
		return
	}
	items, err := h.service.ListDeliveriesFiltered(c.Request.Context(), c.Query("event"), c.Query("status"), startAt, endAt, page, pageSize)
	if errors.Is(err, service.ErrInvalidNotificationDeliveryStatus) {
		response.BadRequest(c, err.Error())
		return
	}
	if err != nil {
		log.Printf("[NotificationAdminHandler.ListDeliveries] %v", err)
		response.InternalError(c, "failed to list notification deliveries")
		return
	}
	response.Success(c, items)
}

func firstNotificationQuery(c *gin.Context, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(c.Query(key)); value != "" {
			return value
		}
	}
	return ""
}
