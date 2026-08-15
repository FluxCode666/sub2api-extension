// Package middleware 提供附属内容系统的 HTTP 中间件。
//
// telemetry_guard 保护匿名可写的埋点端点(/api/aux/telemetry/*):
//   - 请求体大小限制: 防止超大 body 耗尽内存(MaxBytesReader)
//   - per-IP 速率限制: 防止无界写入滥用(令牌桶, golang.org/x/time/rate)
//
// 这些端点不经 AdminGuard, 任何匿名互联网客户端均可写入(R8/R11),
// 必须对公开写入面施加基本防护,避免存储耗尽与分析数据污染(#7)。
package middleware

import (
	"net"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// maxTelemetryBodyBytes 限制埋点请求体大小。
// telemetry 请求体仅含 page_id/feature_id/visitor_id/is_admin, 4KB 足够且留有余量。
const maxTelemetryBodyBytes = 4 * 1024 // 4 KB

// telemetryLimiter per-IP 令牌桶限流器集合。
//
// 每个客户端 IP 拥有独立的令牌桶, 避免单 IP 洪泛拖垮全局。
// 采用惰性创建: 首次见到某 IP 时建立桶。桶无主动驱逐(管理员级流量极小,
// IP 数量有限), 长期运行若 IP 极多可改用 LRU; 当前 MVP 规模无需。
type telemetryLimiter struct {
	mu       sync.Mutex
	buckets  map[string]*rate.Limiter
	rate     rate.Limit // 每秒令牌数
	burst    int        // 桶容量
}

// newTelemetryLimiter 创建 per-IP 限流器。
// r 为每秒允许请求数(令牌补充速率), burst 为突发容量。
func newTelemetryLimiter(r float64, burst int) *telemetryLimiter {
	return &telemetryLimiter{
		buckets: make(map[string]*rate.Limiter),
		rate:    rate.Limit(r),
		burst:   burst,
	}
}

// limiterFor 返回(或惰性创建)指定 IP 的令牌桶。
func (l *telemetryLimiter) limiterFor(ip string) *rate.Limiter {
	l.mu.Lock()
	defer l.mu.Unlock()
	lim, ok := l.buckets[ip]
	if !ok {
		lim = rate.NewLimiter(l.rate, l.burst)
		l.buckets[ip] = lim
	}
	return lim
}

// 全局单例: 所有 telemetry 端点共享同一限流器集合。
// 默认 5 req/s/IP, 突发 10。足以覆盖正常访客, 拦截脚本洪泛。
var defaultTelemetryLimiter = newTelemetryLimiter(5, 10)

// clientIP 提取客户端 IP, 优先取 X-Forwarded-For 首段(经反代时),
// 否则取 RemoteAddr。无 IP 时按空串限流(聚合到同一桶, 安全降级)。
func clientIP(c *gin.Context) string {
	if xff := c.GetHeader("X-Forwarded-For"); xff != "" {
		for i := 0; i < len(xff); i++ {
			if xff[i] == ',' {
				return xff[:i]
			}
		}
		return xff
	}
	host, _, err := net.SplitHostPort(c.Request.RemoteAddr)
	if err != nil {
		return c.Request.RemoteAddr
	}
	return host
}

// TelemetryGuard 保护埋点端点: body 大小限制 + per-IP 速率限制。
//
// 超出 body 限制 → 413; 超出速率 → 429。
// 注册在 /api/aux/telemetry/* 路由组上(守卫外, 匿名可写但受限)。
func TelemetryGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		// body 大小限制: 用 MaxBytesReader 包装, 超限时 ShouldBindJSON 返回错误。
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxTelemetryBodyBytes)

		// per-IP 速率限制
		ip := clientIP(c)
		if !defaultTelemetryLimiter.limiterFor(ip).Allow() {
			c.Header("Retry-After", "1")
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"code":    http.StatusTooManyRequests,
				"message": "rate limit exceeded",
			})
			return
		}

		c.Next()
	}
}
