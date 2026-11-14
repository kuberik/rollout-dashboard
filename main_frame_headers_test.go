package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

// The dashboard must never render inside someone else's frame (clickjacking:
// promote / rollback / pin are one click). The SvelteKit CSP is a <meta> tag,
// and browsers ignore frame-ancestors there, so the deny has to be a response
// header on everything the Go server serves for the frontend: the SPA shell at
// "/", deep links that fall through to index.html, and static assets.
//
// The /demo build is NOT served by this server — scripts/build-demo.sh copies
// it into the website repo, which hosts it and frames it from kuberik.com — so
// nothing here may leak into that build (the header lives only in Go).
func TestFrontendResponsesDenyFraming(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<!doctype html><title>k</title>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "_app"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "_app", "start.js"), []byte("console.log(1)"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KO_DATA_PATH", dir)
	t.Setenv("HUB_URL", "")

	r := setupRouter()

	for _, path := range []string{"/", "/index.html", "/rollouts/team-a/app-1", "/_app/start.js"} {
		t.Run(path, func(t *testing.T) {
			w := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, path, nil)
			r.ServeHTTP(w, req)
			if w.Code >= 400 {
				t.Fatalf("GET %s: status %d", path, w.Code)
			}
			if got := w.Header().Get("Content-Security-Policy"); got != "frame-ancestors 'none'" {
				t.Errorf("GET %s: Content-Security-Policy = %q, want %q", path, got, "frame-ancestors 'none'")
			}
			if got := w.Header().Get("X-Frame-Options"); got != "DENY" {
				t.Errorf("GET %s: X-Frame-Options = %q, want DENY", path, got)
			}
		})
	}
}
