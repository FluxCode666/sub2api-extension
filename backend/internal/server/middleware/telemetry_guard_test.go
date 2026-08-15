package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setupTelemetryGuardRouter 用 TelemetryGuard 包装一个 dummy handler, 用于测试中间件行为。
// dummy handler 模拟真实 handler: 读取并绑定 JSON body, 验证 body 限制效果。
func setupTelemetryGuardRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/aux/telemetry").Use(TelemetryGuard())
	g.POST("/page-view", func(c *gin.Context) {
		var req map[string]any
		if err := c.ShouldBindJSON(&req); err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"code": 400, "message": "bad request"})
			return
		}
		c.Status(http.StatusCreated)
	})
	return r
}

func doTelemetryRequest(r *gin.Engine, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/aux/telemetry/page-view", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// TestTelemetryGuard_AcceptsNormalBody 验证正常大小的请求体通过。
func TestTelemetryGuard_AcceptsNormalBody(t *testing.T) {
	r := setupTelemetryGuardRouter()

	w := doTelemetryRequest(r, `{"page_id":"home","visitor_id":"v1","is_admin":false}`)

	require.Equal(t, http.StatusCreated, w.Code, "正常请求应通过守卫到达 handler")
}

// TestTelemetryGuard_RejectsOversizedBody 验证超过 maxTelemetryBodyBytes 的请求体被拒绝。
// MaxBytesReader 在 handler 读取超长 body 时触发错误 → 400(而非 201 成功)。
func TestTelemetryGuard_RejectsOversizedBody(t *testing.T) {
	r := setupTelemetryGuardRouter()

	// 构造超过 4KB 的请求体
	huge := `{"page_id":"` + strings.Repeat("x", maxTelemetryBodyBytes+100) + `","visitor_id":"v1"}`
	w := doTelemetryRequest(r, huge)

	assert.NotEqual(t, http.StatusCreated, w.Code, "超大 body 不应成功入库")
	assert.Equal(t, http.StatusBadRequest, w.Code, "超大 body 应被 MaxBytesReader 拒绝为 400")
}

// TestTelemetryGuard_RateLimitsExcessiveRequests 验证 per-IP 限流:
// 超出突发容量后返回 429。
func TestTelemetryGuard_RateLimitsExcessiveRequests(t *testing.T) {
	// 用独立限流器避免影响其他测试的全局单例
	limiter := newTelemetryLimiter(1, 3) // 1 req/s, 突发 3

	// 前 3 个请求(突发容量)应通过
	for i := 0; i < 3; i++ {
		assert.True(t, limiter.limiterFor("1.2.3.4").Allow(), "突发容量内第 %d 个请求应通过", i+1)
	}
	// 第 4 个应被限流
	assert.False(t, limiter.limiterFor("1.2.3.4").Allow(), "超出突发容量应被限流")
}

// TestTelemetryGuard_RateLimitPerIP 验证不同 IP 独立限流。
func TestTelemetryGuard_RateLimitPerIP(t *testing.T) {
	limiter := newTelemetryLimiter(1, 2)

	// IP A 用满突发容量
	assert.True(t, limiter.limiterFor("1.1.1.1").Allow())
	assert.True(t, limiter.limiterFor("1.1.1.1").Allow())
	assert.False(t, limiter.limiterFor("1.1.1.1").Allow(), "IP A 应被限流")

	// IP B 仍有独立容量
	assert.True(t, limiter.limiterFor("2.2.2.2").Allow(), "IP B 应有独立容量, 不受 IP A 影响")
}

// TestClientIP_ExtractsFromForwardedFor 验证经反代时取 X-Forwarded-For 首段。
func TestClientIP_ExtractsFromForwardedFor(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/ip", func(c *gin.Context) {
		c.String(http.StatusOK, clientIP(c))
	})

	req := httptest.NewRequest(http.MethodGet, "/ip", nil)
	req.Header.Set("X-Forwarded-For", "203.0.113.5, 70.41.3.18")
	req.RemoteAddr = "10.0.0.1:12345"
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, "203.0.113.5", w.Body.String())
}

// TestClientIP_FallsBackToRemoteAddr 验证无 X-Forwarded-For 时取 RemoteAddr 的 host。
func TestClientIP_FallsBackToRemoteAddr(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/ip", func(c *gin.Context) {
		c.String(http.StatusOK, clientIP(c))
	})

	req := httptest.NewRequest(http.MethodGet, "/ip", nil)
	req.RemoteAddr = "192.0.2.1:54321"
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, "192.0.2.1", w.Body.String())
}
