package auth

import (
	"log"
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
		var tokenSource string

		// Envoy Gateway OIDC stores tokens in cookies with configurable names
		// Default cookie names are "access_token" and "id_token" (as configured in SecurityPolicy)
		// Kubernetes API server requires ID token (JWT) for OIDC authentication, not access token
		accessTokenCookie := "access_token"
		idTokenCookie := "id_token"

		// Use ID token for Kubernetes API calls (required - it's a verifiable JWT)
		if cookie, err := c.Cookie(idTokenCookie); err == nil && cookie != "" {
			token = cookie
			tokenSource = "id_token cookie"
			log.Printf("[OIDC Debug] ID token extracted from %s cookie (length: %d)", idTokenCookie, len(token))
			// Log full token for debugging (temporary)
			log.Printf("[OIDC Debug] Full ID token: %s", cookie)
		} else {
			log.Printf("[OIDC Debug] %s cookie not found or empty (error: %v)", idTokenCookie, err)
		}

		// Also log access token for comparison (temporary debugging)
		if accessCookie, err := c.Cookie(accessTokenCookie); err == nil && accessCookie != "" {
			log.Printf("[OIDC Debug] Full access token: %s", accessCookie)
		}

		// Fallback to access token if ID token not found (shouldn't happen, but just in case)
		if token == "" {
			if cookie, err := c.Cookie(accessTokenCookie); err == nil && cookie != "" {
				token = cookie
				tokenSource = "access_token cookie"
				log.Printf("[OIDC Debug] Access token extracted from %s cookie (length: %d) - note: ID token preferred for K8s API", accessTokenCookie, len(token))
			} else {
				log.Printf("[OIDC Debug] %s cookie not found or empty (error: %v)", accessTokenCookie, err)
			}
		}

		// Fallback to Authorization header if cookies not found
		if token == "" {
			authHeader := c.GetHeader("Authorization")
			if authHeader != "" {
				log.Printf("[OIDC Debug] Authorization header present: %s...", authHeader[:min(20, len(authHeader))])
				// Extract Bearer token
				parts := strings.SplitN(authHeader, " ", 2)
				if len(parts) == 2 && strings.ToLower(parts[0]) == "bearer" {
					token = parts[1]
					tokenSource = "Authorization header"
					log.Printf("[OIDC Debug] Token extracted from Authorization header (length: %d)", len(token))
				} else {
					log.Printf("[OIDC Debug] Authorization header format not recognized (prefix: %s)", parts[0])
				}
			} else {
				log.Printf("[OIDC Debug] No Authorization header found")
			}
		}

		// Log all cookies for debugging
		cookies := c.Request.Cookies()
		if len(cookies) > 0 {
			log.Printf("[OIDC Debug] Request has %d cookies:", len(cookies))
			for _, cookie := range cookies {
				log.Printf("[OIDC Debug]   Cookie: %s (value length: %d)", cookie.Name, len(cookie.Value))
			}
		} else {
			log.Printf("[OIDC Debug] No cookies in request")
		}

		// Log all headers that might contain tokens
		log.Printf("[OIDC Debug] Checking headers:")
		for name, values := range c.Request.Header {
			if strings.Contains(strings.ToLower(name), "auth") || strings.Contains(strings.ToLower(name), "token") || strings.Contains(strings.ToLower(name), "cookie") {
				for _, value := range values {
					log.Printf("[OIDC Debug]   %s: %s...", name, value[:min(50, len(value))])
				}
			}
		}

		// Store token in context if found
		if token != "" {
			c.Set(TokenContextKey, token)
			log.Printf("[OIDC Debug] Token stored in context (source: %s, length: %d, path: %s)", tokenSource, len(token), c.Request.URL.Path)
		} else {
			log.Printf("[OIDC Debug] No token found in request (path: %s, method: %s)", c.Request.URL.Path, c.Request.Method)
		}

		c.Next()
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
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
