package main

import (
	"context"
	"testing"
	"time"
)

// A rejection (HTTP 401/403) is about one caller's identity, not about the
// spoke: it must not set the shared skip window, or every other identity would
// be told the spoke is slow without waiting for its own answer.
func TestRejectionDoesNotSetSharedSkip(t *testing.T) {
	c, now := seedOld(t)
	seedAt := now.Add(-16 * time.Minute)
	c.now = func() time.Time { return seedAt }
	spoke := "https://spoke.example"
	for _, id := range []string{"alice", "bob"} {
		if _, err := c.load(context.Background(), id+"|"+spoke, func(context.Context) (string, error) { return "old-" + id, nil }); err != nil {
			t.Fatal(err)
		}
	}
	c.now = func() time.Time { return *now }
	c.staleWait = 2 * time.Second

	_, meta, _ := c.loadMeta(context.Background(), "bob|"+spoke, func(context.Context) (string, error) { return "", &spokeStatusError{status: 403} })
	if meta.StaleErr == nil {
		t.Fatal("bob's rejection was not reported")
	}
	fast := func(context.Context) (string, error) { time.Sleep(20 * time.Millisecond); return "new-alice", nil }
	v, meta, _ := c.loadMeta(context.Background(), "alice|"+spoke, fast)
	if v != "new-alice" {
		t.Fatalf("alice got %q (flagged %v) although the spoke answers her: bob's rejection set the shared skip", v, meta.StaleErr)
	}
}
