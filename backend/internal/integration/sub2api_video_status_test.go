package integration

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"aux-system/internal/asynctask"

	"github.com/stretchr/testify/require"
)

func mockVideoStatusGateway(t *testing.T, handler http.HandlerFunc) *Sub2APIClient {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return NewSub2APIClient(srv.URL)
}

func TestQueryVideoTaskStatusUsesProviderPathAndAPIKey(t *testing.T) {
	var paths, auths []string
	client := mockVideoStatusGateway(t, func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.EscapedPath())
		auths = append(auths, r.Header.Get("Authorization"))
		require.Equal(t, http.MethodGet, r.Method)
		if strings.HasPrefix(r.URL.Path, "/v1/videos/") {
			writeJSON(w, http.StatusOK, map[string]any{"id": "req/1", "status": "done", "video": map[string]any{"url": "/v1/videos/req%2F1/content"}})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": "cgt-1", "status": "Succeeded", "content": map[string]any{"video_url": "https://ark.example.com/v.mp4?sig=abc"}})
	})

	grok, err := client.QueryVideoTaskStatus(context.Background(), " sk-owner ", asynctask.ProviderGrok, "req/1")
	require.NoError(t, err)
	require.Equal(t, Sub2APIVideoTaskStatus{Status: "done", ContentPath: "/v1/videos/req%2F1/content"}, grok)

	seedance, err := client.QueryVideoTaskStatus(context.Background(), "sk-owner", asynctask.ProviderSeedance, "cgt-1")
	require.NoError(t, err)
	require.Equal(t, "succeeded", seedance.Status)
	require.Equal(t, "https://ark.example.com/v.mp4?sig=abc", seedance.VideoURL)
	require.Empty(t, seedance.ContentPath)

	require.Equal(t, []string{"/v1/videos/req%2F1", "/v1/contents/generations/tasks/cgt-1"}, paths)
	require.Equal(t, []string{"Bearer sk-owner", "Bearer sk-owner"}, auths)
}

func TestQueryVideoTaskStatusParsesUpstreamErrorsAndUnsafeURLs(t *testing.T) {
	bodies := map[string]string{
		"/v1/videos/failed":   `{"status":"failed","error":{"code":"moderation","message":"内容审核未通过"},"video":{"url":"javascript:alert(1)"}}`,
		"/v1/videos/expired":  `{"status":"expired","error":"task expired"}`,
		"/v1/videos/weird":    `{"status":"pending","video":"not-an-object","error":42}`,
		"/v1/videos/outside":  `{"status":"done","video":{"url":"//evil.example.com/v1/videos/x/content"}}`,
		"/v1/videos/absolute": `{"status":"done","video":{"url":"https://cdn.x.ai/v.mp4"}}`,
	}
	client := mockVideoStatusGateway(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(bodies[r.URL.Path]))
	})
	query := func(id string) Sub2APIVideoTaskStatus {
		status, err := client.QueryVideoTaskStatus(context.Background(), "sk", asynctask.ProviderGrok, id)
		require.NoError(t, err, id)
		return status
	}

	require.Equal(t, Sub2APIVideoTaskStatus{Status: "failed", ErrorMessage: "内容审核未通过"}, query("failed"))
	require.Equal(t, Sub2APIVideoTaskStatus{Status: "expired", ErrorMessage: "task expired"}, query("expired"))
	require.Equal(t, Sub2APIVideoTaskStatus{Status: "pending"}, query("weird"))
	require.Equal(t, Sub2APIVideoTaskStatus{Status: "done"}, query("outside"))
	require.Equal(t, Sub2APIVideoTaskStatus{Status: "done", VideoURL: "https://cdn.x.ai/v.mp4"}, query("absolute"))
}

func TestQueryVideoTaskStatusMapsGatewayStatusCodes(t *testing.T) {
	cases := []struct {
		status int
		want   error
	}{
		{http.StatusNotFound, ErrVideoTaskNotFound},
		{http.StatusUnauthorized, ErrVideoStatusRejected},
		{http.StatusPaymentRequired, ErrVideoStatusRejected},
		{http.StatusForbidden, ErrVideoStatusRejected},
		{http.StatusTooManyRequests, ErrVideoStatusRateLimited},
		{http.StatusBadGateway, ErrSub2APIUnreachable},
	}
	for _, tc := range cases {
		client := mockVideoStatusGateway(t, func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, tc.status, map[string]any{"error": map[string]any{"message": "rejected sk-secret-key"}})
		})
		_, err := client.QueryVideoTaskStatus(context.Background(), "sk-secret-key", asynctask.ProviderGrok, "req")
		require.True(t, errors.Is(err, tc.want), "status %d: %v", tc.status, err)
		require.NotContains(t, err.Error(), "sk-secret-key")
	}

	client := mockVideoStatusGateway(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("<html>"))
	})
	_, err := client.QueryVideoTaskStatus(context.Background(), "sk", asynctask.ProviderGrok, "req")
	require.ErrorIs(t, err, ErrSub2APIUnreachable)
}

func TestQueryVideoTaskStatusRejectsInvalidInputWithoutCallingGateway(t *testing.T) {
	calls := 0
	client := mockVideoStatusGateway(t, func(w http.ResponseWriter, _ *http.Request) {
		calls++
		writeJSON(w, http.StatusOK, map[string]any{"status": "done"})
	})
	_, err := client.QueryVideoTaskStatus(context.Background(), " ", asynctask.ProviderGrok, "req")
	require.ErrorIs(t, err, ErrVideoStatusRejected)
	_, err = client.QueryVideoTaskStatus(context.Background(), "sk", asynctask.ProviderGrok, " ")
	require.ErrorIs(t, err, ErrVideoTaskNotFound)
	_, err = client.QueryVideoTaskStatus(context.Background(), "sk", "sora", "req")
	require.ErrorIs(t, err, ErrUnsupportedVideoProvider)
	require.Zero(t, calls)
}
