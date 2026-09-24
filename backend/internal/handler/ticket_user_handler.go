package handler

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"aux-system/internal/integration"
	"aux-system/internal/pkg/response"
	"aux-system/internal/server/middleware"
	"aux-system/internal/service"

	"github.com/gin-gonic/gin"
)

type TicketUserHandler struct {
	service  *service.TicketService
	verifier *integration.Sub2APIClient
}

func NewTicketUserHandler(svc *service.TicketService, verifier *integration.Sub2APIClient) *TicketUserHandler {
	return &TicketUserHandler{service: svc, verifier: verifier}
}

func (h *TicketUserHandler) Guard() gin.HandlerFunc {
	if h == nil {
		return middleware.UserGuard(nil)
	}
	return middleware.UserGuard(h.verifier)
}

func (h *TicketUserHandler) List(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "ticket service is unavailable")
		return
	}
	user, ok := invoiceAuthenticatedUser(c)
	if !ok {
		return
	}
	page, pageSize, valid := parseTicketPagination(c)
	if !valid {
		return
	}
	result, err := h.service.ListForUser(c.Request.Context(), user.ID, page, pageSize)
	if err != nil {
		h.fail(c, "list", err, user.ID)
		return
	}
	response.Success(c, result)
}

func (h *TicketUserHandler) Get(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "ticket service is unavailable")
		return
	}
	user, ok := invoiceAuthenticatedUser(c)
	if !ok {
		return
	}
	id, ok := ticketID(c)
	if !ok {
		return
	}
	result, err := h.service.GetForUser(c.Request.Context(), user.ID, id)
	if err != nil {
		h.fail(c, "get", err, user.ID)
		return
	}
	response.Success(c, result)
}

func (h *TicketUserHandler) Create(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "ticket service is unavailable")
		return
	}
	user, ok := invoiceAuthenticatedUser(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32*1024)
	var input service.TicketInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "invalid ticket")
		return
	}
	result, err := h.service.Create(c.Request.Context(), user.ID, user.Email, user.Username, input)
	if err != nil {
		h.fail(c, "create", err, user.ID)
		return
	}
	response.Created(c, result)
}

func (h *TicketUserHandler) Reply(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "ticket service is unavailable")
		return
	}
	user, ok := invoiceAuthenticatedUser(c)
	if !ok {
		return
	}
	id, ok := ticketID(c)
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
	result, err := h.service.ReplyAsUser(c.Request.Context(), user.ID, user.Username, id, input.Body)
	if err != nil {
		h.fail(c, "reply", err, user.ID)
		return
	}
	response.Success(c, result)
}

func (h *TicketUserHandler) fail(c *gin.Context, operation string, err error, userID int64) {
	switch {
	case errors.Is(err, service.ErrTicketNotFound):
		response.Error(c, http.StatusNotFound, "ticket not found")
	case errors.Is(err, service.ErrTicketClosed):
		response.Error(c, http.StatusConflict, "ticket is closed")
	case errors.Is(err, service.ErrInvalidTicket):
		response.BadRequest(c, "invalid ticket")
	default:
		log.Printf("[TicketUserHandler.%s] user_id=%d failed: %v", operation, userID, err)
		response.InternalError(c, "ticket request failed")
	}
}

func parseTicketPagination(c *gin.Context) (int, int, bool) {
	page, pageSize := 1, 20
	if value := strings.TrimSpace(c.Query("page")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 {
			response.BadRequest(c, "invalid page")
			return 0, 0, false
		}
		page = parsed
	}
	if value := strings.TrimSpace(c.Query("page_size")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 100 {
			response.BadRequest(c, "invalid page_size")
			return 0, 0, false
		}
		pageSize = parsed
	}
	return page, pageSize, true
}

func ticketID(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		response.BadRequest(c, "invalid ticket ID")
		return 0, false
	}
	return id, true
}
