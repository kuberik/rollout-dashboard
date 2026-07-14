package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"strings"

	"github.com/gin-gonic/gin"
)

// Cookie names for the GitHub App user-authorization flow.
const (
	// githubTokenCookie holds the user's GitHub access token (httpOnly, Secure).
	// The backend reads it per-request so it stays stateless; it forwards to
	// spokes automatically via the existing proxy (Cookie is a normal header).
	githubTokenCookie = "gh_token"
	// githubStateCookie is the short-lived CSRF token for the OAuth round-trip.
	githubStateCookie = "gh_oauth_state"
	// githubReturnCookie remembers the in-app path to return to after login.
	githubReturnCookie = "gh_oauth_return"
)

// randomToken returns a URL-safe random hex string for CSRF state.
func randomToken() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		// rand.Read failing is effectively impossible; fall back to a fixed
		// value so state comparison simply fails closed rather than panicking.
		return "state-unavailable"
	}
	return hex.EncodeToString(b)
}

// readCookie returns a cookie value or "" if absent.
func readCookie(c *gin.Context, name string) string {
	v, err := c.Cookie(name)
	if err != nil {
		return ""
	}
	return v
}

// secureCompare is a constant-time equality check for CSRF state.
func secureCompare(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// sanitizeReturnPath ensures the post-login redirect stays same-origin: it must
// be an absolute in-app path ("/...") and not a protocol-relative ("//host")
// or scheme URL, preventing an open-redirect. Defaults to "/".
func sanitizeReturnPath(p string) string {
	if p == "" || !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") {
		return "/"
	}
	return p
}
