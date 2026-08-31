package admin

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"sub2api-extension/internal/pkg/response"
	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
)

type invoiceMenuPublisher interface {
	SetInvoiceMenu(context.Context, bool) error
}

type InvoiceAdminHandler struct {
	service   *service.InvoiceService
	publisher invoiceMenuPublisher
}

func NewInvoiceAdminHandler(svc *service.InvoiceService, publisher invoiceMenuPublisher) *InvoiceAdminHandler {
	return &InvoiceAdminHandler{service: svc, publisher: publisher}
}

func (h *InvoiceAdminHandler) GetFeature(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "invoice service is unavailable")
		return
	}
	enabled, err := h.service.FeatureEnabled(c.Request.Context())
	if err != nil {
		log.Printf("[InvoiceAdminHandler.GetFeature] read config failed: %v", err)
		response.InternalError(c, "failed to read invoice configuration")
		return
	}
	response.Success(c, gin.H{"enabled": enabled, "publish_available": h.publisher != nil})
}

func (h *InvoiceAdminHandler) SetFeature(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "invoice service is unavailable")
		return
	}
	var input struct {
		Enabled *bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.Enabled == nil {
		log.Printf("[InvoiceAdminHandler.SetFeature] invalid request body: %v", err)
		response.BadRequest(c, "enabled is required")
		return
	}
	if err := h.service.SetFeatureEnabled(c.Request.Context(), *input.Enabled); err != nil {
		log.Printf("[InvoiceAdminHandler.SetFeature] save config failed: %v", err)
		response.InternalError(c, "failed to save invoice configuration")
		return
	}
	published := false
	if h.publisher != nil {
		if err := h.publisher.SetInvoiceMenu(c.Request.Context(), *input.Enabled); err != nil {
			log.Printf("[InvoiceAdminHandler.SetFeature] menu sync failed enabled=%t: %v", *input.Enabled, err)
			response.SuccessWithReason(c, gin.H{"enabled": *input.Enabled, "published": false}, "invoice setting saved with warning", "设置已保存，但 Sub2API 菜单同步失败，请检查数据库连接和公开域名")
			return
		}
		published = *input.Enabled
	}
	response.Success(c, gin.H{"enabled": *input.Enabled, "published": published})
}

func (h *InvoiceAdminHandler) List(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "invoice service is unavailable")
		return
	}
	filters, err := parseInvoiceAdminFilters(c)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	items, err := h.service.ListForAdminPage(c.Request.Context(), filters)
	if errors.Is(err, service.ErrInvalidInvoiceStatus) {
		response.BadRequest(c, err.Error())
		return
	}
	if err != nil {
		log.Printf("[InvoiceAdminHandler.List] query failed: %v", err)
		response.InternalError(c, "failed to list invoice requests")
		return
	}
	response.Success(c, items)
}

// ListUsers powers the admin email search selector. The response only
// contains the user identity fields required to apply the user_id filter.
func (h *InvoiceAdminHandler) ListUsers(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "invoice service is unavailable")
		return
	}
	limit, err := service.ParseInvoicePageSize(c.Query("page_size"), 20)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	email := firstInvoiceQuery(c, "email", "search")
	items, err := h.service.SearchSub2APIUsers(c.Request.Context(), email, limit)
	if errors.Is(err, service.ErrSub2APIDatabaseUnavailable) {
		response.ServiceUnavailable(c, "sub2api user data is unavailable")
		return
	}
	if err != nil {
		log.Printf("[InvoiceAdminHandler.ListUsers] query failed: %v", err)
		response.InternalError(c, "failed to search sub2api users")
		return
	}
	response.Success(c, gin.H{"items": items})
}

// CreateManual records an offline corporate-transfer invoice for a selected
// Sub2API user. Identity is resolved again by the service from user_id.
func (h *InvoiceAdminHandler) CreateManual(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "invoice service is unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64*1024)
	var input service.ManualInvoiceRequestInput
	if err := c.ShouldBindJSON(&input); err != nil {
		log.Printf("[InvoiceAdminHandler.CreateManual] invalid request body: %v", err)
		response.BadRequest(c, "invalid manual invoice request")
		return
	}
	created, err := h.service.CreateManual(c.Request.Context(), input)
	if err != nil {
		log.Printf("[InvoiceAdminHandler.CreateManual] create failed user_id=%d: %v", input.UserID, err)
		handleInvoiceAdminError(c, err)
		return
	}
	response.Created(c, created)
}

func parseInvoiceAdminFilters(c *gin.Context) (service.InvoiceAdminFilters, error) {
	page, err := service.ParseInvoicePage(c.Query("page"))
	if err != nil {
		return service.InvoiceAdminFilters{}, err
	}
	pageSize, err := service.ParseInvoicePageSize(c.Query("page_size"), 20)
	if err != nil {
		return service.InvoiceAdminFilters{}, err
	}
	statusValue := strings.ToUpper(strings.TrimSpace(c.Query("status")))
	var status service.InvoiceStatus
	if statusValue != "" {
		switch service.InvoiceStatus(statusValue) {
		case service.InvoiceStatusPending, service.InvoiceStatusProcessing, service.InvoiceStatusIssued, service.InvoiceStatusRejected:
			status = service.InvoiceStatus(statusValue)
		default:
			return service.InvoiceAdminFilters{}, service.ErrInvalidInvoiceStatus
		}
	}
	var userID int64
	if raw := strings.TrimSpace(c.Query("user_id")); raw != "" {
		userID, err = strconv.ParseInt(raw, 10, 64)
		if err != nil || userID <= 0 {
			return service.InvoiceAdminFilters{}, errors.New("user_id must be a positive integer")
		}
	}
	startDate, err := service.ParseInvoiceDate(firstInvoiceQuery(c, "start_date", "from_date", "from"))
	if err != nil {
		return service.InvoiceAdminFilters{}, err
	}
	endDate, err := service.ParseInvoiceDate(firstInvoiceQuery(c, "end_date", "to_date", "to"))
	if err != nil {
		return service.InvoiceAdminFilters{}, err
	}
	if !startDate.IsZero() && !endDate.IsZero() && startDate.After(endDate) {
		return service.InvoiceAdminFilters{}, errors.New("start_date must not be after end_date")
	}
	if !endDate.IsZero() {
		endDate = endDate.AddDate(0, 0, 1)
	}
	keyword := firstInvoiceQuery(c, "keyword", "company", "invoice_title")
	taxpayerID := firstInvoiceQuery(c, "taxpayer_id", "taxpayerId")
	return service.InvoiceAdminFilters{
		Page: page, PageSize: pageSize, Keyword: keyword,
		TaxpayerID: taxpayerID, Status: status, UserID: userID,
		StartDate: startDate, EndDate: endDate,
	}, nil
}

func firstInvoiceQuery(c *gin.Context, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(c.Query(key)); value != "" {
			return value
		}
	}
	return ""
}

func (h *InvoiceAdminHandler) UpdateStatus(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "invoice service is unavailable")
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		response.BadRequest(c, "invalid invoice request ID")
		return
	}
	var input struct {
		Status    service.InvoiceStatus `json:"status"`
		AdminNote string                `json:"admin_note"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		log.Printf("[InvoiceAdminHandler.UpdateStatus] invalid request body id=%s: %v", c.Param("id"), err)
		response.BadRequest(c, "invalid invoice update")
		return
	}
	updated, err := h.service.UpdateAdminStatus(c.Request.Context(), id, input.Status, input.AdminNote)
	if err != nil {
		log.Printf("[InvoiceAdminHandler.UpdateStatus] update failed id=%d: %v", id, err)
		handleInvoiceAdminError(c, err)
		return
	}
	response.Success(c, updated)
}

func (h *InvoiceAdminHandler) UploadDocument(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "invoice service is unavailable")
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		response.BadRequest(c, "invalid invoice request ID")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.MaxInvoiceDocumentBytes+1024*1024)
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		log.Printf("[InvoiceAdminHandler.UploadDocument] invalid multipart upload id=%d: %v", id, err)
		response.BadRequest(c, "invoice document is required and must not exceed 20MB")
		return
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			log.Printf("[InvoiceAdminHandler.UploadDocument] failed to close upload: %v", closeErr)
		}
	}()
	updated, err := h.service.AttachDocument(c.Request.Context(), id, header.Filename, file)
	if err != nil {
		log.Printf("[InvoiceAdminHandler.UploadDocument] upload failed id=%d: %v", id, err)
		handleInvoiceAdminError(c, err)
		return
	}
	response.Success(c, updated)
}

func (h *InvoiceAdminHandler) Download(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "invoice service is unavailable")
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		response.Error(c, http.StatusNotFound, "invoice document not found")
		return
	}
	request, file, err := h.service.OpenDocument(c.Request.Context(), id, nil)
	if err != nil {
		log.Printf("[InvoiceAdminHandler.Download] open failed id=%d: %v", id, err)
		handleInvoiceAdminError(c, err)
		return
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			log.Printf("[InvoiceAdminHandler.Download] failed to close document: %v", closeErr)
		}
	}()
	c.Header("Content-Type", documentType(request.DocumentName))
	c.Header("Content-Disposition", "attachment; filename="+strconv.Quote(request.DocumentName))
	c.Header("X-Content-Type-Options", "nosniff")
	http.ServeContent(c.Writer, c.Request, request.DocumentName, request.UpdatedAt, file)
}

func handleInvoiceAdminError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrInvoiceNotFound):
		response.Error(c, http.StatusNotFound, "invoice request not found")
	case errors.Is(err, service.ErrInvoiceUserNotFound):
		response.Error(c, http.StatusNotFound, "sub2api user not found")
	case errors.Is(err, service.ErrSub2APIDatabaseUnavailable):
		response.ServiceUnavailable(c, "sub2api user data is unavailable")
	case strings.Contains(err.Error(), "invalid") || strings.Contains(err.Error(), "must") || strings.Contains(err.Error(), "cannot"):
		response.BadRequest(c, err.Error())
	default:
		response.InternalError(c, "invoice operation failed")
	}
}

func documentType(name string) string {
	name = strings.ToLower(name)
	if strings.HasSuffix(name, ".pdf") {
		return "application/pdf"
	}
	if strings.HasSuffix(name, ".png") {
		return "image/png"
	}
	return "image/jpeg"
}
