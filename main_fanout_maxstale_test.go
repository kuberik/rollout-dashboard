package main

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// seedOld returns a cache whose entry for "k" was last fetched successfully
// 16 minutes ago (the shape of the live report: a quiet identity coming back).
func seedOld(t *testing.T) (*swrCache[string], *time.Time) {
	t.Helper()
	now := time.Now()
	c := newSWRCache[string](10*time.Second, time.Second, time.Second)
	c.now = func() time.Time { return now }
	if _, err := c.load(context.Background(), "k", func(context.Context) (string, error) { return "old", nil }); err != nil {
		t.Fatalf("seed: %v", err)
	}
	now = now.Add(16 * time.Minute)
	return c, &now
}

// An entry older than the max staleness must wait for the refresh, not serve
// the old payload.
func TestSWRTooOldEntryWaitsForRefresh(t *testing.T) {
	c, _ := seedOld(t)
	release := make(chan struct{})
	var once sync.Once
	rel := func() { once.Do(func() { close(release) }) }
	defer rel()
	done := make(chan struct{})
	var v string
	var meta swrMeta
	go func() {
		v, meta, _ = c.loadMeta(context.Background(), "k", func(context.Context) (string, error) {
			<-release
			return "new", nil
		})
		close(done)
	}()
	select {
	case <-done:
		t.Fatalf("returned %q without waiting for the refresh", v)
	case <-time.After(50 * time.Millisecond):
	}
	rel()
	<-done
	if v != "new" || meta.StaleErr != nil {
		t.Fatalf("got %q / %v, want fresh new", v, meta.StaleErr)
	}
}

// Younger than the limit: served at once, refresh behind (existing contract).
func TestSWRYoungStaleEntryStillServedWithoutWaiting(t *testing.T) {
	c, now := seedOld(t)
	*now = now.Add(-16*time.Minute + 20*time.Second) // 20s old, past ttl, under max
	release := make(chan struct{})
	defer close(release)
	v, meta, _ := c.loadMeta(context.Background(), "k", func(context.Context) (string, error) {
		<-release
		return "new", nil
	})
	if v != "old" || meta.StaleErr != nil {
		t.Fatalf("got %q / %v, want old served instantly", v, meta.StaleErr)
	}
}

// Slow refresh past the wait: stale payload comes back flagged.
func TestSWRTooOldSlowRefreshFallsBackFlagged(t *testing.T) {
	c, _ := seedOld(t)
	c.staleWait = 30 * time.Millisecond // FIELD
	release := make(chan struct{})
	defer close(release)
	start := time.Now()
	v, meta, err := c.loadMeta(context.Background(), "k", func(context.Context) (string, error) {
		<-release
		return "new", nil
	})
	if err != nil || v != "old" {
		t.Fatalf("got %q / %v, want old", v, err)
	}
	if meta.StaleErr == nil || meta.LastOK.IsZero() {
		t.Fatalf("stale fallback not flagged: %+v", meta)
	}
	if time.Since(start) > time.Second {
		t.Fatalf("waited %s", time.Since(start))
	}
}

// A failed refresh keeps the current behaviour: old value + StaleErr.
func TestSWRTooOldFailedRefreshServesOldFlagged(t *testing.T) {
	c, _ := seedOld(t)
	v, meta, _ := c.loadMeta(context.Background(), "k", func(context.Context) (string, error) {
		return "", context.DeadlineExceeded
	})
	if v != "old" || meta.StaleErr == nil {
		t.Fatalf("got %q / %v, want old flagged", v, meta.StaleErr)
	}
}

// Concurrent readers of an old entry share one refresh.
func TestSWRTooOldConcurrentReadersShareOneRefresh(t *testing.T) {
	c, _ := seedOld(t)
	var calls int32
	release := make(chan struct{})
	fetch := func(context.Context) (string, error) {
		atomic.AddInt32(&calls, 1)
		<-release
		return "new", nil
	}
	var wg sync.WaitGroup
	got := make([]string, 8)
	for i := range got {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			got[i], _, _ = c.loadMeta(context.Background(), "k", fetch)
		}(i)
	}
	time.Sleep(50 * time.Millisecond)
	close(release)
	wg.Wait()
	waitForFanoutBackground()
	if n := atomic.LoadInt32(&calls); n != 1 {
		t.Fatalf("%d fetches, want 1", n)
	}
	for i, g := range got {
		if g != "new" {
			t.Fatalf("reader %d got %q", i, g)
		}
	}
}

// After one wait times out, the next over-age read on the same entry must not
// wait again (one slow request per spoke per window).
func TestSWRSkipWaitAfterTimeout(t *testing.T) {
	c, _ := seedOld(t)
	c.staleWait = 30 * time.Millisecond
	release := make(chan struct{})
	defer close(release)
	hang := func(context.Context) (string, error) { <-release; return "new", nil }

	if v, _, _ := c.loadMeta(context.Background(), "k", hang); v != "old" {
		t.Fatalf("first read %q", v)
	}
	c.staleWait = 5 * time.Second // a second wait would blow the budget below
	start := time.Now()
	v, meta, _ := c.loadMeta(context.Background(), "k", hang)
	if v != "old" || meta.StaleErr == nil {
		t.Fatalf("second read %q / %v, want old flagged", v, meta.StaleErr)
	}
	if d := time.Since(start); d > 100*time.Millisecond {
		t.Fatalf("second read waited %s", d)
	}
}

// A successful refresh clears the mark: the next over-age read waits again.
func TestSWRSuccessfulRefreshClearsSkipWait(t *testing.T) {
	c, now := seedOld(t)
	c.staleWait = 30 * time.Millisecond
	c.maxStale = 5 * time.Second // over-age again after 10s, well inside the 30s skip window
	release := make(chan struct{})
	hang := func(context.Context) (string, error) { <-release; return "new", nil }
	c.loadMeta(context.Background(), "k", hang) // times out, mark set
	close(release)                              // refresh lands, mark cleared
	waitForFanoutBackground()

	*now = now.Add(10 * time.Second) // under skipWait: only the reset can make this read wait
	release2 := make(chan struct{})
	defer close(release2)
	done := make(chan struct{})
	go func() {
		c.loadMeta(context.Background(), "k", func(context.Context) (string, error) { <-release2; return "newer", nil })
		close(done)
	}()
	select {
	case <-done:
		t.Fatal("read after a successful refresh did not wait")
	case <-time.After(10 * time.Millisecond):
	}
}

// A refresh that FAILS fast must still open the skip window: the next over-age
// read serves the old payload at once instead of waiting again.
func TestSWRSkipWaitAfterFailedRefresh(t *testing.T) {
	c, now := seedOld(t)
	fail := func(context.Context) (string, error) { return "", context.DeadlineExceeded }
	if v, meta, _ := c.loadMeta(context.Background(), "k", fail); v != "old" || meta.StaleErr == nil {
		t.Fatalf("first read %q / %v, want old flagged", v, meta.StaleErr)
	}
	waitForFanoutBackground()
	*now = now.Add(15 * time.Second) // past ttl, inside the 30s skip window
	c.staleWait = 5 * time.Second    // a second wait would blow the budget below
	release := make(chan struct{})
	defer close(release)
	start := time.Now()
	v, meta, _ := c.loadMeta(context.Background(), "k", func(context.Context) (string, error) { <-release; return "new", nil })
	if v != "old" || meta.StaleErr == nil {
		t.Fatalf("second read %q / %v, want old flagged", v, meta.StaleErr)
	}
	if d := time.Since(start); d > 100*time.Millisecond {
		t.Fatalf("second read waited %s after a failed refresh", d)
	}
}

// A cluster name never goes out of date: the name cache is exempt from the
// max-staleness wait, so an old name is served at once.
func TestSpokeNameCacheNeverWaitsForRefresh(t *testing.T) {
	const key = "https://name-cache-exemption.test"
	now := time.Now()
	oldNow := spokeNameCache.now
	spokeNameCache.now = func() time.Time { return now }
	defer func() {
		waitForFanoutBackground()
		spokeNameCache.mu.Lock()
		delete(spokeNameCache.m, key)
		spokeNameCache.now = oldNow
		spokeNameCache.mu.Unlock()
	}()
	if _, err := spokeNameCache.load(context.Background(), key, func(context.Context) (string, error) { return "east", nil }); err != nil {
		t.Fatalf("seed: %v", err)
	}
	now = now.Add(16 * time.Minute)
	release := make(chan struct{})
	defer close(release)
	start := time.Now()
	v, meta, _ := spokeNameCache.loadMeta(context.Background(), key, func(context.Context) (string, error) { <-release; return "west", nil })
	if v != "east" || meta.StaleErr != nil {
		t.Fatalf("got %q / %v, want east served unflagged", v, meta.StaleErr)
	}
	if d := time.Since(start); d > 100*time.Millisecond {
		t.Fatalf("name read waited %s", d)
	}
}
