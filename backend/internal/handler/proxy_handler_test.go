package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"aux-system/internal/integration"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockDashboardReader 实现 dashboardStatsReader 接口,用于注入测试行为。
type mockDashboardReader struct {
	stats *integration.DashboardStats
	err   error
	calls int
}

func (m *mockDashboardReader) GetDashboardStats(_ context.Context) (*integration.DashboardStats, error) {
	m.calls++
	if m.err != nil {
		return nil, m.err
	}
	return m.stats, nil
}

func setupProxyRouter(handler *ProxyHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/aux/admin/sub2api/dashboard-stats", handler.GetDashboardStats)
	return r
}

func doProxyRequest(r *gin.Engine) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/api/aux/admin/sub2api/dashboard-stats", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// proxyEnvelope 测试专用响应 envelope。
type proxyEnvelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Reason  string          `json:"reason,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func decodeProxyEnvelope(t *testing.T, w *httptest.ResponseRecorder) proxyEnvelope {
	t.Helper()
	var resp proxyEnvelope
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	return resp
}

func TestProxyHandler_GetDashboardStats_Success(t *testing.T) {
	mock := &mockDashboardReader{
		stats: &integration.DashboardStats{
			TotalUsers:     100,
			TodayNewUsers:  5,
			ActiveUsers:    20,
			TotalAPIKeys:   10,
			ActiveAPIKeys:  8,
			TotalAccounts:  30,
			NormalAccounts: 25,
			ErrorAccounts:  3,
			TotalRequests:  50000,
			TotalTokens:    1000000,
			TotalCost:      12.34,
			TodayRequests:  500,
			TodayTokens:    10000,
			TodayCost:      0.56,
			Uptime:         86400,
			Rpm:            42,
			Tpm:            8000,
			StatsUpdatedAt: "2026-08-14T10:00:00Z",
			StatsStale:     false,
		},
	}
	handler := &ProxyHandler{client: mock}
	r := setupProxyRouter(handler)

	w := doProxyRequest(r)

	require.Equal(t, http.StatusOK, w.Code)
	env := decodeProxyEnvelope(t, w)
	assert.Equal(t, 0, env.Code)
	assert.Equal(t, "success", env.Message)

	var data map[string]any
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.EqualValues(t, 100, data["total_users"])
	assert.EqualValues(t, 5, data["today_new_users"])
	assert.EqualValues(t, 20, data["active_users"])
	assert.EqualValues(t, 10, data["total_api_keys"])
	assert.EqualValues(t, 8, data["active_api_keys"])
	assert.EqualValues(t, 30, data["total_accounts"])
	assert.EqualValues(t, 25, data["normal_accounts"])
	assert.EqualValues(t, 3, data["error_accounts"])
	assert.EqualValues(t, 50000, data["total_requests"])
	assert.EqualValues(t, 1000000, data["total_tokens"])
	assert.InDelta(t, 12.34, data["total_cost"], 0.001)
	assert.EqualValues(t, 500, data["today_requests"])
	assert.EqualValues(t, 10000, data["today_tokens"])
	assert.InDelta(t, 0.56, data["today_cost"], 0.001)
	assert.EqualValues(t, 86400, data["uptime"])
	assert.EqualValues(t, 42, data["rpm"])
	assert.EqualValues(t, 8000, data["tpm"])
	assert.Equal(t, "2026-08-14T10:00:00Z", data["stats_updated_at"])
	assert.False(t, data["stats_stale"].(bool))

	assert.Equal(t, 1, mock.calls, "client 应被调用一次")
}

func TestProxyHandler_GetDashboardStats_AdminKeyMissing_503(t *testing.T) {
	mock := &mockDashboardReader{
		err: integration.ErrAdminAPIKeyMissing,
	}
	handler := &ProxyHandler{client: mock}
	r := setupProxyRouter(handler)

	w := doProxyRequest(r)

	require.Equal(t, http.StatusServiceUnavailable, w.Code)
	env := decodeProxyEnvelope(t, w)
	assert.Equal(t, http.StatusServiceUnavailable, env.Code)
	assert.Contains(t, env.Message, "unreachable")
}

func TestProxyHandler_GetDashboardStats_Unauthorized_502(t *testing.T) {
	mock := &mockDashboardReader{
		err: errors.New("sub2api returned status 401: unauthorized"),
	}
	handler := &ProxyHandler{client: mock}
	r := setupProxyRouter(handler)

	w := doProxyRequest(r)

	require.Equal(t, http.StatusBadGateway, w.Code)
	env := decodeProxyEnvelope(t, w)
	assert.Equal(t, 502, env.Code)
	assert.Contains(t, env.Message, "sub2api request failed")
	// 信息泄露治理(#5): reason 不再透传 sub2api 内部错误详情(含状态码)
	assert.Empty(t, env.Reason)
}

func TestProxyHandler_GetDashboardStats_ComplianceBlocked_502(t *testing.T) {
	// 模拟 sub2api AdminComplianceGuard 拦截(403)
	mock := &mockDashboardReader{
		err: errors.New("sub2api returned status 403: compliance confirmation required"),
	}
	handler := &ProxyHandler{client: mock}
	r := setupProxyRouter(handler)

	w := doProxyRequest(r)

	require.Equal(t, http.StatusBadGateway, w.Code)
	env := decodeProxyEnvelope(t, w)
	assert.Equal(t, 502, env.Code)
	// 信息泄露治理(#5): reason 不再透传 sub2api 内部错误详情(含 403)
	assert.Empty(t, env.Reason)
}

func TestProxyHandler_GetDashboardStats_ServerError_502(t *testing.T) {
	mock := &mockDashboardReader{
		err: errors.New("sub2api returned status 500: internal error"),
	}
	handler := &ProxyHandler{client: mock}
	r := setupProxyRouter(handler)

	w := doProxyRequest(r)

	require.Equal(t, http.StatusBadGateway, w.Code)
	env := decodeProxyEnvelope(t, w)
	assert.Equal(t, 502, env.Code)
}

func TestProxyHandler_GetDashboardStats_Unreachable_503(t *testing.T) {
	mock := &mockDashboardReader{
		err: fmt.Errorf("%w: connection refused", integration.ErrSub2APIUnreachable),
	}
	handler := &ProxyHandler{client: mock}
	r := setupProxyRouter(handler)

	w := doProxyRequest(r)

	require.Equal(t, http.StatusServiceUnavailable, w.Code)
	env := decodeProxyEnvelope(t, w)
	assert.Equal(t, http.StatusServiceUnavailable, env.Code)
	assert.Contains(t, env.Message, "unreachable")
}

func TestProxyHandler_GetDashboardStats_MissingData_502(t *testing.T) {
	mock := &mockDashboardReader{
		err: errors.New("sub2api response missing data field"),
	}
	handler := &ProxyHandler{client: mock}
	r := setupProxyRouter(handler)

	w := doProxyRequest(r)

	// 缺 data 不是不可达,归为 502
	require.Equal(t, http.StatusBadGateway, w.Code)
	env := decodeProxyEnvelope(t, w)
	assert.Equal(t, 502, env.Code)
}

// ============ 集成测试: 走真实 HTTP mock sub2api ============

func TestProxyHandler_IntegrationWithRealClient_Success(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/admin/dashboard/stats", func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "admin-key-456", r.Header.Get("x-api-key"))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code":    0,
			"message": "success",
			"data": map[string]any{
				"total_users":     42,
				"today_new_users": 2,
				"active_users":    10,
				"total_api_keys":  5,
				"active_api_keys": 4,
				"total_accounts":  15,
				"normal_accounts": 13,
				"error_accounts":  1,
				"total_requests":  1000,
				"total_tokens":    50000,
				"total_cost":      1.23,
				"today_requests":  100,
				"today_tokens":    5000,
				"today_cost":      0.12,
				"uptime":          3600,
				"rpm":             10,
				"tpm":             2000,
				"stats_updated_at": "2026-08-14T12:00:00Z",
				"stats_stale":     true,
			},
		})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := integration.NewSub2APIClient(srv.URL, "admin-key-456")
	handler := NewProxyHandler(client)
	r := setupProxyRouter(handler)

	w := doProxyRequest(r)

	require.Equal(t, http.StatusOK, w.Code)
	env := decodeProxyEnvelope(t, w)
	assert.Equal(t, 0, env.Code)

	var data map[string]any
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.EqualValues(t, 42, data["total_users"])
	assert.True(t, data["stats_stale"].(bool))
}

func TestProxyHandler_IntegrationWithRealClient_Unauthorized(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/admin/dashboard/stats", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code": 401, "message": "unauthorized",
		})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := integration.NewSub2APIClient(srv.URL, "bad-key")
	handler := NewProxyHandler(client)
	r := setupProxyRouter(handler)

	w := doProxyRequest(r)

	// sub2api 401 → proxy 502(非不可达)
	require.Equal(t, http.StatusBadGateway, w.Code)
}
