package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"aux-system/internal/integration"
	"aux-system/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupHandlerRouter(svc *service.AuthService) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewAuthHandler(svc)
	r.POST("/api/aux/admin/session", h.CreateSession)
	r.POST("/api/aux/admin/login", h.Login)
	return r
}

func doSessionRequest(r *gin.Engine, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/aux/admin/session", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func doLoginRequest(r *gin.Engine, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/aux/admin/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// testEnvelope 测试专用的响应 envelope,data 用 json.RawMessage 便于二次解析。
type testEnvelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Reason  string          `json:"reason,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func decodeEnvelope(t *testing.T, w *httptest.ResponseRecorder) testEnvelope {
	t.Helper()
	var resp testEnvelope
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	return resp
}

// ============ 集成测试: 走真实 HTTP mock sub2api ============

func TestCreateSession_AdminUser_Success(t *testing.T) {
	// mock sub2api 返回 admin
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/auth/me", func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer admin-jwt", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code":    0,
			"message": "success",
			"data": map[string]any{
				"id": 1, "email": "admin@example.com", "username": "admin", "role": "admin",
			},
		})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := integration.NewSub2APIClient(srv.URL)
	svc := service.NewAuthService(client, "test-secret", 1, 5*time.Minute)
	r := setupHandlerRouter(svc)

	w := doSessionRequest(r, `{"token":"admin-jwt"}`)

	require.Equal(t, http.StatusOK, w.Code)
	env := decodeEnvelope(t, w)
	assert.Equal(t, 0, env.Code)

	// 解析 data 中的 session_token
	var raw map[string]any
	require.NoError(t, json.Unmarshal(env.Data, &raw))
	assert.NotEmpty(t, raw["session_token"], "应返回附属会话 token")
	user := raw["user"].(map[string]any)
	assert.Equal(t, "admin", user["role"])
	assert.Equal(t, "admin@example.com", user["email"])
}

func TestCreateSession_NonAdmin_Forbidden(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/auth/me", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code":    0,
			"message": "success",
			"data":    map[string]any{"id": 2, "role": "user", "email": "u@e.com", "username": "u"},
		})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := integration.NewSub2APIClient(srv.URL)
	svc := service.NewAuthService(client, "test-secret", 1, 5*time.Minute)
	r := setupHandlerRouter(svc)

	w := doSessionRequest(r, `{"token":"user-jwt"}`)

	assert.Equal(t, http.StatusForbidden, w.Code)
	env := decodeEnvelope(t, w)
	assert.Equal(t, http.StatusForbidden, env.Code)
}

func TestCreateSession_InvalidToken_Unauthorized(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/auth/me", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code": 401, "message": "unauthorized",
		})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := integration.NewSub2APIClient(srv.URL)
	svc := service.NewAuthService(client, "test-secret", 1, 5*time.Minute)
	r := setupHandlerRouter(svc)

	w := doSessionRequest(r, `{"token":"bad-jwt"}`)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
	env := decodeEnvelope(t, w)
	assert.Equal(t, http.StatusUnauthorized, env.Code)
}

func TestCreateSession_Sub2APIUnreachable_ServiceUnavailable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	srv.Close() // 立即关闭模拟不可达

	client := integration.NewSub2APIClient(srv.URL)
	svc := service.NewAuthService(client, "test-secret", 1, 5*time.Minute)
	r := setupHandlerRouter(svc)

	w := doSessionRequest(r, `{"token":"some-jwt"}`)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	env := decodeEnvelope(t, w)
	assert.Equal(t, http.StatusServiceUnavailable, env.Code)
}

func TestCreateSession_MissingToken_BadRequest(t *testing.T) {
	client := integration.NewSub2APIClient("http://localhost:1")
	svc := service.NewAuthService(client, "test-secret", 1, 5*time.Minute)
	r := setupHandlerRouter(svc)

	w := doSessionRequest(r, `{}`)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestCreateSession_CacheHit_OnlyOneSub2APICall(t *testing.T) {
	var apiCalls int32
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/auth/me", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&apiCalls, 1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code":    0,
			"message": "success",
			"data":    map[string]any{"id": 1, "role": "admin", "email": "a@e.com", "username": "a"},
		})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := integration.NewSub2APIClient(srv.URL)
	svc := service.NewAuthService(client, "test-secret", 1, 5*time.Minute)
	r := setupHandlerRouter(svc)

	// 同一 token 连续换取会话两次
	for i := 0; i < 2; i++ {
		w := doSessionRequest(r, `{"token":"cached-admin-jwt"}`)
		require.Equal(t, http.StatusOK, w.Code, "第 %d 次请求应成功", i+1)
	}

	assert.Equal(t, int32(1), atomic.LoadInt32(&apiCalls), "缓存命中: sub2api 只应被调用一次")
}

// ============ Login 集成测试 ============

func TestLogin_AdminSuccess(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/auth/login", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		assert.Equal(t, "admin@example.com", body["email"])
		assert.Equal(t, "pass123", body["password"])

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code":    0,
			"message": "success",
			"data": map[string]any{
				"access_token": "sub2api-jwt",
				"user": map[string]any{
					"id": 1, "email": "admin@example.com", "username": "admin", "role": "admin",
				},
			},
		})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := integration.NewSub2APIClient(srv.URL)
	svc := service.NewAuthService(client, "test-secret", 1, 5*time.Minute)
	r := setupHandlerRouter(svc)

	w := doLoginRequest(r, `{"email":"admin@example.com","password":"pass123"}`)

	require.Equal(t, http.StatusOK, w.Code)
	env := decodeEnvelope(t, w)
	assert.Equal(t, 0, env.Code)

	var raw map[string]any
	require.NoError(t, json.Unmarshal(env.Data, &raw))
	assert.NotEmpty(t, raw["session_token"], "应签发附属会话 token")
	user := raw["user"].(map[string]any)
	assert.Equal(t, "admin", user["role"])
	assert.Equal(t, "admin@example.com", user["email"])
}

func TestLogin_NonAdmin_ForbiddenWithReason(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/auth/login", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code":    0,
			"message": "success",
			"data": map[string]any{
				"access_token": "sub2api-jwt",
				"user":         map[string]any{"id": 2, "role": "user", "email": "u@e.com"},
			},
		})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := integration.NewSub2APIClient(srv.URL)
	svc := service.NewAuthService(client, "test-secret", 1, 5*time.Minute)
	r := setupHandlerRouter(svc)

	w := doLoginRequest(r, `{"email":"u@e.com","password":"pass"}`)

	assert.Equal(t, http.StatusForbidden, w.Code)
	env := decodeEnvelope(t, w)
	assert.Equal(t, http.StatusForbidden, env.Code)
	assert.Equal(t, "NOT_ADMIN", env.Reason)
}

func TestLogin_TwoFactor_ForbiddenWithReason(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/auth/login", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code":    0,
			"message": "success",
			"data": map[string]any{
				"requires_2fa": true,
				"temp_token":   "tt-2fa",
			},
		})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := integration.NewSub2APIClient(srv.URL)
	svc := service.NewAuthService(client, "test-secret", 1, 5*time.Minute)
	r := setupHandlerRouter(svc)

	w := doLoginRequest(r, `{"email":"2fa@e.com","password":"pass"}`)

	assert.Equal(t, http.StatusForbidden, w.Code)
	env := decodeEnvelope(t, w)
	assert.Equal(t, "TWO_FACTOR_REQUIRED", env.Reason)
}

func TestLogin_InvalidCredentials_Unauthorized(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/auth/login", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code": 401, "message": "invalid email or password",
		})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := integration.NewSub2APIClient(srv.URL)
	svc := service.NewAuthService(client, "test-secret", 1, 5*time.Minute)
	r := setupHandlerRouter(svc)

	w := doLoginRequest(r, `{"email":"x@e.com","password":"wrong"}`)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
	env := decodeEnvelope(t, w)
	assert.Equal(t, http.StatusUnauthorized, env.Code)
}

func TestLogin_Sub2APIUnreachable_ServiceUnavailable(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/auth/login", func(w http.ResponseWriter, r *http.Request) {})
	srv := httptest.NewServer(mux)
	srv.Close() // 模拟不可达

	client := integration.NewSub2APIClient(srv.URL)
	svc := service.NewAuthService(client, "test-secret", 1, 5*time.Minute)
	r := setupHandlerRouter(svc)

	w := doLoginRequest(r, `{"email":"x@e.com","password":"pass"}`)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

func TestLogin_MissingEmail_BadRequest(t *testing.T) {
	svc := service.NewAuthServiceForSigning("test-secret", 1)
	r := setupHandlerRouter(svc)

	w := doLoginRequest(r, `{"password":"pass"}`)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestLogin_MissingPassword_BadRequest(t *testing.T) {
	svc := service.NewAuthServiceForSigning("test-secret", 1)
	r := setupHandlerRouter(svc)

	w := doLoginRequest(r, `{"email":"a@b.com"}`)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestLogin_InvalidEmailFormat_BadRequest(t *testing.T) {
	svc := service.NewAuthServiceForSigning("test-secret", 1)
	r := setupHandlerRouter(svc)

	w := doLoginRequest(r, `{"email":"not-an-email","password":"pass"}`)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}
