package main

import (
	"strings"
	"testing"
	"time"
)

// The key has to separate everything that changes the BODY. The one that
// matters most is the visible repo set: two operators can hold different
// cluster visibility, and serving one of them the other's answer would be a
// data leak, not just a stale page.
func TestChangesCacheKey_SeparatesWhatChangesTheBody(t *testing.T) {
	base := changesCacheKey("tok-a", 30, false, []string{"o/r1", "o/r2"})

	cases := []struct {
		name string
		key  string
	}{
		{"a different user", changesCacheKey("tok-b", 30, false, []string{"o/r1", "o/r2"})},
		{"a different window", changesCacheKey("tok-a", 7, false, []string{"o/r1", "o/r2"})},
		{"the mine-only filter", changesCacheKey("tok-a", 30, true, []string{"o/r1", "o/r2"})},
		{"narrower visibility", changesCacheKey("tok-a", 30, false, []string{"o/r1"})},
		{"wider visibility", changesCacheKey("tok-a", 30, false, []string{"o/r1", "o/r2", "o/r3"})},
	}
	for _, c := range cases {
		if c.key == base {
			t.Errorf("%s produced the same cache key as the base request", c.name)
		}
	}

	// The same request twice must hit, or the cache buys nothing.
	if changesCacheKey("tok-a", 30, false, []string{"o/r1", "o/r2"}) != base {
		t.Fatal("identical requests produced different keys")
	}

	// ⚠️ The raw token must never appear in a key — it would sit in memory as a
	// replayable credential. Same rule tokenCacheKey documents.
	if strings.Contains(base, "tok-a") {
		t.Fatalf("cache key contains the raw token: %s", base)
	}
}

func TestChangesCache_RoundTripAndExpiry(t *testing.T) {
	t.Cleanup(func() {
		changesCacheMu.Lock()
		changesCache = map[string]changesCacheEntry{}
		changesCacheMu.Unlock()
	})

	key := "k1"
	want := ghChangesResponse{User: "alice", Repos: []string{"o/r"}, Since: "2026-09-01"}
	cachedChangesPut(key, want)

	got, ok := cachedChangesGet(key)
	if !ok {
		t.Fatal("a freshly stored entry did not read back")
	}
	if got.User != "alice" || got.Since != "2026-09-01" {
		t.Fatalf("round trip changed the response: %+v", got)
	}

	// An expired entry is a miss, not a stale hit.
	changesCacheMu.Lock()
	changesCache[key] = changesCacheEntry{resp: want, expiresAt: time.Now().Add(-time.Second)}
	changesCacheMu.Unlock()
	if _, ok := cachedChangesGet(key); ok {
		t.Fatal("an expired entry was served")
	}

	if _, ok := cachedChangesGet("never-stored"); ok {
		t.Fatal("an absent key reported a hit")
	}
}

// At the bound the store sweeps expired entries first, and refuses to grow
// rather than evicting a live one at random.
func TestChangesCache_BoundedWithoutEvictingLiveEntries(t *testing.T) {
	t.Cleanup(func() {
		changesCacheMu.Lock()
		changesCache = map[string]changesCacheEntry{}
		changesCacheMu.Unlock()
	})

	changesCacheMu.Lock()
	changesCache = map[string]changesCacheEntry{}
	for i := 0; i < changesResponseCacheMax; i++ {
		changesCache[string(rune('a'+i%26))+time.Now().Format("150405.000000000")+string(rune(i))] =
			changesCacheEntry{expiresAt: time.Now().Add(-time.Second)} // all expired
	}
	changesCacheMu.Unlock()

	cachedChangesPut("fresh", ghChangesResponse{User: "bob"})
	if _, ok := cachedChangesGet("fresh"); !ok {
		t.Fatal("expired entries were not swept to make room")
	}

	changesCacheMu.Lock()
	n := len(changesCache)
	changesCacheMu.Unlock()
	if n > changesResponseCacheMax {
		t.Fatalf("cache grew past its bound: %d", n)
	}
}
