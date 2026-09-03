// Package middleware 提供附属内容系统的请求与操作日志中间件。
package middleware

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
)

const (
	requestIDHeader = "X-Request-ID"
	requestIDPrefix = "AUX-"
)

// RequestLogger 将每个 HTTP 请求写入 stdout 和 system_logs。
// 它包裹 Recovery，既能记录正常响应，也能记录 panic 恢复后的 500。
func RequestLogger(logger *service.LogService) gin.HandlerFunc {
	return func(c *gin.Context) {
		if logger == nil {
			c.Next()
			return
		}
		started := time.Now()
		requestID := strings.TrimSpace(c.GetHeader(requestIDHeader))
		if requestID == "" {
			requestID = fmt.Sprintf("%s%d", requestIDPrefix, time.Now().UnixNano())
		}
		if len(requestID) > 128 {
			requestID = requestID[:128]
		}
		c.Set("aux_request_id", requestID)
		c.Header(requestIDHeader, requestID)

		c.Next()

		status := c.Writer.Status()
		level := service.LogLevelInfo
		if status >= http.StatusInternalServerError {
			level = service.LogLevelError
		} else if status >= http.StatusBadRequest {
			level = service.LogLevelWarn
		}
		record := service.SystemLogRecord{
			Level: level, Source: "http", RequestID: requestID,
			Message: fmt.Sprintf("%s %s -> %d", c.Request.Method, c.Request.URL.Path, status),
			Details: fmt.Sprintf("duration_ms=%d client_ip=%s", time.Since(started).Milliseconds(), c.ClientIP()),
		}
		if err := logger.RecordSystem(c.Request.Context(), record); err != nil {
			// RecordSystem already prints the persistence error. Keep this explicit
			// marker so a failed audit write can never look like a successful request.
			log.Printf("[ERROR] [RequestLogger] system log write failed request_id=%s: %v", requestID, err)
		}
	}
}

// OperationLogger 记录受 AdminGuard 保护的所有写操作。日志包含认证用户、
// 资源路径、HTTP 结果和客户端 IP，不记录请求体，避免把密码/令牌写入审计表。
func OperationLogger(logger *service.LogService) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		if logger == nil || !isMutationMethod(c.Request.Method) || isLogEndpoint(c.Request.URL.Path) {
			return
		}
		userID, _ := c.Get(ContextKeyAuxUserID)
		username, _ := c.Get(ContextKeyAuxUsername)
		requestID, _ := c.Get("aux_request_id")
		details := fmt.Sprintf("http_status=%d", c.Writer.Status())
		if id := stringValue(requestID); id != "" {
			details += " request_id=" + id
		}
		record := service.OperationLogRecord{
			UserID: numericUserID(userID), Username: stringValue(username),
			Action: operationAction(c.Request.Method), Resource: operationResource(c.Request.URL.Path),
			ResourceID: operationResourceID(c.Request.URL.Path), IPAddress: c.ClientIP(),
			Status:  service.OperationSuccess,
			Details: details,
		}
		if c.Writer.Status() >= http.StatusBadRequest {
			record.Status = service.OperationFailure
		}
		if err := logger.RecordOperation(c.Request.Context(), record); err != nil {
			log.Printf("[ERROR] [OperationLogger] audit write failed path=%s: %v", c.Request.URL.Path, err)
		}
	}
}

func isMutationMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func isLogEndpoint(path string) bool { return strings.Contains(path, "/admin/logs/") }

func operationAction(method string) string {
	switch method {
	case http.MethodPost:
		return "create"
	case http.MethodPut, http.MethodPatch:
		return "update"
	case http.MethodDelete:
		return "delete"
	default:
		return strings.ToLower(method)
	}
}

func operationResource(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, part := range parts {
		if part == "admin" && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return "admin"
}

func operationResourceID(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, part := range parts {
		if part != "admin" || i+2 >= len(parts) {
			continue
		}
		// Most admin resources use /<resource>/<id>. Page lookups also have
		// the explicit /pages/slug/<slug> form, where the third segment is
		// the actual resource identifier rather than the literal "slug".
		candidate := parts[i+2]
		if candidate == "slug" && i+3 < len(parts) {
			candidate = parts[i+3]
		}
		if candidate != "" && !strings.Contains(candidate, "?") {
			return candidate
		}
	}
	return ""
}

func numericUserID(value any) int64 {
	switch n := value.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	case string:
		parsed, err := strconv.ParseInt(n, 10, 64)
		if err != nil {
			log.Printf("[OperationLogger] invalid admin user id in context value=%q: %v", n, err)
			return 0
		}
		return parsed
	default:
		return 0
	}
}

func stringValue(value any) string {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return ""
}
