package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"sub2api-extension/internal/integration"
	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupGuardRouter(authService *service.AuthService) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	guarded := r.Group("/api/aux/admin")
	guarded.Use(AdminGuard(authService))
	{
		guarded.GET("/ping", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"ok": true})
		})
	}
	return r
}

func newTestAuthService(t *testing.T) *service.AuthService {
	t.Helper()
	return service.NewAuthServiceForSigning("test-secret", 1)
}

func TestAdminGuard_NoSession_Rejected(t *testing.T) {
	svc := newTestAuthService(t)
	r := setupGuardRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/api/aux/admin/ping", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAdminGuard_InvalidSession_Rejected(t *testing.T) {
	svc := newTestAuthService(t)
	r := setupGuardRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/api/aux/admin/ping", nil)
	req.Header.Set("X-Aux-Session", "not-a-valid-jwt")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAdminGuard_ValidSession_Passes(t *testing.T) {
	svc := newTestAuthService(t)
	r := setupGuardRouter(svc)

	// 签发有效附属会话
	user := &integration.Sub2APIUserInfo{ID: 1, Email: "admin@example.com", Username: "admin", Role: "admin"}
	token, err := svc.IssueSession(user)
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodGet, "/api/aux/admin/ping", nil)
	req.Header.Set("X-Aux-Session", token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestAdminGuard_ExpiredSession_Rejected(t *testing.T) {
	svc := newTestAuthService(t)
	r := setupGuardRouter(svc)

	// 签发已过期会话(同一 secret)
	user := &integration.Sub2APIUserInfo{ID: 1, Role: "admin"}
	token, err := svc.IssueExpiredSession(user)
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodGet, "/api/aux/admin/ping", nil)
	req.Header.Set("X-Aux-Session", token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAdminGuard_EmptySessionHeader_Rejected(t *testing.T) {
	svc := newTestAuthService(t)
	r := setupGuardRouter(svc)

	// X-Aux-Session 头存在但为空
	req := httptest.NewRequest(http.MethodGet, "/api/aux/admin/ping", nil)
	req.Header.Set("X-Aux-Session", "")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
