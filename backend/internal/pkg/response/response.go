// Package response 提供附属内容系统的标准 HTTP 响应封装。
//
// 镜像 sub2api backend/internal/pkg/response/response.go 的 envelope 风格,
// 独立实现,不导入 sub2api 的包。
//
// 成功响应:  {"code": 0, "message": "success", "data": ...}
// 错误响应:  {"code": <http_status>, "message": "...", "reason": "..."}
package response

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Response 标准 API 响应格式。
type Response struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Reason  string `json:"reason,omitempty"`
	Data    any    `json:"data,omitempty"`
}

// Success 返回成功响应 (HTTP 200)。
func Success(c *gin.Context, data any) {
	c.JSON(http.StatusOK, Response{
		Code:    0,
		Message: "success",
		Data:    data,
	})
}

// SuccessWithReason 返回业务操作已完成、但附带非阻断告警的成功响应。
// code 保持为 0，调用方不应把这类响应当作失败；reason 仅用于提示和排查。
func SuccessWithReason(c *gin.Context, data any, message, reason string) {
	c.JSON(http.StatusOK, Response{
		Code:    0,
		Message: message,
		Reason:  reason,
		Data:    data,
	})
}

// Created 返回创建成功响应 (HTTP 201)。
func Created(c *gin.Context, data any) {
	c.JSON(http.StatusCreated, Response{
		Code:    0,
		Message: "success",
		Data:    data,
	})
}

// CreatedWithReason 返回创建已完成、但附带非阻断告警的响应。
func CreatedWithReason(c *gin.Context, data any, message, reason string) {
	c.JSON(http.StatusCreated, Response{
		Code:    0,
		Message: message,
		Reason:  reason,
		Data:    data,
	})
}

// Error 返回错误响应。
func Error(c *gin.Context, statusCode int, message string) {
	c.JSON(statusCode, Response{
		Code:    statusCode,
		Message: message,
	})
}

// ErrorWithReason 返回带 reason 的错误响应。
func ErrorWithReason(c *gin.Context, statusCode int, message, reason string) {
	c.JSON(statusCode, Response{
		Code:    statusCode,
		Message: message,
		Reason:  reason,
	})
}

// BadRequest 返回 400 错误。
func BadRequest(c *gin.Context, message string) {
	Error(c, http.StatusBadRequest, message)
}

// Unauthorized 返回 401 错误。
func Unauthorized(c *gin.Context, message string) {
	Error(c, http.StatusUnauthorized, message)
}

// Forbidden 返回 403 错误。
func Forbidden(c *gin.Context, message string) {
	Error(c, http.StatusForbidden, message)
}

// ServiceUnavailable 返回 503 错误。
func ServiceUnavailable(c *gin.Context, message string) {
	Error(c, http.StatusServiceUnavailable, message)
}

// InternalError 返回 500 错误。
func InternalError(c *gin.Context, message string) {
	Error(c, http.StatusInternalServerError, message)
}
