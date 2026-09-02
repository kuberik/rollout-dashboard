package githubcache

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// etagServer answers like the GitHub REST API: every response carries an ETag
// and a `private, max-age=60` Cache-Control, and a matching `If-None-Match`
// gets a bodiless 304 — the response that costs no rate limit.
type etagServer struct {
	calls        atomic.Int64
	conditional  atomic.Int64
	bodyForToken func(token string) string
	etag         string
	status       int
}

func newETagServer(body string) *etagServer {
	return &etagServer{
		bodyForToken: func(string) string { return body },
		etag:         `"v1"`,
		status:       http.StatusOK,
	}
}

func (s *etagServer) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.calls.Add(1)
		if s.status >= 400 {
			w.Header().Set("Cache-Control", "private, max-age=60")
			w.WriteHeader(s.status)
			fmt.Fprint(w, `{"message":"boom"}`)
			return
		}
		w.Header().Set("ETag", s.etag)
		w.Header().Set("Cache-Control", "private, max-age=60")
		if inm := r.Header.Get("If-None-Match"); inm != "" {
			s.conditional.Add(1)
			if inm == s.etag {
				w.WriteHeader(http.StatusNotModified)
				return
			}
		}
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, s.bodyForToken(r.Header.Get("Authorization")))
	}
}

// get performs a request through rt exactly the way go-github's auth layer
// would: the Authorization header is already set when the cache sees it.
func get(t *testing.T, rt http.RoundTripper, url, token string) (int, string, http.Header) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := rt.RoundTrip(req)
	if err != nil {
		t.Fatalf("round trip: %v", err)
	}
	defer resp.Body.Close()
	// The body MUST be drained: httpcache only stores an entry once the
	// response body reaches EOF.
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return resp.StatusCode, string(b), resp.Header
}

func TestRepeatIsAConditionalRequestAndTheBodyComesFromCache(t *testing.T) {
	srv := newETagServer(`{"commits":[]}`)
	ts := httptest.NewServer(srv.handler())
	defer ts.Close()

	// ImmutableTTL is off so this exercises the DEFAULT policy: store, but
	// always revalidate.
	rt := New(nil, Options{ImmutableTTL: -1})

	if code, body, _ := get(t, rt, ts.URL+"/user", "tok"); code != 200 || body != `{"commits":[]}` {
		t.Fatalf("first request: got %d %q", code, body)
	}
	code, body, hdr := get(t, rt, ts.URL+"/user", "tok")
	if code != 200 {
		t.Fatalf("second request: got status %d, want 200 rebuilt from the cache", code)
	}
	if body != `{"commits":[]}` {
		t.Fatalf("second request body = %q, want the cached body", body)
	}
	if hdr.Get(httpcacheXFromCache) != "1" {
		t.Fatalf("second response was not served from the cache (headers: %v)", hdr)
	}
	if got := srv.conditional.Load(); got != 1 {
		t.Fatalf("upstream saw %d conditional requests, want 1 (the 304 path was not taken)", got)
	}
	if got := srv.calls.Load(); got != 2 {
		t.Fatalf("upstream saw %d requests, want 2 — one full, one conditional", got)
	}
}

func TestMutableResponseIsNeverServedWithoutAsking(t *testing.T) {
	// The upstream says `max-age=60`. A stock cache would answer the next
	// minute's requests blind; for /user (an identity that can change) that is
	// exactly the stale answer this package refuses to give.
	srv := newETagServer(`{"login":"a"}`)
	ts := httptest.NewServer(srv.handler())
	defer ts.Close()
	rt := New(nil, Options{})

	for i := 0; i < 3; i++ {
		if code, _, _ := get(t, rt, ts.URL+"/user", "tok"); code != 200 {
			t.Fatalf("request %d: status %d", i, code)
		}
	}
	if got := srv.calls.Load(); got != 3 {
		t.Fatalf("upstream saw %d requests, want 3 — mutable data must be revalidated every time", got)
	}
}

func TestImmutableCompareIsAnsweredWithNoUpstreamCallAtAll(t *testing.T) {
	srv := newETagServer(`{"commits":[{"sha":"a"}]}`)
	ts := httptest.NewServer(srv.handler())
	defer ts.Close()
	rt := New(nil, Options{ImmutableTTL: time.Minute})

	const path = "/repos/octo/repo/compare/064b655b51595b593262fb780e2d8121e7348f84...991829b6ab3bdb0100ac0a44d8867460732159f7"
	if code, _, _ := get(t, rt, ts.URL+path, "tok"); code != 200 {
		t.Fatalf("first request: status %d", code)
	}
	code, body, hdr := get(t, rt, ts.URL+path, "tok")
	if code != 200 || body != `{"commits":[{"sha":"a"}]}` {
		t.Fatalf("second request: %d %q", code, body)
	}
	if hdr.Get(httpcacheXFromCache) != "1" {
		t.Fatalf("second response did not come from the cache")
	}
	if got := srv.calls.Load(); got != 1 {
		t.Fatalf("upstream saw %d requests, want 1 — a sha-to-sha range cannot change", got)
	}
}

func TestBranchCompareIsNotTreatedAsImmutable(t *testing.T) {
	srv := newETagServer(`{"commits":[]}`)
	ts := httptest.NewServer(srv.handler())
	defer ts.Close()
	rt := New(nil, Options{ImmutableTTL: time.Minute})

	const path = "/repos/octo/repo/compare/main...release"
	get(t, rt, ts.URL+path, "tok")
	get(t, rt, ts.URL+path, "tok")
	if got := srv.calls.Load(); got != 2 {
		t.Fatalf("upstream saw %d requests, want 2 — a branch head moves, so it must be revalidated", got)
	}
}

func TestCacheIsPartitionedByCredential(t *testing.T) {
	srv := newETagServer("")
	srv.bodyForToken = func(auth string) string { return `{"seen":"` + auth + `"}` }
	ts := httptest.NewServer(srv.handler())
	defer ts.Close()
	rt := New(nil, Options{ImmutableTTL: time.Minute})

	const path = "/repos/octo/private/compare/aaaaaaa...bbbbbbb"
	_, aliceBody, _ := get(t, rt, ts.URL+path, "alice")
	_, bobBody, _ := get(t, rt, ts.URL+path, "bob")

	if aliceBody != `{"seen":"Bearer alice"}` {
		t.Fatalf("alice got %q", aliceBody)
	}
	if bobBody != `{"seen":"Bearer bob"}` {
		t.Fatalf("bob was served %q — one user read another user's cached response", bobBody)
	}
	if got := srv.calls.Load(); got != 2 {
		t.Fatalf("upstream saw %d requests, want 2 (one per credential)", got)
	}
	// And alice's own repeat is still free.
	_, again, hdr := get(t, rt, ts.URL+path, "alice")
	if again != aliceBody || hdr.Get(httpcacheXFromCache) != "1" {
		t.Fatalf("alice's repeat was not served from her own partition: %q %v", again, hdr)
	}
}

func TestErrorsAreNotStored(t *testing.T) {
	srv := newETagServer(`{"ok":true}`)
	srv.status = http.StatusForbidden
	ts := httptest.NewServer(srv.handler())
	defer ts.Close()
	rt := New(nil, Options{ImmutableTTL: time.Minute})

	const path = "/repos/octo/repo/compare/aaaaaaa...bbbbbbb"
	if code, _, _ := get(t, rt, ts.URL+path, "tok"); code != 403 {
		t.Fatalf("want the 403 through, got %d", code)
	}
	// Access is granted; the cache must not keep answering 403.
	srv.status = http.StatusOK
	if code, body, _ := get(t, rt, ts.URL+path, "tok"); code != 200 || body != `{"ok":true}` {
		t.Fatalf("after access was granted: %d %q — a cached error was served", code, body)
	}
}

func TestIsImmutableRequest(t *testing.T) {
	cases := []struct {
		url  string
		want bool
	}{
		{"https://api.github.com/repos/o/r/compare/064b655b51595b593262fb780e2d8121e7348f84...991829b6ab3bdb0100ac0a44d8867460732159f7", true},
		{"https://api.github.com/repos/o/r/compare/064b655...991829b", true},
		{"https://api.github.com/repos/o/r/compare/main...991829b", false},
		{"https://api.github.com/repos/o/r/compare/064b655...main", false},
		{"https://api.github.com/repos/o/r/compare/064b655...991829b?page=2", false},
		{"https://api.github.com/repos/o/r/commits/064b655", false},
		{"https://api.github.com/user", false},
	}
	for _, c := range cases {
		req, err := http.NewRequest(http.MethodGet, c.url, nil)
		if err != nil {
			t.Fatalf("bad test url %s: %v", c.url, err)
		}
		if got := IsImmutableRequest(req); got != c.want {
			t.Errorf("IsImmutableRequest(%s) = %v, want %v", c.url, got, c.want)
		}
	}
	req, _ := http.NewRequest(http.MethodPost, "https://api.github.com/repos/o/r/compare/aaaaaaa...bbbbbbb", strings.NewReader(""))
	if IsImmutableRequest(req) {
		t.Errorf("a POST is never immutable")
	}
}

func TestPartitionKeyDoesNotLeakTheCredential(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "https://api.github.com/user", nil)
	req.Header.Set("Authorization", "Bearer ghu_supersecret")
	key := PartitionKey(req)
	if strings.Contains(key, "supersecret") {
		t.Fatalf("partition key %q contains the token", key)
	}
	if len(key) != 64 {
		t.Fatalf("partition key %q is not a sha256 hex digest", key)
	}
}

func TestLRUCacheHonoursItsByteBudget(t *testing.T) {
	c := newLRUCache(10)
	c.Set("a", []byte("12345"))
	c.Set("b", []byte("12345"))
	// Reading "a" makes it the most recent, so "b" is now the eviction victim.
	if _, ok := c.Get("a"); !ok {
		t.Fatalf("a was evicted while the budget still fit")
	}
	c.Set("c", []byte("12345")) // pushes the total to 15 > 10
	if _, ok := c.Get("a"); !ok {
		t.Fatalf("a (most recently read) should have survived")
	}
	if _, ok := c.Get("b"); ok {
		t.Fatalf("b (least recently used) should have been evicted")
	}
	c.Delete("a")
	if _, ok := c.Get("a"); ok {
		t.Fatalf("a was not deleted")
	}
}

func TestPartitionsAreBounded(t *testing.T) {
	srv := newETagServer(`{}`)
	ts := httptest.NewServer(srv.handler())
	defer ts.Close()
	rt := New(nil, Options{MaxPartitions: 2}).(*partitionedTransport)

	for _, tok := range []string{"a", "b", "c"} {
		get(t, rt, ts.URL+"/user", tok)
	}
	rt.mu.Lock()
	n := len(rt.partitions)
	rt.mu.Unlock()
	if n != 2 {
		t.Fatalf("kept %d partitions, want at most 2", n)
	}
}
