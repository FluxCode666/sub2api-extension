package admin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"aux-system/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockAnalyticsProvider 内存实现 analyticsProvider, 用于 handler 测试。
type mockAnalyticsProvider struct {
	resp *service.OverviewResponse
	err  error
}

func (m *mockAnalyticsProvider) GetOverview(_ context.Context) (*service.OverviewResponse, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.resp, nil
}

// analyticsEnvelope 测试专用响应 envelope。
type analyticsEnvelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func setupAnalyticsRouter(h *AnalyticsHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/aux/admin/analytics/overview", h.GetOverview)
	return r
}

func doAnalyticsGet(r *gin.Engine, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func decodeAnalyticsEnvelope(t *testing.T, w *httptest.ResponseRecorder) analyticsEnvelope {
	t.Helper()
	var resp analyticsEnvelope
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	return resp
}

func TestAnalyticsHandler_GetOverview_Success(t *testing.T) {
	provider := &mockAnalyticsProvider{
		resp: &service.OverviewResponse{
			PageViews: []service.PageViewCountDTO{
				{PageID: "home", Count: 2},
				{PageID: "sample-dynamic", Count: 1},
				{PageID: "ghost-page", Count: 3}, // 孤儿
			},
			FeatureClicks: []service.FeatureClickCountDTO{
				{PageID: "sample-dynamic", FeatureID: "refresh-btn", Count: 5},
				{PageID: "home", FeatureID: "btn-a", Count: 1},
			},
		},
	}
	h := newAnalyticsHandlerWithProvider(provider)
	r := setupAnalyticsRouter(h)

	w := doAnalyticsGet(r, "/api/aux/admin/analytics/overview")

	require.Equal(t, http.StatusOK, w.Code)
	env := decodeAnalyticsEnvelope(t, w)
	assert.Equal(t, 0, env.Code)
	assert.Equal(t, "success", env.Message)

	// 解析 data
	var data service.OverviewResponse
	require.NoError(t, json.Unmarshal(env.Data, &data))
	require.Len(t, data.PageViews, 3)
	assert.Equal(t, "home", data.PageViews[0].PageID)
	assert.Equal(t, 2, data.PageViews[0].Count)
	assert.Equal(t, "ghost-page", data.PageViews[2].PageID)
	assert.Equal(t, 3, data.PageViews[2].Count)

	require.Len(t, data.FeatureClicks, 2)
	assert.Equal(t, "refresh-btn", data.FeatureClicks[0].FeatureID)
	assert.Equal(t, 5, data.FeatureClicks[0].Count)
}

func TestAnalyticsHandler_GetOverview_EmptyData(t *testing.T) {
	provider := &mockAnalyticsProvider{
		resp: &service.OverviewResponse{
			PageViews:     []service.PageViewCountDTO{},
			FeatureClicks: []service.FeatureClickCountDTO{},
		},
	}
	h := newAnalyticsHandlerWithProvider(provider)
	r := setupAnalyticsRouter(h)

	w := doAnalyticsGet(r, "/api/aux/admin/analytics/overview")

	require.Equal(t, http.StatusOK, w.Code)
	env := decodeAnalyticsEnvelope(t, w)
	assert.Equal(t, 0, env.Code)

	var data service.OverviewResponse
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Empty(t, data.PageViews)
	assert.Empty(t, data.FeatureClicks)
}

func TestAnalyticsHandler_GetOverview_StoreError_500(t *testing.T) {
	provider := &mockAnalyticsProvider{err: errors.New("db connection lost")}
	h := newAnalyticsHandlerWithProvider(provider)
	r := setupAnalyticsRouter(h)

	w := doAnalyticsGet(r, "/api/aux/admin/analytics/overview")

	require.Equal(t, http.StatusInternalServerError, w.Code)
	env := decodeAnalyticsEnvelope(t, w)
	assert.Contains(t, env.Message, "failed to fetch")
}

func TestAnalyticsHandler_GetOverview_OrphanPageReturned(t *testing.T) {
	// 孤儿页(后端有但 registry 无)应被后端返回, 前端负责标注。
	provider := &mockAnalyticsProvider{
		resp: &service.OverviewResponse{
			PageViews: []service.PageViewCountDTO{
				{PageID: "home", Count: 1},
				{PageID: "deleted-page", Count: 7}, // 孤儿
			},
		},
	}
	h := newAnalyticsHandlerWithProvider(provider)
	r := setupAnalyticsRouter(h)

	w := doAnalyticsGet(r, "/api/aux/admin/analytics/overview")

	require.Equal(t, http.StatusOK, w.Code)
	var data service.OverviewResponse
	require.NoError(t, json.Unmarshal(decodeAnalyticsEnvelope(t, w).Data, &data))
	require.Len(t, data.PageViews, 2)

	// 孤儿页计数应出现在响应中
	orphans := make(map[string]int)
	for _, pv := range data.PageViews {
		orphans[pv.PageID] = pv.Count
	}
	assert.Equal(t, 7, orphans["deleted-page"], "孤儿页计数应被后端返回")
}
