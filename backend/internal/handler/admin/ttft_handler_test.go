package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockTTFTProvider struct {
	resp  *service.TTFTResponse
	err   error
	query service.TTFTQuery
}

func (m *mockTTFTProvider) Query(_ context.Context, query service.TTFTQuery) (*service.TTFTResponse, error) {
	m.query = query
	if m.err != nil {
		return nil, m.err
	}
	return m.resp, nil
}

type ttftEnvelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

func setupTTFTRouter(h *TTFTHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/aux/admin/ops/ttft", h.GetTTFT)
	return r
}

func TestTTFTHandler_GetTTFTParsesFilters(t *testing.T) {
	provider := &mockTTFTProvider{resp: &service.TTFTResponse{Groups: []*service.TTFTFilterOption{}, Accounts: []*service.TTFTFilterOption{}, Buckets: []*service.TTFTBucket{}}}
	r := setupTTFTRouter(&TTFTHandler{provider: provider})

	req := httptest.NewRequest(http.MethodGet, "/api/aux/admin/ops/ttft?date=2026-08-21&start_time=08:30&end_time=09:45&group_id=7&account_id=12", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, 0, decodeTTFTEnvelope(t, w).Code)
	assert.Equal(t, int64(7), *provider.query.GroupID)
	assert.Equal(t, int64(12), *provider.query.AccountID)
	assert.Equal(t, service.TTFTGranularityHour, provider.query.Granularity)
	assert.Equal(t, 75*time.Minute, provider.query.EndTime.Sub(provider.query.StartTime))
}

func TestTTFTHandler_GetTTFTParsesGranularity(t *testing.T) {
	provider := &mockTTFTProvider{resp: &service.TTFTResponse{Groups: []*service.TTFTFilterOption{}, Accounts: []*service.TTFTFilterOption{}, Buckets: []*service.TTFTBucket{}}}
	r := setupTTFTRouter(&TTFTHandler{provider: provider})

	req := httptest.NewRequest(http.MethodGet, "/api/aux/admin/ops/ttft?granularity=minute", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, service.TTFTGranularityMinute, provider.query.Granularity)
}

func TestTTFTHandler_GetTTFTRejectsInvalidGranularity(t *testing.T) {
	provider := &mockTTFTProvider{resp: &service.TTFTResponse{}}
	r := setupTTFTRouter(&TTFTHandler{provider: provider})

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/aux/admin/ops/ttft?granularity=week", nil))

	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, decodeTTFTEnvelope(t, w).Message, "granularity")
}

func TestTTFTHandler_GetTTFTRejectsInvalidRange(t *testing.T) {
	provider := &mockTTFTProvider{resp: &service.TTFTResponse{}}
	r := setupTTFTRouter(&TTFTHandler{provider: provider})

	req := httptest.NewRequest(http.MethodGet, "/api/aux/admin/ops/ttft?start=2026-08-21T10:00&end=2026-08-21T09:00", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, decodeTTFTEnvelope(t, w).Message, "start time")
}

func TestTTFTHandler_GetTTFTMapsDatabaseUnavailable(t *testing.T) {
	provider := &mockTTFTProvider{err: service.ErrSub2APIDatabaseUnavailable}
	r := setupTTFTRouter(&TTFTHandler{provider: provider})

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/aux/admin/ops/ttft", nil))

	require.Equal(t, http.StatusServiceUnavailable, w.Code)
	assert.Contains(t, decodeTTFTEnvelope(t, w).Message, "sub2api database")
}

func decodeTTFTEnvelope(t *testing.T, w *httptest.ResponseRecorder) ttftEnvelope {
	t.Helper()
	var envelope ttftEnvelope
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &envelope))
	return envelope
}
