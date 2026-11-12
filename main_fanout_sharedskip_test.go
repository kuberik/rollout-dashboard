package main

import (
	"context"
	"testing"
	"time"
)

// Whether a spoke is slow is a fact about the spoke: after one identity paid
// the stale wait, another identity (and another endpoint cache) reading the
// same spoke inside the window must get its flagged stale value at once.
func TestSlowSpokeSkipIsSharedAcrossIdentities(t *testing.T) {
	c, now := seedOld(t) // resets the shared skip registry
	// seed a second identity's entry, equally old, on the same spoke.
	seedAt := now.Add(-16 * time.Minute)
	c.now = func() time.Time { return seedAt }
	spoke := "https://spoke.example"
	for _, id := range []string{"alice", "bob"} {
		if _, err := c.load(context.Background(), id+"|"+spoke, func(context.Context) (string, error) { return "old-" + id, nil }); err != nil {
			t.Fatal(err)
		}
	}
	c.now = func() time.Time { return *now }
	c.staleWait = 30 * time.Millisecond
	release := make(chan struct{})
	defer close(release)
	hang := func(context.Context) (string, error) { <-release; return "new", nil }

	if v, _, _ := c.loadMeta(context.Background(), "alice|"+spoke, hang); v != "old-alice" {
		t.Fatalf("alice read %q", v)
	}
	c.staleWait = 5 * time.Second // a second wait would blow the budget below
	start := time.Now()
	v, meta, _ := c.loadMeta(context.Background(), "bob|"+spoke, hang)
	if v != "old-bob" || meta.StaleErr == nil {
		t.Fatalf("bob read %q / %v, want his own old data flagged stale", v, meta.StaleErr)
	}
	if d := time.Since(start); d > 100*time.Millisecond {
		t.Fatalf("second identity waited %s on a spoke already known slow", d)
	}
}
