package auth

import (
	"strings"

	"github.com/gin-gonic/gin"
)

const TokenContextKey = "oidc_token"

// ExtractTokenMiddleware extracts OIDC token from request headers or cookies.
// oauth2-proxy extAuth sets Authorization: Bearer <access_token> via headersToBackend.
// Cookies are a fallback for direct access or Envoy native OIDC.
func ExtractTokenMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		var token string

		// Authorization header is set by oauth2-proxy via Envoy extAuth headersToBackend.
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) == 2 && strings.ToLower(parts[0]) == "bearer" {
				token = parts[1]
			}
		}

		// Fallback: cookies for Envoy native OIDC or direct access.
		if token == "" {
			for _, name := range []string{"IdToken", "id_token", "access_token"} {
				if cookie, err := c.Cookie(name); err == nil && cookie != "" {
					token = cookie
					break
				}
			}
		}

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
