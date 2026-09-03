package handler

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"sub2api-extension/internal/integration"
	"sub2api-extension/internal/pkg/response"
	"sub2api-extension/internal/server/middleware"
	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
)

// InvoiceUserHandler serves the customer invoice portal. Every operation is
// protected by a freshly verified Sub2API identity; clients can never choose
// the customer ID in the request body or URL.
type InvoiceUserHandler struct {
	service  *service.InvoiceService
	verifier *integration.Sub2APIClient
}

func NewInvoiceUserHandler(svc *service.InvoiceService, verifier *integration.Sub2APIClient) *InvoiceUserHandler {
	return &InvoiceUserHandler{service: svc, verifier: verifier}
}

func (h *InvoiceUserHandler) Guard() gin.HandlerFunc {
	if h == nil {
		return middleware.UserGuard(nil)
	}
	return middleware.UserGuard(h.verifier)
}

// Config is deliberately public so the iframe can render an explicit disabled
// state before asking the user for an authenticated API call.
func (h *InvoiceUserHandler) Config(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "invoice service is unavailable")
		return
	}
	enabled, err := h.service.FeatureEnabled(c.Request.Context())
	if err != nil {
		log.Printf("[InvoiceUserHandler.Config] read config failed: %v", err)
		response.InternalError(c, "failed to read invoice configuration")
		return
	}
	response.Success(c, gin.H{"enabled": enabled})
}

func (h *InvoiceUserHandler) ListEligibleOrders(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "invoice service is unavailable")
		return
	}
	user, ok := invoiceAuthenticatedUser(c)
	if !ok {
		return
	}
	items, err := h.service.ListEligibleOrders(c.Request.Context(), user.ID)
	if err != nil {
		log.Printf("[InvoiceUserHandler.ListEligibleOrders] query failed user_id=%d: %v", user.ID, err)
		handleInvoiceUserError(c, err)
		return
	}
	response.Success(c, gin.H{"items": items})
}

// GetProfile returns only the authenticated customer's saved billing details.
func (h *InvoiceUserHandler) GetProfile(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "invoice service is unavailable")
		return
	}
	user, ok := invoiceAuthenticatedUser(c)
	if !ok {
		return
	}
	profile, err := h.service.GetProfile(c.Request.Context(), user.ID)
	if err != nil {
		log.Printf("[InvoiceUserHandler.GetProfile] query failed user_id=%d: %v", user.ID, err)
		handleInvoiceUserError(c, err)
		return
	}
	response.Success(c, gin.H{"profile": profile})
}

// SaveProfile upserts the authenticated customer's reusable billing details.
func (h *InvoiceUserHandler) SaveProfile(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "invoice service is unavailable")
		return
	}
	user, ok := invoiceAuthenticatedUser(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32*1024)
	var input service.InvoiceProfileInput
	if err := c.ShouldBindJSON(&input); err != nil {
		log.Printf("[InvoiceUserHandler.SaveProfile] invalid request user_id=%d: %v", user.ID, err)
		response.BadRequest(c, "invalid invoice profile")
		return
	}
	profile, err := h.service.SaveProfile(c.Request.Context(), user.ID, input)
	if err != nil {
		log.Printf("[InvoiceUserHandler.SaveProfile] save failed user_id=%d: %v", user.ID, err)
		handleInvoiceUserError(c, err)
		return
	}
	response.Success(c, gin.H{"profile": profile})
}

func (h *InvoiceUserHandler) ListRequests(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "invoice service is unavailable")
		return
	}
	user, ok := invoiceAuthenticatedUser(c)
	if !ok {
		return
	}
	page, err := service.ParseInvoicePage(c.Query("page"))
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	pageSize, err := service.ParseInvoicePageSize(c.Query("page_size"), 5)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	items, err := h.service.ListForUserPage(c.Request.Context(), user.ID, page, pageSize)
	if err != nil {
		log.Printf("[InvoiceUserHandler.ListRequests] query failed user_id=%d: %v", user.ID, err)
		handleInvoiceUserError(c, err)
		return
	}
	response.Success(c, items)
}

func (h *InvoiceUserHandler) Create(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "invoice service is unavailable")
		return
	}
	user, ok := invoiceAuthenticatedUser(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128*1024)
	var input service.InvoiceRequestInput
	if err := c.ShouldBindJSON(&input); err != nil {
		log.Printf("[InvoiceUserHandler.Create] invalid request user_id=%d: %v", user.ID, err)
		response.BadRequest(c, "invalid invoice application")
		return
	}
	created, err := h.service.Create(c.Request.Context(), user.ID, user.Email, user.Username, input)
	if err != nil {
		log.Printf("[InvoiceUserHandler.Create] create failed user_id=%d: %v", user.ID, err)
		handleInvoiceUserError(c, err)
		return
	}
	response.Created(c, created)
}

func (h *InvoiceUserHandler) Download(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "invoice service is unavailable")
		return
	}
	user, ok := invoiceAuthenticatedUser(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		response.Error(c, http.StatusNotFound, "invoice document not found")
		return
	}
	request, file, err := h.service.OpenDocument(c.Request.Context(), id, &user.ID)
	if err != nil {
		log.Printf("[InvoiceUserHandler.Download] open failed user_id=%d request_id=%d: %v", user.ID, id, err)
		handleInvoiceDocumentError(c, err)
		return
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			log.Printf("[InvoiceUserHandler.Download] failed to close document: %v", closeErr)
		}
	}()
	c.Header("Content-Type", requestDocumentType(request.DocumentName))
	c.Header("Content-Disposition", "attachment; filename="+strconv.Quote(request.DocumentName))
	c.Header("X-Content-Type-Options", "nosniff")
	http.ServeContent(c.Writer, c.Request, request.DocumentName, request.UpdatedAt, file)
}

func invoiceAuthenticatedUser(c *gin.Context) (*integration.Sub2APIUserInfo, bool) {
	value, ok := c.Get(string(middleware.ContextKeySub2APIUser))
	if !ok {
		response.Unauthorized(c, "valid sub2api login is required")
		return nil, false
	}
	user, ok := value.(*integration.Sub2APIUserInfo)
	if !ok || user == nil {
		response.Unauthorized(c, "valid sub2api login is required")
		return nil, false
	}
	return user, true
}

func handleInvoiceUserError(c *gin.Context, err error) {
	switch {
	case err == nil:
	case errors.Is(err, service.ErrInvoiceFeatureDisabled):
		response.Forbidden(c, "invoice feature is disabled")
	case errors.Is(err, service.ErrSub2APIDatabaseUnavailable):
		response.ServiceUnavailable(c, "sub2api order data is unavailable")
	case errors.Is(err, service.ErrInvoiceOrderUnavailable):
		response.BadRequest(c, "one or more selected orders are unavailable")
	case errors.Is(err, service.ErrInvoiceOrderAlreadyUsed):
		response.Error(c, http.StatusConflict, "one or more selected orders have already been invoiced")
	default:
		response.BadRequest(c, err.Error())
	}
}

func handleInvoiceDocumentError(c *gin.Context, err error) {
	if errors.Is(err, service.ErrInvoiceNotFound) {
		response.Error(c, http.StatusNotFound, "invoice document not found")
		return
	}
	response.InternalError(c, "failed to read invoice document")
}

func requestDocumentType(name string) string {
	name = strings.ToLower(name)
	if len(name) >= 4 && name[len(name)-4:] == ".pdf" {
		return "application/pdf"
	}
	if len(name) >= 4 && name[len(name)-4:] == ".png" {
		return "image/png"
	}
	return "image/jpeg"
}
