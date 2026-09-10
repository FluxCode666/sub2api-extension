package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	adminhandler "sub2api-extension/internal/handler/admin"
	"sub2api-extension/internal/integration"
	"sub2api-extension/internal/update"
	"sub2api-extension/internal/web"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type systemReleaseSource struct{}

func (systemReleaseSource) Latest(context.Context, bool) (*update.Release, error) {
	return &update.Release{Version: "v0.6.0"}, nil
}

func TestSystemEndpointsRequireAdministrator(t *testing.T) {
	gin.SetMode(gin.TestMode)
	authHandler, authService := newTestAuthDeps()
	handler := adminhandler.NewSystemHandler(update.Build{Version: "v0.5.0"}, systemReleaseSource{}, update.NewManager(systemReleaseSource{}, nil, "v0.5.0"))
	router := SetupRouter(newTestConfig(), web.NewHealthHandler(), authHandler, authService, nil, nil, nil, nil, handler)
	for _, request := range []struct{ method, path string }{
		{"GET", "/system/version"}, {"GET", "/system/release"}, {"GET", "/system/update"}, {"POST", "/system/update"},
	} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(request.method, "/api/aux/admin"+request.path, strings.NewReader(`{"version":"v0.6.0"}`)))
		require.Equal(t, http.StatusUnauthorized, w.Code, request.path)
	}
	token, err := authService.IssueSession(&integration.Sub2APIUserInfo{ID: 1, Role: "admin", Username: "admin"})
	require.NoError(t, err)
	for _, path := range []string{"/system/version", "/system/release", "/system/update"} {
		request := httptest.NewRequest(http.MethodGet, "/api/aux/admin"+path, nil)
		request.Header.Set("X-Aux-Session", token)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, request)
		require.Equal(t, 200, w.Code)
		if path == "/system/version" {
			require.Contains(t, w.Body.String(), `"version":"v0.5.0"`)
		}
		if path == "/system/release" {
			require.Contains(t, w.Body.String(), `"canUpdate":false`)
		}
	}
	request := httptest.NewRequest(http.MethodPost, "/api/aux/admin/system/update", strings.NewReader(`{"version":"v1.0.0;id"}`))
	request.Header.Set("X-Aux-Session", token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, request)
	require.Equal(t, 400, w.Code)
}
