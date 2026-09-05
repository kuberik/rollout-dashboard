package main

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	ginzip "github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
)

// A spoke that, like the real one, gzips when the caller accepts gzip.
func gzippingSpoke(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := []byte(`{"rollout":{"metadata":{"name":"hello-frontend-app"}}}`)
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			w.Header().Set("Content-Encoding", "gzip")
			zw := gzip.NewWriter(w)
			_, _ = zw.Write(body)
			_ = zw.Close()
			return
		}
		_, _ = w.Write(body)
	}))
}

// Regression for 2026-09-05: a spoke-proxied response reached Safari with
// `Content-Encoding: gzip,gzip` and two gzip layers, because the browser's
// Accept-Encoding was forwarded to the spoke and the hub compressed again.
func TestSpokeProxyCompressesExactlyOnce(t *testing.T) {
	gin.SetMode(gin.TestMode)
	spoke := gzippingSpoke(t)
	defer spoke.Close()

	r := gin.New()
	r.Use(ginzip.Gzip(ginzip.DefaultCompression))
	r.GET("/api/rollouts/:namespace/:name", func(c *gin.Context) { proxyToRemote(c, spoke.URL) })

	req := httptest.NewRequest(http.MethodGet, "/api/rollouts/hello-dep-dev/hello-frontend-app", nil)
	req.Header.Set("Accept-Encoding", "gzip, deflate, br")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if got := rec.Header().Values("Content-Encoding"); len(got) != 1 || got[0] != "gzip" {
		t.Fatalf("Content-Encoding = %v, want exactly [gzip]", got)
	}
	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatalf("body is not gzip: %v", err)
	}
	plain, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("decoding one layer: %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(plain, &doc); err != nil {
		t.Fatalf("one gzip layer did not yield JSON (a second layer remains?): %v; first bytes %q", err, plain[:min(8, len(plain))])
	}
	if _, ok := doc["rollout"]; !ok {
		t.Fatalf("unexpected body %s", plain)
	}
}

// Without gzip acceptance the proxied body is plain JSON and carries no encoding.
func TestSpokeProxyIdentityWhenClientDoesNotAcceptGzip(t *testing.T) {
	gin.SetMode(gin.TestMode)
	spoke := gzippingSpoke(t)
	defer spoke.Close()

	r := gin.New()
	r.Use(ginzip.Gzip(ginzip.DefaultCompression))
	r.GET("/api/rollouts/:namespace/:name", func(c *gin.Context) { proxyToRemote(c, spoke.URL) })

	req := httptest.NewRequest(http.MethodGet, "/api/rollouts/hello-dep-dev/hello-frontend-app", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if ce := rec.Header().Get("Content-Encoding"); ce != "" {
		t.Fatalf("Content-Encoding = %q, want none", ce)
	}
	var doc map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("body is not plain JSON: %v", err)
	}
}
