package main

import (
	"context"
	"testing"
	"time"
)

// A skip mark lasts skipWait and no longer: once it has passed, an over-age
// read waits for the refresh again.
func TestSkipWindowExpires(t *testing.T) {
	c, now := seedOld(t)
	c.staleWait = 30 * time.Millisecond
	c.maxStale = time.Second
	release := make(chan struct{})
	defer close(release)
	hang := func(context.Context) (string, error) { <-release; return "new", nil }
	c.loadMeta(context.Background(), "k", hang) // times out, mark set

	*now = now.Add(c.skipWait + time.Second) // window over, entry over-age again
	start := time.Now()
	c.loadMeta(context.Background(), "k", hang)
	if d := time.Since(start); d < 25*time.Millisecond {
		t.Fatalf("read after the window did not wait (%s): the skip never expires", d)
	}
}
