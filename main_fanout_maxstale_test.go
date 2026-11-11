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
