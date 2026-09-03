package middleware

import (
	"context"
	"errors"
	"log"
	"strings"

	"sub2api-extension/internal/integration"
	"sub2api-extension/internal/pkg/response"

	"github.com/gin-gonic/gin"
)

// ContextKeySub2APIUser contains the verified Sub2API customer identity for
// customer-facing endpoints.  It is intentionally distinct from the admin
// extension-session context key.
const ContextKeySub2APIUser ContextKey = "sub2api_user"

type userTokenVerifier interface {
	VerifyUserJWT(ctx context.Context, token string) (*integration.Sub2APIUserInfo, error)
}

// UserGuard validates the short-lived token injected by Sub2API into an iframe.
// The query parameter user_id is non-authoritative and is never consulted.
func UserGuard(verifier userTokenVerifier) gin.HandlerFunc {
	return func(c *gin.Context) {
		if verifier == nil {
			log.Printf("[UserGuard] verifier unavailable path=%s", c.Request.URL.Path)
			response.ServiceUnavailable(c, "sub2api authentication is unavailable")
			c.Abort()
			return
		}
		token := strings.TrimSpace(c.GetHeader("X-Aux-Token"))
		user, err := verifier.VerifyUserJWT(c.Request.Context(), token)
		if err != nil {
			log.Printf("[UserGuard] token verification failed path=%s: %v", c.Request.URL.Path, err)
			if errors.Is(err, integration.ErrInvalidToken) {
				response.Unauthorized(c, "valid sub2api login is required")
			} else {
				response.ServiceUnavailable(c, "failed to verify sub2api login")
			}
			c.Abort()
			return
		}
		c.Set(string(ContextKeySub2APIUser), user)
		c.Next()
	}
}
