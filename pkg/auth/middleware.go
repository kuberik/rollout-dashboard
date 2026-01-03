package auth

import (
	"strings"

	"github.com/gin-gonic/gin"
)

const TokenContextKey = "oidc_token"

// ExtractTokenMiddleware extracts OIDC token from request headers or cookies
// Envoy Gateway typically sets the token in:
// 1. Authorization header (Bearer token)
// 2. Or cookies (id_token, access_token)
// The middleware stores the token in the context for use by handlers
func ExtractTokenMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		var token string

		// With forwardAccessToken: true in SecurityPolicy, Envoy Gateway forwards the access token
		// in the standard Authorization header. This is the preferred method.
		// Fallback to cookies if Authorization header is not present.
		accessTokenCookie := "access_token"
		idTokenCookie := "id_token"
		IdTokenCookie := "IdToken"

		// Fallback to IdToken cookie if Authorization header not found
		// This is often used by some OIDC providers/proxies
		if token == "" {
			if cookie, err := c.Cookie(IdTokenCookie); err == nil && cookie != "" {
				token = cookie
			}
		}

		// Fallback to id_token cookie if IdToken not found
		// Kubernetes API server requires ID token (JWT) for OIDC authentication
		if token == "" {
			if cookie, err := c.Cookie(idTokenCookie); err == nil && cookie != "" {
				token = cookie
			}
		}

		// Fallback to access token cookie if ID token not found
		if token == "" {
			if cookie, err := c.Cookie(accessTokenCookie); err == nil && cookie != "" {
				token = cookie
			}
		}

		// Try Authorization header last (e.g. when forwardAccessToken is enabled)
		if token == "" {
			authHeader := c.GetHeader("Authorization")
			if authHeader != "" {
				// Extract Bearer token
				parts := strings.SplitN(authHeader, " ", 2)
				if len(parts) == 2 && strings.ToLower(parts[0]) == "bearer" {
					token = parts[1]
				}
			}
		}

		// Store token in context if found
		if token != "" {
			c.Set(TokenContextKey, token)
		}

		c.Next()
	}
}

// GetTokenFromContext extracts the OIDC token from the Gin context
// Returns empty string if no token is present
func GetTokenFromContext(c *gin.Context) string {
	if token, exists := c.Get(TokenContextKey); exists {
		if tokenStr, ok := token.(string); ok {
			return tokenStr
		}
	}
	return ""
}
