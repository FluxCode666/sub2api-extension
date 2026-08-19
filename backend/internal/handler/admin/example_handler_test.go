package admin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type exampleStatusEnvelope struct {
	Code    int                   `json:"code"`
	Message string                `json:"message"`
	Data    ExampleStatusResponse `json:"data"`
}

func TestExampleHandler_GetStatus(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewExampleHandler()
	r.GET("/api/aux/admin/examples/status", h.GetStatus)

	req := httptest.NewRequest(http.MethodGet, "/api/aux/admin/examples/status", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)

	var envelope exampleStatusEnvelope
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &envelope))
	assert.Equal(t, 0, envelope.Code)
	assert.Equal(t, "success", envelope.Message)
	assert.Equal(t, "sub2api-extension", envelope.Data.Service)
	assert.Equal(t, "ok", envelope.Data.Status)
	_, err := time.Parse(time.RFC3339, envelope.Data.ServerTime)
	require.NoError(t, err)
}
