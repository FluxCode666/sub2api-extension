package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"aux-system/internal/integration"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestUserRateLimitBucketsPerVerifiedUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		if id := c.GetHeader("X-Test-User"); id != "" {
			userID := int64(1)
			if id == "2" {
				userID = 2
			}
			c.Set(string(ContextKeySub2APIUser), &integration.Sub2APIUserInfo{ID: userID})
		}
		c.Next()
	})
	router.POST("/refresh", UserRateLimit(0.5, 2), func(c *gin.Context) { c.Status(http.StatusNoContent) })
	send := func(user string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/refresh", nil)
		request.RemoteAddr = "203.0.113.9:1234"
		if user != "" {
			request.Header.Set("X-Test-User", user)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}

	require.Equal(t, http.StatusNoContent, send("1").Code)
	require.Equal(t, http.StatusNoContent, send("1").Code)
	limited := send("1")
	require.Equal(t, http.StatusTooManyRequests, limited.Code)
	require.Equal(t, "2", limited.Header().Get("Retry-After"))

	require.Equal(t, http.StatusNoContent, send("2").Code, "users on the same IP have separate buckets")
	require.Equal(t, http.StatusNoContent, send("").Code, "unauthenticated requests fall back to the IP bucket")
}
