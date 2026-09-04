package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestWriteJSONWithETag_FirstRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/thing", func(c *gin.Context) {
		writeJSONWithETag(c, http.StatusOK, gin.H{"hello": "world"})
	})

	req := httptest.NewRequest(http.MethodGet, "/thing", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if w.Body.Len() == 0 {
		t.Fatalf("expected a non-empty body on first request")
	}
	etag := w.Header().Get("ETag")
	if etag == "" {
		t.Fatalf("expected an ETag header to be set")
	}
	if cc := w.Header().Get("Cache-Control"); cc != "private, no-cache" {
		t.Fatalf("expected Cache-Control: private, no-cache, got %q", cc)
	}
}

func TestWriteJSONWithETag_RevalidationHits304(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/thing", func(c *gin.Context) {
		writeJSONWithETag(c, http.StatusOK, gin.H{"hello": "world"})
	})

	// First request to learn the ETag.
	req1 := httptest.NewRequest(http.MethodGet, "/thing", nil)
	w1 := httptest.NewRecorder()
	r.ServeHTTP(w1, req1)
	etag := w1.Header().Get("ETag")
	if etag == "" {
		t.Fatalf("expected an ETag on the first response")
	}

	// Second request with If-None-Match set to that ETag must 304 with an
	// empty body — this is the "repeat poll costs ~0 bytes" behavior the
	// frontend's 5-15s refetchInterval depends on for it to be cheap.
	req2 := httptest.NewRequest(http.MethodGet, "/thing", nil)
	req2.Header.Set("If-None-Match", etag)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)

	if w2.Code != http.StatusNotModified {
		t.Fatalf("expected 304, got %d", w2.Code)
	}
	if w2.Body.Len() != 0 {
		t.Fatalf("expected an empty body on 304, got %d bytes: %q", w2.Body.Len(), w2.Body.String())
	}
	if got := w2.Header().Get("ETag"); got != etag {
		t.Fatalf("expected the 304 to echo the same ETag %q, got %q", etag, got)
	}
}

func TestWriteJSONWithETag_ChangedBodyMisses304(t *testing.T) {
	gin.SetMode(gin.TestMode)
	value := "v1"
	r := gin.New()
	r.GET("/thing", func(c *gin.Context) {
		writeJSONWithETag(c, http.StatusOK, gin.H{"value": value})
	})

	req1 := httptest.NewRequest(http.MethodGet, "/thing", nil)
	w1 := httptest.NewRecorder()
	r.ServeHTTP(w1, req1)
	staleETag := w1.Header().Get("ETag")

	// The underlying data changes between requests (e.g. a rollout got a new
	// resourceVersion) — a client polling with the old ETag must get a full
	// 200 with the new body and a different ETag, not a stale 304.
	value = "v2"
	req2 := httptest.NewRequest(http.MethodGet, "/thing", nil)
	req2.Header.Set("If-None-Match", staleETag)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)

	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200 for a changed body, got %d", w2.Code)
	}
	if w2.Body.Len() == 0 {
		t.Fatalf("expected a non-empty body for a changed resource")
	}
	newETag := w2.Header().Get("ETag")
	if newETag == "" || newETag == staleETag {
		t.Fatalf("expected a fresh ETag different from %q, got %q", staleETag, newETag)
	}
}

func TestWriteJSONWithETag_WeakValidatorPrefixTolerated(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/thing", func(c *gin.Context) {
		writeJSONWithETag(c, http.StatusOK, gin.H{"hello": "world"})
	})

	req1 := httptest.NewRequest(http.MethodGet, "/thing", nil)
	w1 := httptest.NewRecorder()
	r.ServeHTTP(w1, req1)
	etag := w1.Header().Get("ETag")

	req2 := httptest.NewRequest(http.MethodGet, "/thing", nil)
	req2.Header.Set("If-None-Match", "W/"+etag)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)

	if w2.Code != http.StatusNotModified {
		t.Fatalf("expected a weak-prefixed match to still 304, got %d", w2.Code)
	}
}

func TestWriteJSONWithETag_MultiValueIfNoneMatch(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/thing", func(c *gin.Context) {
		writeJSONWithETag(c, http.StatusOK, gin.H{"hello": "world"})
	})

	req1 := httptest.NewRequest(http.MethodGet, "/thing", nil)
	w1 := httptest.NewRecorder()
	r.ServeHTTP(w1, req1)
	etag := w1.Header().Get("ETag")

	req2 := httptest.NewRequest(http.MethodGet, "/thing", nil)
	req2.Header.Set("If-None-Match", `"deadbeef", `+etag)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)

	if w2.Code != http.StatusNotModified {
		t.Fatalf("expected a match found in a comma-separated list to 304, got %d", w2.Code)
	}
}
