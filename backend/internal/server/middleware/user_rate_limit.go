package middleware

import (
	"net/http"
	"strconv"

	"aux-system/internal/integration"
	"aux-system/internal/pkg/response"

	"github.com/gin-gonic/gin"
)

// UserRateLimit 为 UserGuard 之后、会代用户调用 Sub2API 网关的端点提供 per-user 令牌桶限流。
//
// 以 UserGuard 验证出的 Sub2API 用户 ID 作为桶键，同一用户多个标签页共享额度；
// 取不到用户时退回按 IP 限流。超限返回 429 并提示 Retry-After。
func UserRateLimit(ratePerSecond float64, burst int) gin.HandlerFunc {
	limiter := newTelemetryLimiter(ratePerSecond, burst)
	retryAfter := "1"
	if ratePerSecond > 0 && ratePerSecond < 1 {
		retryAfter = strconv.Itoa(int(1/ratePerSecond + 0.5))
	}
	return func(c *gin.Context) {
		key := "ip:" + clientIP(c)
		if value, ok := c.Get(string(ContextKeySub2APIUser)); ok {
			if user, ok := value.(*integration.Sub2APIUserInfo); ok && user != nil && user.ID > 0 {
				key = "user:" + strconv.FormatInt(user.ID, 10)
			}
		}
		if !limiter.limiterFor(key).Allow() {
			c.Header("Retry-After", retryAfter)
			response.Error(c, http.StatusTooManyRequests, "rate limit exceeded")
			c.Abort()
			return
		}
		c.Next()
	}
}
