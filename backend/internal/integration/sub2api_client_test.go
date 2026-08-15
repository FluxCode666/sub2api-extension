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

	client := NewSub2APIClient(srv.URL, "")
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

	client := NewSub2APIClient(srv.URL, "")
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

	client := NewSub2APIClient(srv.URL, "")
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

	client := NewSub2APIClient(srv.URL, "")
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

	client := NewSub2APIClient(srv.URL, "")
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

	client := NewSub2APIClient(srv.URL, "")
	isAdmin, user, err := client.VerifyAdminJWT(context.Background(), "some-token")

	assert.Error(t, err)
	assert.False(t, isAdmin)
	assert.Nil(t, user)
	assert.False(t, errors.Is(err, ErrInvalidToken), "500 不应归为 ErrInvalidToken")
}

func TestNewSub2APIClient_TrimsTrailingSlash(t *testing.T) {
	client := NewSub2APIClient("http://localhost:8090/", "key-123")
	assert.Equal(t, "http://localhost:8090", client.BaseURL())
	assert.Equal(t, "key-123", client.AdminKey())
}

// ============ GetDashboardStats 测试: 走真实 HTTP mock sub2api ============

// mockSub2APIDashboard 启动一个 mock sub2api server,handler 控制 /api/v1/admin/dashboard/stats 的响应。
func mockSub2APIDashboard(handler http.HandlerFunc) *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/admin/dashboard/stats", handler)
	return httptest.NewServer(mux)
}

func TestGetDashboardStats_Success(t *testing.T) {
	srv := mockSub2APIDashboard(func(w http.ResponseWriter, r *http.Request) {
		// 校验请求带了 x-api-key
		assert.Equal(t, "admin-key-123", r.Header.Get("x-api-key"))

		writeJSON(w, http.StatusOK, map[string]any{
			"code":    0,
			"message": "success",
			"data": map[string]any{
				"total_users":      100,
				"today_new_users":  5,
				"active_users":     20,
				"total_api_keys":   10,
				"active_api_keys":  8,
				"total_accounts":   30,
				"normal_accounts":  25,
				"error_accounts":   3,
				"total_requests":   50000,
				"total_tokens":     1000000,
				"total_cost":       12.34,
				"today_requests":   500,
				"today_tokens":     10000,
				"today_cost":       0.56,
				"uptime":           86400,
				"rpm":              42,
				"tpm":              8000,
				"stats_updated_at": "2026-08-14T10:00:00Z",
				"stats_stale":      false,
			},
		})
	})
	defer srv.Close()

	client := NewSub2APIClient(srv.URL, "admin-key-123")
	stats, err := client.GetDashboardStats(context.Background())

	require.NoError(t, err)
	require.NotNil(t, stats)
	assert.Equal(t, int64(100), stats.TotalUsers)
	assert.Equal(t, int64(5), stats.TodayNewUsers)
	assert.Equal(t, int64(20), stats.ActiveUsers)
	assert.Equal(t, int64(10), stats.TotalAPIKeys)
	assert.Equal(t, int64(8), stats.ActiveAPIKeys)
	assert.Equal(t, int64(30), stats.TotalAccounts)
	assert.Equal(t, int64(25), stats.NormalAccounts)
	assert.Equal(t, int64(3), stats.ErrorAccounts)
	assert.Equal(t, int64(50000), stats.TotalRequests)
	assert.Equal(t, int64(1000000), stats.TotalTokens)
	assert.Equal(t, 12.34, stats.TotalCost)
	assert.Equal(t, int64(500), stats.TodayRequests)
	assert.Equal(t, int64(10000), stats.TodayTokens)
	assert.Equal(t, 0.56, stats.TodayCost)
	assert.Equal(t, int64(86400), stats.Uptime)
	assert.Equal(t, int64(42), stats.Rpm)
	assert.Equal(t, int64(8000), stats.Tpm)
	assert.Equal(t, "2026-08-14T10:00:00Z", stats.StatsUpdatedAt)
	assert.False(t, stats.StatsStale)
}

func TestGetDashboardStats_NoAdminKey(t *testing.T) {
	srv := mockSub2APIDashboard(func(w http.ResponseWriter, r *http.Request) {})
	defer srv.Close()

	client := NewSub2APIClient(srv.URL, "")
	_, err := client.GetDashboardStats(context.Background())

	assert.Error(t, err)
	assert.True(t, errors.Is(err, ErrAdminAPIKeyMissing))
}

func TestGetDashboardStats_Unauthorized(t *testing.T) {
	srv := mockSub2APIDashboard(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"code":    401,
			"message": "unauthorized",
		})
	})
	defer srv.Close()

	client := NewSub2APIClient(srv.URL, "bad-key")
	_, err := client.GetDashboardStats(context.Background())

	assert.Error(t, err)
	assert.False(t, errors.Is(err, ErrAdminAPIKeyMissing))
	assert.Contains(t, err.Error(), "status 401")
}

func TestGetDashboardStats_ComplianceBlocked(t *testing.T) {
	// 模拟 sub2api AdminComplianceGuard 拦截(非 200, 非 401)
	srv := mockSub2APIDashboard(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusForbidden, map[string]any{
			"code":    403,
			"message": "compliance confirmation required",
		})
	})
	defer srv.Close()

	client := NewSub2APIClient(srv.URL, "valid-key")
	_, err := client.GetDashboardStats(context.Background())

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "status 403")
}

func TestGetDashboardStats_ServerError(t *testing.T) {
	srv := mockSub2APIDashboard(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"code":    500,
			"message": "internal error",
		})
	})
	defer srv.Close()

	client := NewSub2APIClient(srv.URL, "valid-key")
	_, err := client.GetDashboardStats(context.Background())

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "status 500")
}

func TestGetDashboardStats_Unreachable(t *testing.T) {
	srv := mockSub2APIDashboard(func(w http.ResponseWriter, r *http.Request) {})
	srv.Close() // 立即关闭模拟不可达

	client := NewSub2APIClient(srv.URL, "valid-key")
	_, err := client.GetDashboardStats(context.Background())

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unreachable")
}

func TestGetDashboardStats_MissingDataField(t *testing.T) {
	srv := mockSub2APIDashboard(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"code":    0,
			"message": "success",
			// 缺 data
		})
	})
	defer srv.Close()

	client := NewSub2APIClient(srv.URL, "valid-key")
	_, err := client.GetDashboardStats(context.Background())

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "missing data")
}
