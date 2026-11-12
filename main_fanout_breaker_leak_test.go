package main

import (
	"errors"
	"testing"
	"time"
)

// one leaked probe (allow without success/failure) against a dead spoke.
// Every later probe fails after 2s. The breaker must re-open with a cooldown,
// not keep admitting a probe every breakerProbeTimeout forever.
func TestBreakerLeakedProbeStillReopens(t *testing.T) {
	now := time.Now()
	b := newTestBreakers(func() time.Time { return now })
	const u = "https://spoke"
	for i := 0; i < breakerThreshold; i++ {
		b.failure(u, errors.New("timeout"))
	}
	now = b.m[u].openUntil.Add(time.Second)
	if ok, _ := b.allow(u); !ok { // leaked probe
		t.Fatal("probe not admitted")
	}
	admitted := 0
	for i := 0; i < 120; i++ { // 60s, a call every 500ms
		now = now.Add(500 * time.Millisecond)
		if ok, _ := b.allow(u); ok {
			admitted++
			now = now.Add(2 * time.Second)
			b.failure(u, errors.New("timeout"))
		}
	}
	t.Logf("probes admitted against dead spoke in 60s: %d, open=%v", admitted, b.isOpen(u))
	if admitted > 3 {
		t.Fatalf("breaker kept probing a dead spoke: %d probes in 60s", admitted)
	}
}
