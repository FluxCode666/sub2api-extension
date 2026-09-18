package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"aux-system/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// handlerMockTelemetryStore handler 测试用的内存 store。
// (与 service 包的 mock 不同名,避免跨包混淆)
type handlerMockTelemetryStore struct {
	pageViews     []service.PageViewRecord
	featureClicks []service.FeatureClickRecord
	err           error
}

func (m *handlerMockTelemetryStore) CreatePageView(_ context.Context, rec service.PageViewRecord) error {
	if m.err != nil {
		return m.err
	}
	m.pageViews = append(m.pageViews, rec)
	return nil
}

func (m *handlerMockTelemetryStore) CreateFeatureClick(_ context.Context, rec service.FeatureClickRecord) error {
	if m.err != nil {
		return m.err
	}
	m.featureClicks = append(m.featureClicks, rec)
	return nil
}

// telemetryEnvelope 测试专用响应 envelope。
type telemetryEnvelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Reason  string          `json:"reason,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func setupTelemetryRouter(h *TelemetryHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	// 模拟公开分组注册(与 router.go 中 /api/aux/telemetry/* 一致)
	g := r.Group("/api/aux/telemetry")
	g.POST("/page-view", h.RecordPageView)
	g.POST("/feature-click", h.RecordFeatureClick)
	return r
}

func doTelemetryPost(r *gin.Engine, path string, body any) *httptest.ResponseRecorder {
	jsonBody, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func decodeTelemetryEnvelope(t *testing.T, w *httptest.ResponseRecorder) telemetryEnvelope {
	t.Helper()
	var resp telemetryEnvelope
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	return resp
}

// ============ page-view 端点 ============

func TestTelemetryHandler_RecordPageView_Success(t *testing.T) {
	store := &handlerMockTelemetryStore{}
	svc := service.NewTelemetryService(store)
	h := NewTelemetryHandler(svc)
	r := setupTelemetryRouter(h)

	w := doTelemetryPost(r, "/api/aux/telemetry/page-view", PageViewRequest{
		PageID:    "home",
		VisitorID: "visitor-abc",
		IsAdmin:   false,
	})

	require.Equal(t, http.StatusCreated, w.Code)
	env := decodeTelemetryEnvelope(t, w)
	assert.Equal(t, 0, env.Code)
	assert.Equal(t, "success", env.Message)

	var data map[string]bool
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.True(t, data["recorded"])

	// 验证入库
	require.Len(t, store.pageViews, 1)
	assert.Equal(t, "home", store.pageViews[0].PageID)
	assert.Equal(t, "visitor-abc", store.pageViews[0].VisitorID)
	assert.False(t, store.pageViews[0].IsAdmin)
}

func TestTelemetryHandler_RecordPageView_AdminFlag(t *testing.T) {
	store := &handlerMockTelemetryStore{}
	svc := service.NewTelemetryService(store)
	h := NewTelemetryHandler(svc)
	r := setupTelemetryRouter(h)

	w := doTelemetryPost(r, "/api/aux/telemetry/page-view", PageViewRequest{
		PageID:    "dashboard",
		VisitorID: "visitor-admin",
		IsAdmin:   true,
	})

	require.Equal(t, http.StatusCreated, w.Code)
	require.Len(t, store.pageViews, 1)
	assert.True(t, store.pageViews[0].IsAdmin, "管理员访问应标记 is_admin=true")
}

func TestTelemetryHandler_RecordPageView_MissingPageID_400(t *testing.T) {
	store := &handlerMockTelemetryStore{}
	svc := service.NewTelemetryService(store)
	h := NewTelemetryHandler(svc)
	r := setupTelemetryRouter(h)

	w := doTelemetryPost(r, "/api/aux/telemetry/page-view", PageViewRequest{
		VisitorID: "visitor-abc",
	})

	require.Equal(t, http.StatusBadRequest, w.Code)
	env := decodeTelemetryEnvelope(t, w)
	assert.Contains(t, env.Message, "required")
	assert.Empty(t, store.pageViews)
}

func TestTelemetryHandler_RecordPageView_MissingVisitorID_400(t *testing.T) {
	store := &handlerMockTelemetryStore{}
	svc := service.NewTelemetryService(store)
	h := NewTelemetryHandler(svc)
	r := setupTelemetryRouter(h)

	w := doTelemetryPost(r, "/api/aux/telemetry/page-view", PageViewRequest{
		PageID: "home",
	})

	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Empty(t, store.pageViews)
}

func TestTelemetryHandler_RecordPageView_EmptyBody_400(t *testing.T) {
	store := &handlerMockTelemetryStore{}
	svc := service.NewTelemetryService(store)
	h := NewTelemetryHandler(svc)
	r := setupTelemetryRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/api/aux/telemetry/page-view", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Empty(t, store.pageViews)
}

func TestTelemetryHandler_RecordPageView_StoreError_500(t *testing.T) {
	store := &handlerMockTelemetryStore{err: assert.AnError}
	svc := service.NewTelemetryService(store)
	h := NewTelemetryHandler(svc)
	r := setupTelemetryRouter(h)

	w := doTelemetryPost(r, "/api/aux/telemetry/page-view", PageViewRequest{
		PageID:    "home",
		VisitorID: "visitor-abc",
	})

	require.Equal(t, http.StatusInternalServerError, w.Code)
	env := decodeTelemetryEnvelope(t, w)
	assert.Contains(t, env.Message, "failed to record")
}

// 多次访问 → 多条记录(按访问计)
func TestTelemetryHandler_RecordPageView_MultipleVisitsMultipleRecords(t *testing.T) {
	store := &handlerMockTelemetryStore{}
	svc := service.NewTelemetryService(store)
	h := NewTelemetryHandler(svc)
	r := setupTelemetryRouter(h)

	for i := 0; i < 3; i++ {
		w := doTelemetryPost(r, "/api/aux/telemetry/page-view", PageViewRequest{
			PageID:    "home",
			VisitorID: "visitor-same",
		})
		require.Equal(t, http.StatusCreated, w.Code)
	}

	require.Len(t, store.pageViews, 3, "多次访问应产生多条记录")
}

// ============ feature-click 端点 ============

func TestTelemetryHandler_RecordFeatureClick_Success(t *testing.T) {
	store := &handlerMockTelemetryStore{}
	svc := service.NewTelemetryService(store)
	h := NewTelemetryHandler(svc)
	r := setupTelemetryRouter(h)

	w := doTelemetryPost(r, "/api/aux/telemetry/feature-click", FeatureClickRequest{
		PageID:    "dashboard",
		FeatureID: "refresh-btn",
		VisitorID: "visitor-xyz",
		IsAdmin:   true,
	})

	require.Equal(t, http.StatusCreated, w.Code)
	env := decodeTelemetryEnvelope(t, w)
	assert.Equal(t, 0, env.Code)

	var data map[string]bool
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.True(t, data["recorded"])

	require.Len(t, store.featureClicks, 1)
	rec := store.featureClicks[0]
	assert.Equal(t, "dashboard", rec.PageID)
	assert.Equal(t, "refresh-btn", rec.FeatureID)
	assert.Equal(t, "visitor-xyz", rec.VisitorID)
	assert.True(t, rec.IsAdmin)
}

func TestTelemetryHandler_RecordFeatureClick_MissingFeatureID_400(t *testing.T) {
	store := &handlerMockTelemetryStore{}
	svc := service.NewTelemetryService(store)
	h := NewTelemetryHandler(svc)
	r := setupTelemetryRouter(h)

	w := doTelemetryPost(r, "/api/aux/telemetry/feature-click", FeatureClickRequest{
		PageID:    "dashboard",
		VisitorID: "visitor-xyz",
	})

	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Empty(t, store.featureClicks)
}

func TestTelemetryHandler_RecordFeatureClick_MissingPageID_400(t *testing.T) {
	store := &handlerMockTelemetryStore{}
	svc := service.NewTelemetryService(store)
	h := NewTelemetryHandler(svc)
	r := setupTelemetryRouter(h)

	w := doTelemetryPost(r, "/api/aux/telemetry/feature-click", FeatureClickRequest{
		FeatureID: "refresh-btn",
		VisitorID: "visitor-xyz",
	})

	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Empty(t, store.featureClicks)
}

func TestTelemetryHandler_RecordFeatureClick_StoreError_500(t *testing.T) {
	store := &handlerMockTelemetryStore{err: assert.AnError}
	svc := service.NewTelemetryService(store)
	h := NewTelemetryHandler(svc)
	r := setupTelemetryRouter(h)

	w := doTelemetryPost(r, "/api/aux/telemetry/feature-click", FeatureClickRequest{
		PageID:    "dashboard",
		FeatureID: "refresh-btn",
		VisitorID: "visitor-xyz",
	})

	require.Equal(t, http.StatusInternalServerError, w.Code)
}
