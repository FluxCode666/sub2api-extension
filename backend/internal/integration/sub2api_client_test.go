package integration

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockSub2API 启动一个 mock sub2api server,handler 控制 /api/v1/auth/me 的响应。
// 返回 server 与 baseURL。调用方负责 Close。
func mockSub2API(handler http.HandlerFunc) *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/auth/me", handler)
	return httptest.NewServer(mux)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func TestVerifyAdminJWT_AdminUser(t *testing.T) {
	srv := mockSub2API(func(w http.ResponseWriter, r *http.Request) {
		// 校验请求带了 Bearer token
		auth := r.Header.Get("Authorization")
		assert.Equal(t, "Bearer admin-jwt-token", auth)

		writeJSON(w, http.StatusOK, map[string]any{
			"code":    0,
			"message": "success",
			"data": map[string]any{
				"id":       1,
				"email":    "admin@example.com",
				"username": "admin",
				"role":     "admin",
			},
		})
	})
	defer srv.Close()

	client := NewSub2APIClient(srv.URL)
	isAdmin, user, err := client.VerifyAdminJWT(context.Background(), "admin-jwt-token")

	require.NoError(t, err)
	assert.True(t, isAdmin)
	require.NotNil(t, user)
	assert.Equal(t, int64(1), user.ID)
	assert.Equal(t, "admin@example.com", user.Email)
	assert.Equal(t, "admin", user.Username)
	assert.Equal(t, "admin", user.Role)
}

func TestVerifyAdminJWT_NormalUser(t *testing.T) {
	srv := mockSub2API(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"code":    0,
			"message": "success",
			"data": map[string]any{
				"id":       2,
				"email":    "user@example.com",
				"username": "user",
				"role":     "user",
			},
		})
	})
	defer srv.Close()

	client := NewSub2APIClient(srv.URL)
	isAdmin, user, err := client.VerifyAdminJWT(context.Background(), "user-jwt-token")

	require.NoError(t, err)
	assert.False(t, isAdmin)
	require.NotNil(t, user)
	assert.Equal(t, "user", user.Role)
}

func TestVerifyAdminJWT_InvalidToken(t *testing.T) {
	srv := mockSub2API(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"code":    401,
			"message": "unauthorized",
			"reason":  "invalid token",
		})
	})
	defer srv.Close()

	client := NewSub2APIClient(srv.URL)
	isAdmin, user, err := client.VerifyAdminJWT(context.Background(), "bad-token")

	assert.Error(t, err)
	assert.True(t, errors.Is(err, ErrInvalidToken), "应返回 ErrInvalidToken")
	assert.False(t, isAdmin)
	assert.Nil(t, user)
}

// TestVerifyAdminJWT_NonJSON401 验证非 JSON 401 响应体仍归为 ErrInvalidToken(#9)。
// 生产中反向代理/网关可能对 401 返回纯文本或 HTML 错误页, 此时不应落入"不可达"桶。
func TestVerifyAdminJWT_NonJSON401(t *testing.T) {
	srv := mockSub2API(func(w http.ResponseWriter, r *http.Request) {
		// 非 JSON 响应体(如网关纯文本错误页)
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("token expired"))
	})
	defer srv.Close()

	client := NewSub2APIClient(srv.URL)
	isAdmin, user, err := client.VerifyAdminJWT(context.Background(), "expired-token")

	assert.Error(t, err)
	assert.True(t, errors.Is(err, ErrInvalidToken), "非 JSON 401 仍应归为 ErrInvalidToken, 而非不可达")
	assert.False(t, isAdmin)
	assert.Nil(t, user)
}

func TestVerifyAdminJWT_Unreachable(t *testing.T) {
	// 起一个 server 然后立即关闭,模拟不可达
	srv := mockSub2API(func(w http.ResponseWriter, r *http.Request) {})
	srv.Close()

	client := NewSub2APIClient(srv.URL)
	isAdmin, user, err := client.VerifyAdminJWT(context.Background(), "some-token")

	assert.Error(t, err)
	assert.False(t, isAdmin)
	assert.Nil(t, user)
	// 不可达错误不应是 ErrInvalidToken
	assert.False(t, errors.Is(err, ErrInvalidToken))
}

func TestVerifyAdminJWT_ServerError(t *testing.T) {
	srv := mockSub2API(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"code":    500,
			"message": "internal error",
		})
	})
	defer srv.Close()

	client := NewSub2APIClient(srv.URL)
	isAdmin, user, err := client.VerifyAdminJWT(context.Background(), "some-token")

	assert.Error(t, err)
	assert.False(t, isAdmin)
	assert.Nil(t, user)
	assert.False(t, errors.Is(err, ErrInvalidToken), "500 不应归为 ErrInvalidToken")
}

func TestNewSub2APIClient_TrimsTrailingSlash(t *testing.T) {
	client := NewSub2APIClient("http://localhost:8090/")
	assert.Equal(t, "http://localhost:8090", client.BaseURL())
}

// mockSub2APILogin 启动 mock sub2api server, handler 控制 /api/v1/auth/login 响应。
func mockSub2APILogin(handler http.HandlerFunc) *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/auth/login", handler)
	return httptest.NewServer(mux)
}

// ============ Login 测试 ============

func TestLogin_AdminSuccess(t *testing.T) {
	srv := mockSub2APILogin(func(w http.ResponseWriter, r *http.Request) {
		// 校验请求方法与 Content-Type
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))

		// 校验请求体
		var body map[string]string
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		assert.Equal(t, "admin@example.com", body["email"])
		assert.Equal(t, "secret-pass", body["password"])

		writeJSON(w, http.StatusOK, map[string]any{
			"code":    0,
			"message": "success",
			"data": map[string]any{
				"access_token":  "jwt-token-xyz",
				"refresh_token": "rt-abc",
				"expires_in":    86400,
				"token_type":    "Bearer",
				"user": map[string]any{
					"id":       1,
					"email":    "admin@example.com",
					"username": "admin",
					"role":     "admin",
				},
			},
		})
	})
	defer srv.Close()

	client := NewSub2APIClient(srv.URL)
	resp, err := client.Login(context.Background(), Sub2APILoginRequest{
		Email: "admin@example.com", Password: "secret-pass",
	})

	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, "jwt-token-xyz", resp.AccessToken)
	assert.Equal(t, "admin", resp.User.Role)
	assert.Equal(t, int64(1), resp.User.ID)
	assert.False(t, resp.Requires2FA)
}

func TestLogin_InvalidCredentials(t *testing.T) {
	srv := mockSub2APILogin(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"code":    401,
			"message": "invalid email or password",
			"reason":  "INVALID_CREDENTIALS",
		})
	})
	defer srv.Close()

	client := NewSub2APIClient(srv.URL)
	_, err := client.Login(context.Background(), Sub2APILoginRequest{
		Email: "x@example.com", Password: "wrong",
	})

	assert.ErrorIs(t, err, ErrInvalidCredentials)
}

func TestLogin_TwoFactorRequired(t *testing.T) {
	srv := mockSub2APILogin(func(w http.ResponseWriter, r *http.Request) {
		// 2FA 分支: 200 但 requires_2fa=true
		writeJSON(w, http.StatusOK, map[string]any{
			"code":    0,
			"message": "success",
			"data": map[string]any{
				"requires_2fa":      true,
				"temp_token":        "tt-2fa",
				"user_email_masked": "a***@example.com",
			},
		})
	})
	defer srv.Close()

	client := NewSub2APIClient(srv.URL)
	resp, err := client.Login(context.Background(), Sub2APILoginRequest{
		Email: "2fa@example.com", Password: "pass",
	})

	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.True(t, resp.Requires2FA)
	assert.Equal(t, "tt-2fa", resp.TempToken)
}

func TestLogin_ApplicationErrorInSuccessEnvelope(t *testing.T) {
	srv := mockSub2APILogin(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"code":    1001,
			"message": "captcha verification failed",
		})
	})
	defer srv.Close()

	client := NewSub2APIClient(srv.URL)
	_, err := client.Login(context.Background(), Sub2APILoginRequest{
		Email: "x@example.com", Password: "pass",
	})

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "error code 1001")
}

func TestLogin_ServerError(t *testing.T) {
	srv := mockSub2APILogin(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"code":    500,
			"message": "internal error",
		})
	})
	defer srv.Close()

	client := NewSub2APIClient(srv.URL)
	_, err := client.Login(context.Background(), Sub2APILoginRequest{
		Email: "x@example.com", Password: "pass",
	})

	assert.Error(t, err)
	assert.NotErrorIs(t, err, ErrInvalidCredentials)
	assert.Contains(t, err.Error(), "status 500")
}

func TestLogin_Unreachable(t *testing.T) {
	srv := mockSub2APILogin(func(w http.ResponseWriter, r *http.Request) {})
	srv.Close() // 立即关闭模拟不可达

	client := NewSub2APIClient(srv.URL)
	_, err := client.Login(context.Background(), Sub2APILoginRequest{
		Email: "x@example.com", Password: "pass",
	})

	assert.Error(t, err)
	assert.ErrorIs(t, err, ErrSub2APIUnreachable)
}

func TestLogin_MissingDataField(t *testing.T) {
	srv := mockSub2APILogin(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"code":    0,
			"message": "success",
			// 缺 data
		})
	})
	defer srv.Close()

	client := NewSub2APIClient(srv.URL)
	_, err := client.Login(context.Background(), Sub2APILoginRequest{
		Email: "x@example.com", Password: "pass",
	})

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "missing data")
}
