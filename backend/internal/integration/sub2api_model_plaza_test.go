package integration

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func mockModelPlaza(t *testing.T, handler http.HandlerFunc) *Sub2APIClient {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/model-plaza", handler)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return NewSub2APIClient(srv.URL)
}

func TestListModelPlazaAnonymousAndWithToken(t *testing.T) {
	var authHeaders []string
	client := mockModelPlaza(t, func(w http.ResponseWriter, r *http.Request) {
		authHeaders = append(authHeaders, r.Header.Get("Authorization"))
		writeJSON(w, http.StatusOK, map[string]any{
			"code": 0,
			"data": map[string]any{
				"description": "价格说明",
				"groups": []map[string]any{{
					"id":       1,
					"name":     "Claude 主组",
					"platform": "anthropic",
					"models": []map[string]any{
						{"name": "claude-opus-5", "platform": "anthropic", "pricing": map[string]any{"input": 1}},
					},
				}},
			},
		})
	})

	groups, err := client.ListModelPlaza(context.Background(), "")
	require.NoError(t, err)
	require.Len(t, groups, 1)
	assert.Equal(t, "anthropic", groups[0].Platform)
	assert.Equal(t, "claude-opus-5", groups[0].Models[0].Name)

	_, err = client.ListModelPlaza(context.Background(), " user-token ")
	require.NoError(t, err)
	assert.Equal(t, []string{"", "Bearer user-token"}, authHeaders)
}

func TestListModelPlazaMapsUpstreamStates(t *testing.T) {
	tests := []struct {
		name   string
		status int
		token  string
		want   error
	}{
		{name: "disabled", status: http.StatusNotFound, want: ErrModelPlazaDisabled},
		{name: "login required", status: http.StatusUnauthorized, want: ErrModelPlazaAuthRequired},
		{name: "invalid token", status: http.StatusUnauthorized, token: "expired", want: ErrInvalidToken},
		{name: "server error", status: http.StatusBadGateway, want: ErrSub2APIUnreachable},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := mockModelPlaza(t, func(w http.ResponseWriter, _ *http.Request) {
				writeJSON(w, tt.status, map[string]any{"code": tt.status, "message": "upstream"})
			})
			_, err := client.ListModelPlaza(context.Background(), tt.token)
			require.True(t, errors.Is(err, tt.want), "got %v", err)
		})
	}
}

func TestListModelPlazaRejectsOversizedResponse(t *testing.T) {
	client := mockModelPlaza(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(make([]byte, maxModelPlazaBodyBytes+1))
	})
	_, err := client.ListModelPlaza(context.Background(), "")
	require.ErrorIs(t, err, ErrSub2APIUnreachable)
}
