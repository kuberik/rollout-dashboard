package main

import (
	"log"
	"net/http"
	"strings"
	"sync"

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

// SpokeProxyMiddleware proxies any request carrying ?cluster=<name> to that
// cluster's dashboard, transparently forwarding method, body, headers and SSE
// streams. The cluster name is resolved to a URL via the registry (see
// main_registry.go). Requests without the param, or for the local cluster, fall
// through to the local handler.
func SpokeProxyMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		name := c.Query("cluster")
		if name == "" {
			c.Next()
			return
		}
		spokeBase, isLocal, err := resolveClusterURL(c, name)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadGateway, gin.H{
				"error":   "unknown or unreachable cluster",
				"details": err.Error(),
			})
			return
		}
		if isLocal || spokeBase == "" {
			c.Next()
			return
		}
		proxyToRemote(c, spokeBase)
		c.Abort()
	}
}

func proxyToRemote(c *gin.Context, spokeBase string) {
	// Reconstruct target URL: keep path, strip cluster from query to prevent recursive proxy.
	q := c.Request.URL.Query()
	q.Del("cluster")
	target := spokeBase + c.Request.URL.Path
	if encoded := q.Encode(); encoded != "" {
		target += "?" + encoded
	}

	req, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, target, c.Request.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "spoke proxy: build request", "details": err.Error()})
		return
	}

	// Forward request headers (minus hop-by-hop, minus Accept-Encoding).
	//
	// ⛔ NEVER FORWARD Accept-Encoding. (2026-09-05, from the human on a phone:
	// a spoke rollout's JSON rendered as gzip garbage.) With the browser's
	// Accept-Encoding forwarded, the spoke gzipped its answer, and the hub's
	// own gzip middleware compressed it AGAIN and appended a second
	// `Content-Encoding: gzip`. Chrome silently decodes both layers; Safari
	// decodes one and shows the rest as bytes. Without the header Go's
	// transport negotiates gzip with the spoke itself and transparently
	// decompresses, so the hub's middleware compresses exactly once.
	for k, vs := range c.Request.Header {
		if hopByHopHeaders[strings.ToLower(k)] || strings.EqualFold(k, "Accept-Encoding") {
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

	// Forward response headers (minus hop-by-hop, minus any encoding the spoke
	// applied: the transport has already decoded it, and the hub's middleware
	// decides the encoding the client gets).
	for k, vs := range resp.Header {
		if hopByHopHeaders[strings.ToLower(k)] || strings.EqualFold(k, "Content-Encoding") || strings.EqualFold(k, "Content-Length") {
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

// clusterPathPrefix is the URL prefix for the path form of every
// cluster-scoped API route: GET|POST /api/clusters/<cluster>/<rest> behaves
// exactly like /api/<rest>?cluster=<cluster> — see ClusterPathRewriteHandler.
const clusterPathPrefix = "/api/clusters/"

// deprecatedClusterQueryAliasOnce makes the "?cluster= is deprecated" log
// line fire once per process, not once per request — otherwise every
// request still using the old query form after the path form shipped would
// flood the log at whatever the caller's polling cadence is.
var deprecatedClusterQueryAliasOnce sync.Once

// ClusterPathRewriteHandler wraps the gin engine with the path form of every
// cluster-scoped API route. GET|POST /api/clusters/:cluster/<rest> is
// rewritten, before gin's router ever sees the request, into
// /api/<rest>?cluster=:cluster — i.e. exactly the request SpokeProxyMiddleware
// already knows how to route correctly today (hub-local cluster name →
// served locally; spoke name → proxied with the caller's own token; unknown
// → the same "unknown or unreachable cluster" error).
//
// This is implemented once, ahead of gin's own routing, rather than as a gin
// route registered per-handler or via gin's HandleContext: HandleContext
// re-runs the FULL middleware chain gin already baked into the matched
// route (gzip, auth token extraction, SpokeProxyMiddleware, ...) a second
// time, which would gzip-encode the response twice. Rewriting the raw
// request before gin's single dispatch avoids that entirely — gin routes
// the rewritten request exactly once, same as any other request.
//
// The one route this deliberately does NOT offer a path form for is
// /api/clusters/:cluster/events/stream — rejected with 404 rather than
// rewritten. The hub's own GET /api/events/stream already aggregates every
// cluster's events (see main.go's multi-cluster fan-out via
// pkg/kubernetes/multistream.go's RunMultiStream); a single-cluster
// path-form stream would just be a second, redundant way to reach the same
// data, and not offering it means nobody can come to depend on it.
//
// The old ?cluster= query form keeps working unchanged — SpokeProxyMiddleware
// still reads it directly, this handler only adds the path form on top. The
// first request in the process's lifetime that arrives with a genuine
// ?cluster= query parameter (i.e. one the caller set, not one this handler
// just added while rewriting a path-form request) logs one deprecation line;
// every later one is silent.
func ClusterPathRewriteHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Query().Get("cluster") != "" {
			deprecatedClusterQueryAliasOnce.Do(func() {
				log.Printf("api: request used the deprecated ?cluster= query parameter (first seen: %s %s) — prefer /api/clusters/:cluster/... instead", req.Method, req.URL.Path)
			})
		}

		rest, cluster, ok := splitClusterPath(req.URL.Path)
		if !ok {
			next.ServeHTTP(w, req)
			return
		}
		if rest == "/events/stream" || strings.HasPrefix(rest, "/events/stream/") {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte(`{"error":"path form not supported for events/stream — GET /api/events/stream already carries every cluster's events"}`))
			return
		}

		q := req.URL.Query()
		q.Set("cluster", cluster)
		req.URL.Path = "/api" + rest
		// The path changed — drop the stale escaped form so gin re-derives
		// EscapedPath()/RawPath from the new Path rather than routing on the
		// pre-rewrite bytes.
		req.URL.RawPath = ""
		req.URL.RawQuery = q.Encode()
		next.ServeHTTP(w, req)
	})
}

// splitClusterPath splits "/api/clusters/<cluster>/<rest...>" into
// ("/<rest...>", "<cluster>", true) — rest always keeps its leading slash,
// cluster is exactly one path segment (a cluster name never itself contains
// a slash). Returns ok=false for anything not matching that shape —
// /api/clusters with no trailing segment, /api/clusters/<cluster> with
// nothing after it, or a path outside /api/clusters/ entirely — all of which
// fall through to the existing router unchanged (a bare /api/clusters/<x>
// 404s exactly as it always has, since no such route exists).
func splitClusterPath(path string) (rest, cluster string, ok bool) {
	if !strings.HasPrefix(path, clusterPathPrefix) {
		return "", "", false
	}
	remainder := path[len(clusterPathPrefix):]
	slash := strings.IndexByte(remainder, '/')
	if slash <= 0 {
		return "", "", false
	}
	cluster = remainder[:slash]
	rest = remainder[slash:]
	if rest == "" || rest == "/" {
		return "", "", false
	}
	return rest, cluster, true
}
