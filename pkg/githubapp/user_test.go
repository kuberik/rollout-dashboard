package githubapp

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/google/go-github/v88/github"
)

// The chain this asserts is the one the security note in UserClient describes:
//
//	go-github auth round tripper  ← sets Authorization
//	    └── githubcache            ← partitions on it, caches
//	            └── http.DefaultTransport
//
// If the cache were ever moved above the auth layer, `sawAuth` would be empty
// and every user's answers would share one partition.
func TestUserClientCachesThroughTheAuthenticatedChain(t *testing.T) {
	var calls atomic.Int64
	var sawAuth atomic.Value
	sawAuth.Store("")

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		sawAuth.Store(r.Header.Get("Authorization"))
		w.Header().Set("ETag", `"v1"`)
		w.Header().Set("Cache-Control", "private, max-age=60")
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("If-None-Match") == `"v1"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		fmt.Fprint(w, `{"status":"ahead","ahead_by":1,"behind_by":0,"commits":[{"sha":"991829b"}],"files":[]}`)
	}))
	defer ts.Close()

	base := ts.URL + "/"
	client, err := github.NewClient(append(userClientOptions("ghu_test_token"), github.WithURLs(&base, &base))...)
	if err != nil {
		t.Fatalf("build client: %v", err)
	}

	const (
		shaA = "064b655b51595b593262fb780e2d8121e7348f84"
		shaB = "991829b6ab3bdb0100ac0a44d8867460732159f7"
	)
	for i := 0; i < 3; i++ {
		cmp, _, err := client.Repositories.CompareCommits(context.Background(), "octo", "repo", shaA, shaB, nil)
		if err != nil {
			t.Fatalf("compare %d: %v", i, err)
		}
		if len(cmp.Commits) != 1 || cmp.Commits[0].GetSHA() != "991829b" {
			t.Fatalf("compare %d returned %+v", i, cmp.Commits)
		}
	}

	if got := sawAuth.Load().(string); got != "Bearer ghu_test_token" {
		t.Fatalf("upstream saw Authorization %q — the cache is not below the auth layer", got)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("upstream saw %d requests for one immutable sha range, want 1", got)
	}
}
