package middleware

import (
	"net/http"

	"aux-system/internal/pkg/response"

	"github.com/gin-gonic/gin"
)

// PublicReadRateLimit 为会代理到上游的匿名只读端点提供 per-IP 令牌桶限流。
//
// 与 TelemetryGuard 使用独立的桶，避免页面埋点与数据读取互相挤占额度；超限返回 429。
func PublicReadRateLimit(ratePerSecond float64, burst int) gin.HandlerFunc {
	limiter := newTelemetryLimiter(ratePerSecond, burst)
	return func(c *gin.Context) {
		if !limiter.limiterFor(clientIP(c)).Allow() {
			c.Header("Retry-After", "1")
			response.Error(c, http.StatusTooManyRequests, "rate limit exceeded")
			c.Abort()
			return
		}
		c.Next()
	}
}
