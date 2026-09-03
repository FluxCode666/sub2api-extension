// Package middleware 提供附属内容系统的 HTTP 中间件。
//
// admin_guard 守卫 /api/aux/admin/* 端点(除 session 端点外):
// 校验附属系统会话 JWT(由本系统签发),无效/过期/缺失 → 401。
//
// 关键设计: 守卫校验的是"附属系统 JWT",不是 sub2api 的 JWT。
// sub2api JWT 仅在 POST /api/aux/admin/session 端点使用(换取附属会话),
// 该端点在守卫之外。
package middleware

import (
	"log"
	"strings"

	"sub2api-extension/internal/pkg/response"
	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
)

// 附属系统会话 JWT 在请求头中的携带方式:
//
//	X-Aux-Session: <aux-jwt>
//
// 使用独立头而非 Authorization: Bearer, 与前端 api-client 约定一致,
// 并避免与 sub2api 的 Authorization JWT 混淆 (前端同时持有 sub2api token,
// 经 X-Aux-Token 头传递; 附属会话经 X-Aux-Session 头传递, 两者互不干扰)。
const sessionHeaderKey = "X-Aux-Session"

// Context keys used by the operation audit middleware. Keep identity fields
// separate from the full claims object so audit code never needs token data.
const (
	ContextKeyAuxUserID   = "aux_admin_user_id"
	ContextKeyAuxUsername = "aux_admin_username"
)

// ContextKeyAuxUser 是守卫注入 context 的附属管理员用户信息键。
type ContextKey string

const ContextKeyAuxUser ContextKey = "aux_admin_user"

// AdminGuard 校验附属系统会话 JWT。
// 无效/过期/缺失会话 → 401; 有效则将用户信息注入 context 并放行。
func AdminGuard(authService *service.AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		if authService == nil {
			log.Printf("[AdminGuard] rejected request path=%s: auth service unavailable", c.Request.URL.Path)
			response.ServiceUnavailable(c, "admin authentication is unavailable")
			c.Abort()
			return
		}
		token := strings.TrimSpace(c.GetHeader(sessionHeaderKey))
		if token == "" {
			log.Printf("[AdminGuard] rejected request path=%s: missing session", c.Request.URL.Path)
			response.Unauthorized(c, "admin session required")
			c.Abort()
			return
		}

		claims, err := authService.ValidateSession(token)
		if err != nil {
			log.Printf("[AdminGuard] rejected request path=%s: invalid session: %v", c.Request.URL.Path, err)
			response.Unauthorized(c, "invalid or expired admin session")
			c.Abort()
			return
		}

		c.Set(string(ContextKeyAuxUser), claims)
		c.Set(ContextKeyAuxUserID, claims.UserID)
		c.Set(ContextKeyAuxUsername, claims.Username)
		c.Next()
	}
}
