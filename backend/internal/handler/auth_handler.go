// Package handler 提供附属内容系统的 HTTP 处理器。
//
// AuthHandler 实现 POST /api/aux/admin/session:
// 收 sub2api token → 转发 sub2api /auth/me 验证 → 角色判定 → 签发附属会话。
//
// 此端点在 AdminGuard 之外(调用时尚无附属会话)。
package handler

import (
	"errors"

	"sub2api-extension/internal/integration"
	"sub2api-extension/internal/pkg/response"
	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
)

// AuthHandler 处理管理员会话换取。
type AuthHandler struct {
	authService *service.AuthService
}

// NewAuthHandler 创建 auth handler。
func NewAuthHandler(authService *service.AuthService) *AuthHandler {
	return &AuthHandler{authService: authService}
}

// CreateSessionRequest 创建附属管理员会话的请求体。
type CreateSessionRequest struct {
	// Token 是 sub2api 管理员持有的 JWT(由 iframe 传入)。
	Token string `json:"token" binding:"required"`
}

// CreateSessionResponse 创建会话成功的响应 data。
type CreateSessionResponse struct {
	// SessionToken 是附属系统签发的管理员会话 JWT,前端存储后用于访问受守卫端点。
	SessionToken string `json:"session_token"`
	// User 是经验证的管理员用户信息。
	User SessionUser `json:"user"`
}

// SessionUser 会话中的用户信息。
type SessionUser struct {
	ID       int64  `json:"id"`
	Email    string `json:"email"`
	Username string `json:"username"`
	Role     string `json:"role"`
}

// LoginRequest 账号密码登录请求体(独立登录入口,不经 iframe)。
type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

// CreateSession 处理 POST /api/aux/admin/session。
//
// 流程:
//  1. 收 sub2api JWT(请求体 token 字段)
//  2. 转发 sub2api /auth/me 验证(带 TTL 缓存)
//  3. 角色判定: 非 admin → 403; 无效/过期 token → 401; sub2api 不可达 → 503
//  4. 签发附属系统会话 JWT 并返回
func (h *AuthHandler) CreateSession(c *gin.Context) {
	var req CreateSessionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "token is required")
		return
	}

	user, err := h.authService.VerifyAdminToken(c.Request.Context(), req.Token)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrNotAdmin):
			response.Forbidden(c, "admin access required")
		case errors.Is(err, service.ErrInvalidSub2APIToken):
			response.Unauthorized(c, "invalid or expired sub2api token")
		case errors.Is(err, integration.ErrSub2APIUnreachable):
			response.ServiceUnavailable(c, "sub2api unreachable")
		default:
			response.ServiceUnavailable(c, "failed to verify admin token")
		}
		return
	}

	sessionToken, err := h.authService.IssueSession(user)
	if err != nil {
		response.InternalError(c, "failed to issue session")
		return
	}

	response.Success(c, CreateSessionResponse{
		SessionToken: sessionToken,
		User: SessionUser{
			ID:       user.ID,
			Email:    user.Email,
			Username: user.Username,
			Role:     user.Role,
		},
	})
}

// Login 处理 POST /api/aux/admin/login。
//
// 独立登录入口(不经 sub2api iframe): 用账号密码代理 sub2api 登录,
// 校验角色为 admin 后签发附属会话。与 CreateSession 互补 —— 后者用 iframe token,
// 本端点用账号密码。响应结构与 CreateSession 一致(复用 CreateSessionResponse)。
//
// 流程:
//  1. 收 {email, password}
//  2. authService.LoginAdmin 代理 sub2api 登录 + 角色校验
//  3. 错误映射: 凭据错误 → 401; 非 admin → 403(NOT_ADMIN); 2FA → 403(TWO_FACTOR_REQUIRED); sub2api 不可达 → 503
//  4. 签发附属会话 JWT 并返回
//
// 403 用 ErrorWithReason 带 reason,前端据此区分"非管理员"与"已开启两步验证"提示。
func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "email and password are required")
		return
	}

	user, err := h.authService.LoginAdmin(c.Request.Context(), req.Email, req.Password)
	if err != nil {
		switch {
		case errors.Is(err, integration.ErrInvalidCredentials):
			response.Unauthorized(c, "邮箱或密码错误")
		case errors.Is(err, service.ErrNotAdmin):
			response.ErrorWithReason(c, 403, "仅管理员可登录", "NOT_ADMIN")
		case errors.Is(err, service.ErrTwoFactorRequired):
			response.ErrorWithReason(c, 403, "该账号已开启两步验证,暂不支持", "TWO_FACTOR_REQUIRED")
		case errors.Is(err, integration.ErrSub2APIUnreachable):
			response.ServiceUnavailable(c, "无法连接 sub2api 服务")
		default:
			response.InternalError(c, "failed to login")
		}
		return
	}

	sessionToken, err := h.authService.IssueSession(user)
	if err != nil {
		response.InternalError(c, "failed to issue session")
		return
	}

	response.Success(c, CreateSessionResponse{
		SessionToken: sessionToken,
		User: SessionUser{
			ID:       user.ID,
			Email:    user.Email,
			Username: user.Username,
			Role:     user.Role,
		},
	})
}
