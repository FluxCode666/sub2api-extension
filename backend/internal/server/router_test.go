package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"sub2api-extension/internal/config"
	"sub2api-extension/internal/handler"
	adminhandler "sub2api-extension/internal/handler/admin"
	"sub2api-extension/internal/integration"
	"sub2api-extension/internal/service"
	"sub2api-extension/internal/web"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestConfig() *config.Config {
	return &config.Config{
		Server: config.ServerConfig{
			Host: "0.0.0.0",
			Port: 8787,
			Mode: "debug",
		},
		Database: config.DatabaseConfig{
			Host: "localhost", Port: 5432, User: "aux",
			DBName: "auxdb", SSLMode: "disable",
		},
		JWT: config.JWTConfig{Secret: "test-secret"},
	}
}

// newTestAuthDeps 装配管理员鉴权依赖(指向不可达的 sub2api, 仅用于路由结构测试)。
func newTestAuthDeps() (*handler.AuthHandler, *service.AuthService) {
	client := integration.NewSub2APIClient("http://127.0.0.1:1")
	svc := service.NewAuthService(client, "test-secret", 1, 0)
	return handler.NewAuthHandler(svc), svc
}

// newTestTelemetryHandler 装配 telemetry handler(用 mock store, 仅用于路由结构测试)。
func newTestTelemetryHandler() *handler.TelemetryHandler {
	svc := service.NewTelemetryService(&mockTelemetryStore{})
	return handler.NewTelemetryHandler(svc)
}

// newTestAnalyticsHandler 装配 analytics handler(用 mock store, 仅用于路由结构测试)。
func newTestAnalyticsHandler() *adminhandler.AnalyticsHandler {
	svc := service.NewAnalyticsService(&mockAnalyticsStoreForRouter{})
	return adminhandler.NewAnalyticsHandler(svc)
}

// mockAnalyticsStoreForRouter 是 AnalyticsStore 的内存 mock, 用于路由测试(不依赖真实 DB)。
type mockAnalyticsStoreForRouter struct{}

func (m *mockAnalyticsStoreForRouter) CountPageViewsByPageID(_ context.Context) ([]service.PageViewCount, error) {
	return nil, nil
}
func (m *mockAnalyticsStoreForRouter) CountFeatureClicksByFeature(_ context.Context) ([]service.FeatureClickCount, error) {
	return nil, nil
}

// mockTelemetryStore 是 TelemetryStore 的内存 mock, 用于路由测试(不依赖真实 DB)。
type mockTelemetryStore struct {
	pageViews     []service.PageViewRecord
	featureClicks []service.FeatureClickRecord
}

func (m *mockTelemetryStore) CreatePageView(_ context.Context, rec service.PageViewRecord) error {
	m.pageViews = append(m.pageViews, rec)
	return nil
}

func (m *mockTelemetryStore) CreateFeatureClick(_ context.Context, rec service.FeatureClickRecord) error {
	m.featureClicks = append(m.featureClicks, rec)
	return nil
}

func TestSetupRouter_HealthEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "ok")
	assert.Contains(t, w.Body.String(), "sub2api-extension")
}

func TestSetupRouter_AuxGroupExists(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	// /api/aux 占位端点应返回 200
	req := httptest.NewRequest(http.MethodGet, "/api/aux", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "aux")
}

func TestSetupRouter_PublicHomepageConfigReturnsDefaults(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/aux/homepage/config", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "TERALEMO")
	assert.Contains(t, w.Body.String(), "consoleHref")
	assert.Contains(t, w.Body.String(), "trustedPartners")
}

func TestSetupRouter_AuxAdminGuardedWithoutSession(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	// /api/aux/admin 受守卫保护, 无附属会话 → 401(U3 加守卫后行为)
	req := httptest.NewRequest(http.MethodGet, "/api/aux/admin", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestSetupRouter_AdminSessionEndpointOutsideGuard(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	// POST /api/aux/admin/session 在守卫外: 缺 token 应返回 400(而非 401),
	// 证明它未被 AdminGuard 拦截。
	req := httptest.NewRequest(http.MethodPost, "/api/aux/admin/session", nil)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusBadRequest, w.Code)
}

func TestSetupRouter_AdminLoginEndpointOutsideGuard(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	// POST /api/aux/admin/login 在守卫外: 缺 body 应返回 400(而非 401),
	// 证明它未被 AdminGuard 拦截(独立登录入口, 调用时尚无附属会话)。
	req := httptest.NewRequest(http.MethodPost, "/api/aux/admin/login", nil)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusBadRequest, w.Code)
}

func TestSetupRouter_UnknownPathReturns404(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/aux/nonexistent", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusNotFound, w.Code)
}

// TestSetupRouter_UnknownPathReturnsStandardEnvelope 验证 NoRoute 404 返回标准
// 错误 envelope {code, message}, 而非 gin.H{"error":...}(#11)。
func TestSetupRouter_UnknownPathReturnsStandardEnvelope(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/aux/nonexistent", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusNotFound, w.Code)

	var env map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &env))
	assert.Equal(t, float64(http.StatusNotFound), env["code"], "应返回标准 envelope 的 code 字段")
	assert.NotEmpty(t, env["message"], "应返回标准 envelope 的 message 字段")
	_, hasErrorKey := env["error"]
	assert.False(t, hasErrorKey, "不应使用旧 gin.H{\"error\":...} 形状")
}

func TestSetupRouter_RemovedSub2APIStatsEndpointReturns404(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	// 重复展示 sub2api 统计已移除；这个旧端点不应再被 AdminGuard 接管。
	req := httptest.NewRequest(http.MethodGet, "/api/aux/admin/sub2api/dashboard-stats", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusNotFound, w.Code)
}

func TestSetupRouter_ReleaseMode(t *testing.T) {
	cfg := newTestConfig()
	cfg.Server.Mode = "release"
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	assert.Equal(t, gin.ReleaseMode, gin.Mode())
}

func TestSetupRouter_DevelopMode(t *testing.T) {
	gin.SetMode(gin.DebugMode)
	cfg := newTestConfig()
	cfg.Server.Mode = "debug"
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	// debug 模式不应切换到 release
	assert.NotEqual(t, gin.ReleaseMode, gin.Mode())
}

// ============ U5: 埋点端点路由测试 ============

func TestSetupRouter_TelemetryPageViewEndpointOutsideGuard(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	// POST /api/aux/telemetry/page-view 在守卫外: 无任何 token/会话,
	// 缺字段应返回 400(而非 401), 证明它未被 AdminGuard 拦截, 匿名可写。
	req := httptest.NewRequest(http.MethodPost, "/api/aux/telemetry/page-view", nil)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusBadRequest, w.Code, "埋点端点应在守卫外, 缺字段返回 400 而非 401")
}

func TestSetupRouter_TelemetryFeatureClickEndpointOutsideGuard(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	// POST /api/aux/telemetry/feature-click 在守卫外: 无任何 token/会话,
	// 缺字段应返回 400(而非 401)。
	req := httptest.NewRequest(http.MethodPost, "/api/aux/telemetry/feature-click", nil)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusBadRequest, w.Code, "埋点端点应在守卫外, 缺字段返回 400 而非 401")
}

func TestSetupRouter_TelemetryPageViewAcceptsAnonymousPayload(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	// 匿名访客(无任何 auth 头)提交合法 page-view → 应返回 201(而非 401)。
	// 这验证埋点端点确实在公开分组, 匿名可写(R8/R11)。
	body := `{"page_id":"home","visitor_id":"v1","is_admin":false}`
	req := httptest.NewRequest(http.MethodPost, "/api/aux/telemetry/page-view", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusCreated, w.Code, "匿名访客应能成功上报埋点")
}

// ============ U6: 分析仪表盘端点路由测试 ============

func TestSetupRouter_AnalyticsEndpointGuardedWithoutSession(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	// /api/aux/admin/analytics/overview 受守卫保护, 无附属会话 → 401
	req := httptest.NewRequest(http.MethodGet, "/api/aux/admin/analytics/overview", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusUnauthorized, w.Code, "analytics 端点应在守卫子组内, 无会话 → 401")
}

func TestSetupRouter_AnalyticsEndpointRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	// 用有效附属会话访问 analytics 端点 → 应返回 200(路由已注册, handler 被调用)
	token, err := authService.IssueSession(&integration.Sub2APIUserInfo{
		ID: 1, Email: "a@e.com", Username: "admin", Role: "admin",
	})
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodGet, "/api/aux/admin/analytics/overview", nil)
	req.Header.Set("X-Aux-Session", token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// 不应 404(路由已注册), 应是 200(mock store 返回空数据)
	require.Equal(t, http.StatusOK, w.Code, "管理员会话应能访问 analytics 端点, 返回 200")
	assert.Contains(t, w.Body.String(), "page_views")
	assert.Contains(t, w.Body.String(), "feature_clicks")
}

func TestSetupRouter_ExamplesStatusEndpointGuardedWithoutSession(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/aux/admin/examples/status", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestSetupRouter_ExamplesStatusEndpointRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	token, err := authService.IssueSession(&integration.Sub2APIUserInfo{
		ID: 1, Email: "a@e.com", Username: "admin", Role: "admin",
	})
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodGet, "/api/aux/admin/examples/status", nil)
	req.Header.Set("X-Aux-Session", token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "sub2api-extension")
	assert.Contains(t, w.Body.String(), "server_time")
}

func TestSetupRouter_AnalyticsEndpointNilHandlerSkipped(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	// analyticsHandler 传 nil → 路由不注册 → 404
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), nil, nil, nil)

	token, err := authService.IssueSession(&integration.Sub2APIUserInfo{
		ID: 1, Email: "a@e.com", Username: "admin", Role: "admin",
	})
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodGet, "/api/aux/admin/analytics/overview", nil)
	req.Header.Set("X-Aux-Session", token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusNotFound, w.Code, "analyticsHandler 为 nil 时路由不应注册 → 404")
}

// ============ U7: 前端静态托管测试 ============

func TestSetupRouter_FrontendStaticSkippedWithoutEnv(t *testing.T) {
	gin.SetMode(gin.TestMode)
	// 不设置 SUB2API_EXTENSION_FRONTEND_DIST → 静态托管跳过, 非 API 路径应 404
	os.Unsetenv("SUB2API_EXTENSION_FRONTEND_DIST")
	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/some-spa-route", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusNotFound, w.Code, "未设置 SUB2API_EXTENSION_FRONTEND_DIST 时非 API 路径应 404")
}

func TestSetupRouter_FrontendStaticServesIndexForSPARoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	// 创建临时 dist 目录(含 index.html 与 assets)
	distDir := t.TempDir()
	indexPath := filepath.Join(distDir, "index.html")
	require.NoError(t, os.WriteFile(indexPath, []byte("<!doctype html><html><body>SPA</body></html>"), 0o644))
	assetsDir := filepath.Join(distDir, "assets")
	require.NoError(t, os.MkdirAll(assetsDir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(assetsDir, "app.js"), []byte("console.log(1)"), 0o644))
	t.Setenv("SUB2API_EXTENSION_FRONTEND_DIST", distDir)

	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	// SPA history fallback: 非 API 路径返回 index.html
	req := httptest.NewRequest(http.MethodGet, "/admin/dashboard", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "SPA", "SPA 路由应 fallback 到 index.html")

	// /assets/* 直接映射静态文件
	req2 := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w2.Body.String(), "console.log")

	// /health 仍正常(不受静态托管影响)
	req3 := httptest.NewRequest(http.MethodGet, "/health", nil)
	w3 := httptest.NewRecorder()
	r.ServeHTTP(w3, req3)
	require.Equal(t, http.StatusOK, w3.Code)
	assert.Contains(t, w3.Body.String(), "sub2api-extension")

	// /api/* 未匹配路径仍返回 404 JSON(不被 index.html 接管)
	req4 := httptest.NewRequest(http.MethodGet, "/api/aux/nonexistent", nil)
	w4 := httptest.NewRecorder()
	r.ServeHTTP(w4, req4)
	require.Equal(t, http.StatusNotFound, w4.Code)
}

func TestSetupRouter_FrontendStaticSkippedForNonexistentDir(t *testing.T) {
	gin.SetMode(gin.TestMode)
	// SUB2API_EXTENSION_FRONTEND_DIST 指向不存在的目录 → 静默跳过
	t.Setenv("SUB2API_EXTENSION_FRONTEND_DIST", "/nonexistent/path/that/does/not/exist")
	cfg := newTestConfig()
	healthHandler := web.NewHealthHandler()
	authHandler, authService := newTestAuthDeps()
	r := SetupRouter(cfg, healthHandler, authHandler, authService, newTestTelemetryHandler(), newTestAnalyticsHandler(), nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/some-spa-route", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusNotFound, w.Code, "dist 目录不存在时应静默跳过静态托管")
}
