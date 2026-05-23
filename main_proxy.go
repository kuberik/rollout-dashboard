package main

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/kuberik/rollout-dashboard/pkg/auth"
)

// spokeProxyClient handles requests proxied to remote dashboards.
// No client-level timeout — context cancellation governs (needed for SSE log streams).
var spokeProxyClient = &http.Client{Transport: fanoutTransport}

// hopByHopHeaders are stripped from both directions when proxying.
// https://datatracker.ietf.org/doc/html/rfc7230#section-6.1
var hopByHopHeaders = map[string]bool{
	"connection":          true,
	"keep-alive":          true,
	"proxy-authenticate":  true,
	"proxy-authorization": true,
	"te":                  true,
	"trailers":            true,
	"transfer-encoding":   true,
	"upgrade":             true,
}

// SpokeProxyMiddleware proxies any request carrying ?dashboard=<url> to the named
// remote dashboard, transparently forwarding method, body, headers and SSE streams.
// Requests without the query param fall through to the local handler.
func SpokeProxyMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		dashboard := c.Query("dashboard")
		if dashboard == "" {
			c.Next()
			return
		}
		spokeBase := dashboardBaseURL(dashboard)
		if spokeBase == "" {
			c.Next()
			return
		}
		localBase := dashboardBaseURL(localDashboardURL(c))
		if spokeBase == localBase {
			c.Next()
			return
		}
		proxyToRemote(c, spokeBase)
		c.Abort()
	}
}

func proxyToRemote(c *gin.Context, spokeBase string) {
	// Reconstruct target URL: keep path, strip dashboard from query to prevent recursive proxy.
	q := c.Request.URL.Query()
	q.Del("dashboard")
	target := spokeBase + c.Request.URL.Path
	if encoded := q.Encode(); encoded != "" {
		target += "?" + encoded
	}

	req, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, target, c.Request.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "spoke proxy: build request", "details": err.Error()})
		return
	}

	// Forward request headers (minus hop-by-hop).
	for k, vs := range c.Request.Header {
		if hopByHopHeaders[strings.ToLower(k)] {
			continue
		}
		for _, v := range vs {
			req.Header.Add(k, v)
		}
	}
	// Ensure Bearer token is set from context — the spoke validates the same OIDC token.
	if token := auth.GetTokenFromContext(c); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := spokeProxyClient.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "spoke unreachable", "details": err.Error()})
		return
	}
	defer resp.Body.Close()

	// Forward response headers (minus hop-by-hop).
	for k, vs := range resp.Header {
		if hopByHopHeaders[strings.ToLower(k)] {
			continue
		}
		for _, v := range vs {
			c.Writer.Header().Add(k, v)
		}
	}
	c.Writer.WriteHeader(resp.StatusCode)

	// Stream body with periodic flush — needed for Server-Sent Events.
	flusher, _ := c.Writer.(http.Flusher)
	buf := make([]byte, 32*1024)
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := c.Writer.Write(buf[:n]); werr != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if rerr != nil {
			return
		}
	}
}
