package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"

	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type captureLogStore struct {
	system []service.SystemLogRecord
}

func (s *captureLogStore) CreateSystemLog(_ context.Context, record service.SystemLogRecord) error {
	s.system = append(s.system, record)
	return nil
}

func (*captureLogStore) CreateOperationLog(context.Context, service.OperationLogRecord) error {
	return nil
}

func (*captureLogStore) ListSystemLogs(context.Context, service.LogFilters) ([]service.SystemLog, int, error) {
	return nil, 0, nil
}

func (*captureLogStore) ListOperationLogs(context.Context, service.LogFilters) ([]service.OperationLog, int, error) {
	return nil, 0, nil
}

func TestRequestLoggerGeneratesAUXRequestID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := &captureLogStore{}
	r := gin.New()
	r.Use(RequestLogger(service.NewLogService(store)))
	r.GET("/ping", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/ping", nil))

	require.Equal(t, http.StatusNoContent, w.Code)
	requestID := w.Header().Get(requestIDHeader)
	assert.Regexp(t, regexp.MustCompile(`^AUX-[0-9]+$`), requestID)
	require.Len(t, store.system, 1)
	assert.Equal(t, requestID, store.system[0].RequestID)
}

func TestRequestLoggerPreservesProvidedRequestID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := &captureLogStore{}
	r := gin.New()
	r.Use(RequestLogger(service.NewLogService(store)))
	r.GET("/ping", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	req.Header.Set(requestIDHeader, "upstream-trace-123")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusNoContent, w.Code)
	assert.Equal(t, "upstream-trace-123", w.Header().Get(requestIDHeader))
	require.Len(t, store.system, 1)
	assert.Equal(t, "upstream-trace-123", store.system[0].RequestID)
}
