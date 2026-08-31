// Package admin 提供管理员日志查询端点。
//
// 系统日志和操作日志只读，写入由后端请求/操作中间件和业务日志服务完成。
package admin

import (
	"context"
	"log"
	"strings"

	"sub2api-extension/internal/pkg/response"
	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
)

type logProvider interface {
	ListSystemLogs(context.Context, service.LogFilters) (*service.LogPage[service.SystemLog], error)
	ListOperationLogs(context.Context, service.LogFilters) (*service.LogPage[service.OperationLog], error)
}

// LogHandler 处理系统日志和操作日志查询。
type LogHandler struct{ provider logProvider }

func NewLogHandler(svc *service.LogService) *LogHandler { return &LogHandler{provider: svc} }

// newLogHandlerWithProvider keeps handler tests independent from a database.
func newLogHandlerWithProvider(provider logProvider) *LogHandler {
	return &LogHandler{provider: provider}
}

// ListSystem GET /api/aux/admin/logs/system。
func (h *LogHandler) ListSystem(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.ServiceUnavailable(c, "log service is unavailable")
		return
	}
	filters, err := parseLogFilters(c)
	if err != nil {
		log.Printf("[LogHandler.ListSystem] invalid filters: %v", err)
		response.BadRequest(c, err.Error())
		return
	}
	page, err := h.provider.ListSystemLogs(c.Request.Context(), filters)
	if err != nil {
		log.Printf("[LogHandler.ListSystem] query failed: %v", err)
		response.InternalError(c, "failed to list system logs")
		return
	}
	response.Success(c, page)
}

// ListOperation GET /api/aux/admin/logs/operations。
func (h *LogHandler) ListOperation(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.ServiceUnavailable(c, "log service is unavailable")
		return
	}
	filters, err := parseLogFilters(c)
	if err != nil {
		log.Printf("[LogHandler.ListOperation] invalid filters: %v", err)
		response.BadRequest(c, err.Error())
		return
	}
	page, err := h.provider.ListOperationLogs(c.Request.Context(), filters)
	if err != nil {
		log.Printf("[LogHandler.ListOperation] query failed: %v", err)
		response.InternalError(c, "failed to list operation logs")
		return
	}
	response.Success(c, page)
}

func parseLogFilters(c *gin.Context) (service.LogFilters, error) {
	level := strings.ToUpper(strings.TrimSpace(c.Query("level")))
	if level != "" && level != service.LogLevelDebug && level != service.LogLevelInfo && level != service.LogLevelWarn && level != service.LogLevelError {
		return service.LogFilters{}, &logFilterError{"level must be DEBUG, INFO, WARN, or ERROR"}
	}
	status := strings.ToLower(strings.TrimSpace(c.Query("status")))
	if status != "" && status != service.OperationSuccess && status != service.OperationFailure {
		return service.LogFilters{}, &logFilterError{"status must be success or failure"}
	}
	page, err := service.ParseLogPage(c.Query("page"))
	if err != nil {
		return service.LogFilters{}, err
	}
	pageSize, err := service.ParseLogPageSize(c.Query("page_size"))
	if err != nil {
		return service.LogFilters{}, err
	}
	from, err := service.ParseLogTime(c.Query("from"))
	if err != nil {
		return service.LogFilters{}, err
	}
	to, err := service.ParseLogTime(c.Query("to"))
	if err != nil {
		return service.LogFilters{}, err
	}
	if !from.IsZero() && !to.IsZero() && from.After(to) {
		return service.LogFilters{}, &logFilterError{"from must not be after to"}
	}
	return service.LogFilters{
		Level: level, Source: c.Query("source"), Status: status,
		Search: c.Query("search"), From: from, To: to, Page: page, PageSize: pageSize,
	}, nil
}

type logFilterError struct{ message string }

func (e *logFilterError) Error() string { return e.message }
