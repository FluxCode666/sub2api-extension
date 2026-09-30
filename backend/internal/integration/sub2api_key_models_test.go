package integration

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func mockGatewayModels(t *testing.T, handler http.HandlerFunc) *Sub2APIClient {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/models", handler)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return NewSub2APIClient(srv.URL)
}

func TestListAPIKeyModelsUsesTheAPIKeyAndDeduplicates(t *testing.T) {
	var authHeader string
	client := mockGatewayModels(t, func(w http.ResponseWriter, r *http.Request) {
		authHeader = r.Header.Get("Authorization")
		writeJSON(w, http.StatusOK, map[string]any{
			"object": "list",
			"data": []map[string]any{
				{"id": "claude-opus-5", "type": "model"},
				{"id": " claude-sonnet-5 "},
				{"id": "claude-opus-5"},
				{"id": ""},
			},
		})
	})

	models, err := client.ListAPIKeyModels(context.Background(), " sk-user-key ")
	require.NoError(t, err)
	assert.Equal(t, "Bearer sk-user-key", authHeader)
	assert.Equal(t, []string{"claude-opus-5", "claude-sonnet-5"}, models)
}

func TestListAPIKeyModelsAcceptsGeminiNativeList(t *testing.T) {
	client := mockGatewayModels(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"models": []map[string]any{{"name": "models/gemini-3-pro"}, {"name": "gemini-3-flash"}},
		})
	})

	models, err := client.ListAPIKeyModels(context.Background(), "sk-gemini")
	require.NoError(t, err)
	assert.Equal(t, []string{"gemini-3-pro", "gemini-3-flash"}, models)
}

func TestListAPIKeyModelsMapsUpstreamStates(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{name: "invalid key", status: http.StatusUnauthorized, body: `{"error":{"message":"invalid api key"}}`, want: ErrAPIKeyModelsRejected},
		{name: "disabled key", status: http.StatusForbidden, body: `{}`, want: ErrAPIKeyModelsRejected},
		{name: "upstream failure", status: http.StatusBadGateway, body: `bad gateway`, want: ErrSub2APIUnreachable},
		{name: "invalid json", status: http.StatusOK, body: `<html>`, want: ErrSub2APIUnreachable},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := mockGatewayModels(t, func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			})
			_, err := client.ListAPIKeyModels(context.Background(), "sk-secret-value")
			require.Error(t, err)
			assert.True(t, errors.Is(err, tt.want), "got %v", err)
			assert.NotContains(t, err.Error(), "sk-secret-value")
		})
	}
}

func TestListAPIKeyModelsRejectsEmptyKeyWithoutRequest(t *testing.T) {
	called := false
	client := mockGatewayModels(t, func(http.ResponseWriter, *http.Request) { called = true })

	_, err := client.ListAPIKeyModels(context.Background(), "  ")
	assert.ErrorIs(t, err, ErrAPIKeyModelsRejected)
	assert.False(t, called)
}

func TestListAPIKeyModelsLimitsResponseSize(t *testing.T) {
	client := mockGatewayModels(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":[{"id":"` + strings.Repeat("a", maxKeyModelsBodyBytes) + `"}]}`))
	})

	_, err := client.ListAPIKeyModels(context.Background(), "sk-key")
	assert.ErrorIs(t, err, ErrSub2APIUnreachable)
}
