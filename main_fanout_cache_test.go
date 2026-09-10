package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// A fresh entry must be served from memory with no fetch at all — this is
// the whole reason a repeat page load stopped costing a cross-cluster round
// trip.
func TestSWRFreshEntrySkipsFetch(t *testing.T) {
	c := newSWRCache[string](time.Minute, time.Second, time.Second)
	var calls int32

	fetch := func(context.Context) (string, error) {
		atomic.AddInt32(&calls, 1)
		return "v1", nil
	}
	if got, _ := c.load(context.Background(), "k", fetch); got != "v1" {
		t.Fatalf("first load = %q, want v1", got)
	}
	for i := 0; i < 5; i++ {
		if got, _ := c.load(context.Background(), "k", fetch); got != "v1" {
			t.Fatalf("cached load = %q, want v1", got)
		}
	}
	if n := atomic.LoadInt32(&calls); n != 1 {
		t.Fatalf("fetched %d times, want 1 — fresh entries must not hit the network", n)
	}
}

// A stale entry must be returned IMMEDIATELY, with the refresh happening
// behind the request rather than in front of it.
func TestSWRStaleEntryServedWithoutWaiting(t *testing.T) {
	now := time.Now()
	c := newSWRCache[string](10*time.Millisecond, 5*time.Second, time.Second)
	c.now = func() time.Time { return now }

	release := make(chan struct{})
	var started sync.WaitGroup
	started.Add(1)
	slow := func(context.Context) (string, error) {
		started.Done()
		<-release
		return "v2", nil
	}

	if _, err := c.load(context.Background(), "k", func(context.Context) (string, error) {
		return "v1", nil
	}); err != nil {
		t.Fatalf("seed load: %v", err)
	}

	now = now.Add(time.Second) // entry is now stale

	done := make(chan string, 1)
	go func() {
		v, _ := c.load(context.Background(), "k", slow)
		done <- v
	}()

	select {
	case v := <-done:
		if v != "v1" {
			t.Fatalf("stale load returned %q, want the stale v1 served instantly", v)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("stale load blocked on the refresh instead of serving the cached value")
	}

	started.Wait() // the refresh really did start
	close(release)
}

// Cold start: nothing cached, and the fetch outruns the grace window. The
// request must give up quickly AND the fetch must keep running so the next
// request is warm.
func TestSWRColdTimeoutGivesUpButKeepsFetching(t *testing.T) {
	c := newSWRCache[string](time.Minute, 50*time.Millisecond, 5*time.Second)

	release := make(chan struct{})
	fetched := make(chan struct{})
	slow := func(context.Context) (string, error) {
		<-release
		close(fetched)
		return "late", nil
	}

	start := time.Now()
	_, err := c.load(context.Background(), "k", slow)
	elapsed := time.Since(start)

	if !errors.Is(err, errSpokeColdTimeout) {
		t.Fatalf("cold load err = %v, want errSpokeColdTimeout", err)
	}
	if elapsed > 500*time.Millisecond {
		t.Fatalf("cold load waited %v; grace window is 50ms", elapsed)
	}

	close(release)
	<-fetched
	// Give refresh() a moment to publish under the lock.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if v, ok := c.get("k"); ok && v == "late" {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the abandoned fetch never populated the cache; next request stays cold forever")
}

// Cold start where the fetch beats the grace window: the caller should get
// real data, not a timeout — a first page load must not be missing spokes
// just because nothing was cached yet.
func TestSWRColdFastFetchReturnsValue(t *testing.T) {
	c := newSWRCache[string](time.Minute, 2*time.Second, time.Second)
	got, err := c.load(context.Background(), "k", func(context.Context) (string, error) {
		return "quick", nil
	})
	if err != nil || got != "quick" {
		t.Fatalf("cold fast load = (%q, %v), want (quick, nil)", got, err)
	}
}

// Concurrent cold callers must produce ONE fetch, not one each.
func TestSWRSingleFlight(t *testing.T) {
	c := newSWRCache[string](time.Minute, 5*time.Second, 5*time.Second)
	var calls int32
	fetch := func(context.Context) (string, error) {
		atomic.AddInt32(&calls, 1)
		time.Sleep(50 * time.Millisecond)
		return "v", nil
	}

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); c.load(context.Background(), "k", fetch) }()
	}
	wg.Wait()

	if n := atomic.LoadInt32(&calls); n != 1 {
		t.Fatalf("%d concurrent cold loads caused %d fetches, want 1", 20, n)
	}
}

// A failed refresh must not throw away a value we already have.
func TestSWRFailedRefreshKeepsLastGoodValue(t *testing.T) {
	now := time.Now()
	c := newSWRCache[string](10*time.Millisecond, time.Second, time.Second)
	c.now = func() time.Time { return now }

	c.load(context.Background(), "k", func(context.Context) (string, error) { return "good", nil })
	now = now.Add(time.Second)

	c.load(context.Background(), "k", func(context.Context) (string, error) {
		return "", errors.New("spoke down")
	})

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if v, ok := c.get("k"); ok && v == "good" {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("a failed refresh discarded the last known good value")
}

// ── The security property ──────────────────────────────────────────────────
//
// A spoke trims its /api/rollouts to what the CALLER'S token may list. If two
// users' payloads ever shared a cache key, the hub would hand one user the
// other's namespaces and silently defeat the RBAC boundary the whole
// visibility layer exists to enforce.
func TestSpokePayloadsAreNotSharedAcrossIdentities(t *testing.T) {
	var mu sync.Mutex
	seen := map[string]int{}

	spoke := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tok := r.Header.Get("Authorization")
		mu.Lock()
		seen[tok]++
		mu.Unlock()
		// Each token sees a different namespace, as a real spoke would.
		ns := "ns-for-" + tok
		fmt.Fprintf(w, `{"rollouts":{"items":[{"metadata":{"name":"r","namespace":%q}}]}}`, ns)
	}))
	defer spoke.Close()

	prevCache, prevBreakers := spokeDataCache, breakers
	spokeDataCache = newSWRCache[map[string]json.RawMessage](spokeDataTTL, 5*time.Second, 5*time.Second)
	breakers = newSpokeBreakers()
	defer func() { spokeDataCache, breakers = prevCache, prevBreakers }()

	load := func(token string) string {
		data, err := spokeDataCache.load(context.Background(), identityKey(token)+"|"+spoke.URL,
			func(fctx context.Context) (map[string]json.RawMessage, error) {
				return fetchSpoke(fctx, spoke.URL, token)
			})
		if err != nil {
			t.Fatalf("load for %q: %v", token, err)
		}
		return string(data["rollouts"])
	}

	alice := load("alice-token")
	bob := load("bob-token")

	if alice == bob {
		t.Fatalf("alice and bob got byte-identical spoke payloads (%s) — the cache is leaking across users", alice)
	}
	if !strings.Contains(alice, "ns-for-Bearer alice-token") {
		t.Fatalf("alice got the wrong payload: %s", alice)
	}
	if !strings.Contains(bob, "ns-for-Bearer bob-token") {
		t.Fatalf("bob got the wrong payload: %s", bob)
	}

	// And each identity is independently cached, not re-fetched.
	load("alice-token")
	load("bob-token")
	mu.Lock()
	defer mu.Unlock()
	for tok, n := range seen {
		if n != 1 {
			t.Fatalf("token %q fetched %d times, want 1 (per-identity caching not working)", tok, n)
		}
	}
}

// Cluster names are NOT user-specific, so they may safely be shared — the
// counterpart to the test above, pinning the deliberate asymmetry.
func TestClusterNamesAreSharedAcrossIdentities(t *testing.T) {
	var calls int32
	spoke := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		fmt.Fprint(w, `{"name":"prod-eu","url":"https://kuberik.prod-eu.example"}`)
	}))
	defer spoke.Close()

	prevCache, prevBreakers := spokeNameCache, breakers
	spokeNameCache = newSWRCache[string](spokeNameTTL, 5*time.Second, 5*time.Second)
	breakers = newSpokeBreakers()
	defer func() { spokeNameCache, breakers = prevCache, prevBreakers }()

	for _, tok := range []string{"alice", "bob", "carol"} {
		if got := cachedSpokeClusterName(context.Background(), spoke.URL, tok); got != "prod-eu" {
			t.Fatalf("name for %q = %q, want prod-eu", tok, got)
		}
	}
	if n := atomic.LoadInt32(&calls); n != 1 {
		t.Fatalf("cluster name fetched %d times across 3 users, want 1", n)
	}
}

// A transient name-lookup failure must not pin the URL-derived fallback into
// the cache for a full TTL.
func TestFallbackClusterNameIsNotCached(t *testing.T) {
	var up atomic.Bool
	spoke := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !up.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		fmt.Fprint(w, `{"name":"real-name"}`)
	}))
	defer spoke.Close()

	prevCache, prevBreakers := spokeNameCache, breakers
	spokeNameCache = newSWRCache[string](spokeNameTTL, 2*time.Second, 2*time.Second)
	breakers = newSpokeBreakers()
	defer func() { spokeNameCache, breakers = prevCache, prevBreakers }()

	first := cachedSpokeClusterName(context.Background(), spoke.URL, "")
	if first == "real-name" {
		t.Fatal("spoke was supposed to be failing")
	}

	up.Store(true)
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cachedSpokeClusterName(context.Background(), spoke.URL, "") == "real-name" {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("fallback name was cached; the real name never took over after recovery")
}
