package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"aux-system/internal/integration"
	"aux-system/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type clientModelListerStub struct {
	token string
	err   error
}

func (s *clientModelListerStub) List(_ context.Context, token string) (service.ClientModelList, error) {
	s.token = token
	if s.err != nil {
		return service.ClientModelList{}, s.err
	}
	return service.ClientModelList{Items: []service.ClientModel{{ID: "claude-opus-5", Platforms: []string{"anthropic"}}}}, nil
}

func serveClientModels(lister *clientModelListerStub, token string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/aux/client-docs/models", NewClientModelHandler(lister).List)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/aux/client-docs/models", nil)
	if token != "" {
		request.Header.Set("X-Aux-Token", token)
	}
	router.ServeHTTP(recorder, request)
	return recorder
}

func TestClientModelHandlerReturnsModelsInEnvelope(t *testing.T) {
	lister := &clientModelListerStub{}
	recorder := serveClientModels(lister, " user-token ")

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, "user-token", lister.token)
	var body struct {
		Code int                     `json:"code"`
		Data service.ClientModelList `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	require.Zero(t, body.Code)
	require.Equal(t, "claude-opus-5", body.Data.Items[0].ID)
}

func TestClientModelHandlerMapsUpstreamErrors(t *testing.T) {
	tests := []struct {
		err    error
		status int
		reason string
	}{
		{err: integration.ErrModelPlazaDisabled, status: http.StatusServiceUnavailable, reason: "MODEL_PLAZA_DISABLED"},
		{err: integration.ErrModelPlazaAuthRequired, status: http.StatusServiceUnavailable, reason: "MODEL_PLAZA_AUTH_REQUIRED"},
		{err: integration.ErrSub2APIUnreachable, status: http.StatusServiceUnavailable},
		{err: context.Canceled, status: http.StatusInternalServerError},
	}
	for _, tt := range tests {
		recorder := serveClientModels(&clientModelListerStub{err: tt.err}, "")
		require.Equal(t, tt.status, recorder.Code, tt.err.Error())
		var body struct {
			Code   int    `json:"code"`
			Reason string `json:"reason"`
		}
		require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
		require.Equal(t, tt.status, body.Code)
		require.Equal(t, tt.reason, body.Reason)
		require.NotContains(t, recorder.Body.String(), "upstream")
	}
}
