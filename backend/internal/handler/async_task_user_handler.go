package handler

import (
	"context"
	"errors"
	"log"
	"strconv"
	"strings"
	"time"

	"aux-system/internal/integration"
	"aux-system/internal/pkg/response"
	"aux-system/internal/server/middleware"
	"aux-system/internal/service"

	"github.com/gin-gonic/gin"
)

type asyncTaskLister interface {
	ListForUser(ctx context.Context, userID int64, query service.AsyncTaskQuery) (service.AsyncTaskList, error)
}

// AsyncTaskUserHandler 为 Sub2API 用户菜单中的异步任务页提供只读列表。
type AsyncTaskUserHandler struct {
	service  asyncTaskLister
	verifier userTokenVerifier
}

type userTokenVerifier interface {
	VerifyUserJWT(ctx context.Context, token string) (*integration.Sub2APIUserInfo, error)
}

func NewAsyncTaskUserHandler(svc asyncTaskLister, verifier userTokenVerifier) *AsyncTaskUserHandler {
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
