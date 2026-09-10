//go:build embed

package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"sub2api-extension/internal/web"
)

// TestEmbedFallbackServesClientAssetsFromSeed 验证资源目录为空时，
// /client-icons/* 与 /client-docs/* 回退到内嵌种子仍返回文件，而非 404。
// 仅 embed 构建且 seed 目录已填充(Dockerfile COPY 或本地手动填充)时有意义。
func TestEmbedFallbackServesClientAssetsFromSeed(t *testing.T) {
	if _, err := os.Stat(filepath.Join("..", "web", "seed", "client-icons")); err != nil {
		t.Skipf("seed assets not populated in this build layout: %v", err)
	}
	gin.SetMode(gin.TestMode)
	_ = os.Unsetenv("SUB2API_EXTENSION_FRONTEND_DIST")

	cfg := newTestConfig()
	cfg.Assets.Dir = t.TempDir() // 空资源目录 → 强制走内嵌回退
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	reqIcon := httptest.NewRequest(http.MethodGet, "/client-icons/claude-code.svg", nil)
	wIcon := httptest.NewRecorder()
	r.ServeHTTP(wIcon, reqIcon)
	require.Equal(t, http.StatusOK, wIcon.Code)
	require.Equal(t, "image/svg+xml", wIcon.Header().Get("Content-Type"))

	reqPng := httptest.NewRequest(http.MethodGet, "/client-docs/claude-code/cc-switch.png", nil)
	wPng := httptest.NewRecorder()
	r.ServeHTTP(wPng, reqPng)
	require.Equal(t, http.StatusOK, wPng.Code)
	require.Equal(t, "image/png", wPng.Header().Get("Content-Type"))

	reqMissing := httptest.NewRequest(http.MethodGet, "/client-icons/does-not-exist.svg", nil)
	wMissing := httptest.NewRecorder()
	r.ServeHTTP(wMissing, reqMissing)
	require.Equal(t, http.StatusNotFound, wMissing.Code)
}
