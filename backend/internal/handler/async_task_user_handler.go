package handler

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"aux-system/internal/integration"
	"aux-system/internal/pkg/response"
	"aux-system/internal/server/middleware"
	"aux-system/internal/service"

	"github.com/gin-gonic/gin"
)

type asyncTaskUserService interface {
	ListForUser(ctx context.Context, userID int64, query service.AsyncTaskQuery) (service.AsyncTaskList, error)
	RefreshForUser(ctx context.Context, userID int64, token string, ref service.AsyncTaskRef) (service.AsyncTaskRefreshResult, error)
}

// maxAsyncTaskRefreshBodyBytes 限制刷新请求体；请求只包含类型、来源和任务 ID。
const maxAsyncTaskRefreshBodyBytes = 4 << 10

// AsyncTaskUserHandler 为 Sub2API 用户菜单中的异步任务页提供列表与单条进度查询。
type AsyncTaskUserHandler struct {
	service  asyncTaskUserService
	verifier userTokenVerifier
}

type userTokenVerifier interface {
	VerifyUserJWT(ctx context.Context, token string) (*integration.Sub2APIUserInfo, error)
}

func NewAsyncTaskUserHandler(svc asyncTaskUserService, verifier userTokenVerifier) *AsyncTaskUserHandler {
	return &AsyncTaskUserHandler{service: svc, verifier: verifier}
}

// Guard 验证 X-Aux-Token；任务归属只取 Sub2API 返回的用户 ID，不信任 query 中的 user_id。
func (h *AsyncTaskUserHandler) Guard() gin.HandlerFunc {
	if h == nil || h.verifier == nil {
		return middleware.UserGuard(nil)
	}
	return middleware.UserGuard(h.verifier)
}

func (h *AsyncTaskUserHandler) List(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "async task service is unavailable")
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
	query, valid := parseAsyncTaskQuery(c)
	if !valid {
		response.BadRequest(c, "invalid async task filter")
		return
	}
	query.Page, query.PageSize = page, pageSize
	result, err := h.service.ListForUser(c.Request.Context(), user.ID, query)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidAsyncTaskFilter):
			response.BadRequest(c, "invalid async task filter")
		case errors.Is(err, service.ErrAsyncTaskUnavailable):
			response.ServiceUnavailable(c, "sub2api async task data is unavailable")
		default:
			log.Printf("[AsyncTaskUserHandler.List] failed user_id=%d: %v", user.ID, err)
			response.InternalError(c, "failed to list async tasks")
		}
		return
	}
	response.Success(c, result)
}

type asyncTaskRefreshRequest struct {
	Kind     string `json:"kind"`
	Provider string `json:"provider"`
	ID       string `json:"id"`
}

// Refresh 手动查询当前用户一条任务的最新进度。视频任务会用创建任务的 API Key
// 代用户向 Sub2API 网关查询一次，路由层需叠加 per-user 限流。
func (h *AsyncTaskUserHandler) Refresh(c *gin.Context) {
	if h == nil || h.service == nil {
		response.ServiceUnavailable(c, "async task service is unavailable")
		return
	}
	user, ok := invoiceAuthenticatedUser(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAsyncTaskRefreshBodyBytes)
	var body asyncTaskRefreshRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		response.BadRequest(c, "invalid async task reference")
		return
	}
	ref := service.AsyncTaskRef{Kind: body.Kind, Provider: body.Provider, ID: body.ID}
	token := strings.TrimSpace(c.GetHeader("X-Aux-Token"))
	result, err := h.service.RefreshForUser(c.Request.Context(), user.ID, token, ref)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidAsyncTaskRef):
			response.BadRequest(c, "invalid async task reference")
		case errors.Is(err, service.ErrAsyncTaskNotFound):
			response.ErrorWithReason(c, http.StatusNotFound, "async task not found", "ASYNC_TASK_NOT_FOUND")
		case errors.Is(err, integration.ErrVideoTaskNotFound):
			response.ErrorWithReason(c, http.StatusNotFound, "sub2api gateway could not find this video task", "VIDEO_TASK_NOT_FOUND")
		case errors.Is(err, service.ErrAsyncTaskAPIKeyUnavailable):
			response.ErrorWithReason(c, http.StatusConflict, "the api key that created this task is unavailable", "API_KEY_UNAVAILABLE")
		case errors.Is(err, integration.ErrInvalidToken):
			response.Unauthorized(c, "valid sub2api login is required")
		case errors.Is(err, integration.ErrVideoStatusRejected):
			response.ErrorWithReason(c, http.StatusUnprocessableEntity, "sub2api gateway rejected this video status request", "VIDEO_STATUS_REJECTED")
		case errors.Is(err, integration.ErrVideoStatusRateLimited):
			response.ErrorWithReason(c, http.StatusTooManyRequests, "sub2api gateway rate limited this video status request", "VIDEO_STATUS_RATE_LIMITED")
		case errors.Is(err, service.ErrAsyncTaskUnavailable), errors.Is(err, integration.ErrSub2APIUnreachable), errors.Is(err, context.DeadlineExceeded):
			response.ServiceUnavailable(c, "sub2api async task data is unavailable")
		default:
			log.Printf("[AsyncTaskUserHandler.Refresh] failed user_id=%d kind=%s id=%s: %v", user.ID, ref.Kind, ref.ID, err)
			response.InternalError(c, "failed to refresh async task")
		}
		return
	}
	response.Success(c, result)
}

// parseAsyncTaskQuery 解析过滤参数；日期必须是带时区的 RFC3339，created_to 为不包含边界。
func parseAsyncTaskQuery(c *gin.Context) (service.AsyncTaskQuery, bool) {
	query := service.AsyncTaskQuery{
		Kind: c.Query("kind"), Status: c.Query("status"), Model: c.Query("model"), Keyword: c.Query("keyword"),
	}
	if raw := strings.TrimSpace(c.Query("api_key_id")); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || id <= 0 {
			return query, false
		}
		query.APIKeyID = id
	}
	for _, field := range []struct {
		name   string
		target *time.Time
	}{{"created_from", &query.CreatedFrom}, {"created_to", &query.CreatedTo}} {
		raw := strings.TrimSpace(c.Query(field.name))
		if raw == "" {
			continue
		}
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return query, false
		}
		*field.target = parsed
	}
	return query, true
}
