package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// headerSpoke records the full header set of the last request.
type headerSpoke struct {
	*httptest.Server
	hdr  atomic.Value // http.Header
	body atomic.Value // string
}

func newHeaderSpoke(t *testing.T) *headerSpoke {
	t.Helper()
	hs := &headerSpoke{}
	hs.hdr.Store(http.Header{})
	hs.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hs.hdr.Store(r.Header.Clone())
		b, _ := io.ReadAll(r.Body)
		hs.body.Store(string(b))
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{}`))
	}))
	t.Cleanup(hs.Close)
	return hs
}

func TestProxy_HeaderAllowlist(t *testing.T) {
	spoke := newHeaderSpoke(t)
	useRealSpokeAllowlist(t, spoke.URL)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/x", func(c *gin.Context) { proxyToRemote(c, spoke.URL) })
	req := httptest.NewRequest(http.MethodPost, "/api/x", strings.NewReader(`{"a":1}`))
	for k, v := range map[string]string{
		"X-Auth-Request-Access-Token": "gateway-access-token",
		"X-Auth-Request-Email":        "me@example.com",
		"X-Auth-Request-User":         "me",
		"X-Custom":                    "arbitrary",
		"X-Forwarded-Host":            "hub.example",
		"If-None-Match":               `"abc"`,
		"Content-Type":                "application/json",
		"Accept":                      "application/json",
		fanoutHeader:                  "1",
	} {
		req.Header.Set(k, v)
	}
	r.ServeHTTP(httptest.NewRecorder(), req)
	got := spoke.hdr.Load().(http.Header)
	for _, h := range []string{"X-Auth-Request-Access-Token", "X-Auth-Request-Email", "X-Auth-Request-User", "X-Custom", "X-Forwarded-Host"} {
		if v := got.Get(h); v != "" {
			t.Errorf("spoke received %s=%q", h, v)
		}
	}
	for h, want := range map[string]string{"If-None-Match": `"abc"`, "Content-Type": "application/json", "Accept": "application/json", fanoutHeader: "1"} {
		if v := got.Get(h); v != want {
			t.Errorf("spoke %s=%q, want %q", h, v, want)
		}
	}
	if b := spoke.body.Load().(string); b != `{"a":1}` {
		t.Errorf("body = %q", b)
	}
}

// redirectingSpoke 302s everything to a second server that must never be hit.
func redirectingSpoke(t *testing.T) (spoke *httptest.Server, target *recordingSpoke) {
	t.Helper()
	target = newRecordingSpoke(t)
	spoke = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/landed", http.StatusFound)
	}))
	t.Cleanup(spoke.Close)
	return
}

func TestProxy_RelaysRedirectWithoutFollowing(t *testing.T) {
	spoke, target := redirectingSpoke(t)
	useRealSpokeAllowlist(t, spoke.URL)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/x", func(c *gin.Context) { proxyToRemote(c, spoke.URL) })
	req := httptest.NewRequest(http.MethodGet, "/api/x", nil)
	req.Header.Set(fanoutHeader, "1")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if n := target.hits.Load(); n != 0 {
		t.Fatalf("redirect target got %d requests", n)
	}
	if w.Code != http.StatusFound || w.Header().Get("Location") != target.URL+"/landed" {
		t.Fatalf("got %d Location %q", w.Code, w.Header().Get("Location"))
	}
}

func TestFanoutAndNameProbe_DoNotFollowRedirects(t *testing.T) {
	spoke, target := redirectingSpoke(t)
	useRealSpokeAllowlist(t, spoke.URL)
	if _, err := doFetchSpoke(context.Background(), spoke.URL, "/api/rollouts", "tok"); err == nil {
		t.Error("fetch of a redirecting spoke succeeded")
	} else if se, ok := err.(*spokeStatusError); !ok || se.status != http.StatusFound {
		t.Errorf("fetch err = %#v, want spokeStatusError 302", err)
	}
	if name, err := doFetchSpokeClusterName(context.Background(), spoke.URL, "tok"); err == nil {
		t.Errorf("name probe succeeded with %q", name)
	}
	if n := target.hits.Load(); n != 0 {
		t.Fatalf("redirect target got %d requests (Authorization %q)", n, target.authHdr.Load())
	}
}

func TestSpokeHTTPClient_NoRedirects(t *testing.T) {
	spoke, target := redirectingSpoke(t)
	resp, err := newSpokeHTTPClient(time.Second).Get(spoke.URL)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusFound || target.hits.Load() != 0 {
		t.Fatalf("status %d, target hits %d", resp.StatusCode, target.hits.Load())
	}
}

func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(prev) })
	return &buf
}

func TestAllowlist_MalformedEntryWarnsOnce(t *testing.T) {
	buf := captureLog(t)
	u := fmt.Sprint(time.Now().UnixNano()) // unique raw value: parse results are cached per raw string
	useRealSpokeAllowlist(t, "https://ok.example, ftp://warn-"+u+".example, notaurl-"+u)
	for i := 0; i < 20; i++ {
		spokeURLAllowed("https://ok.example")
	}
	if n := strings.Count(buf.String(), "ignoring"); n != 2 {
		t.Fatalf("got %d warnings, want 2:\n%s", n, buf.String())
	}
}

func TestAllowlist_DroppedSpokeLoggedOnce(t *testing.T) {
	useRealSpokeAllowlist(t, "https://ok.example")
	buf := captureLog(t)
	host := fmt.Sprintf("dropped-%d.example", time.Now().UnixNano())
	for i := 0; i < 20; i++ {
		filterAllowedSpokeURLs([]string{"https://" + host, "https://ok.example"})
	}
	if n := strings.Count(buf.String(), host); n != 1 {
		t.Fatalf("dropped spoke logged %d times, want 1:\n%s", n, buf.String())
	}
}
