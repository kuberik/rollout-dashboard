package main

import (
	"errors"
	"sync"
	"testing"
	"time"
)

// Several caches (rollouts, health-checks, names) read one spoke through one
// breaker. However many of them fail inside one probe round, the round counts
// once: the cooldown doubles per round, not per caller.
func TestBreakerCountsOneFailurePerProbeRound(t *testing.T) {
	b := newSpokeBreakers()
	clock := time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC)
	b.now = func() time.Time { return clock }
	const spoke = "https://spoke.example"
	boom := &spokeTransportError{err: errors.New("hang")}

	b.failure(spoke, boom)
	b.failure(spoke, boom) // threshold: opens
	if !b.isOpen(spoke) {
		t.Fatal("breaker should be open after the threshold")
	}
	failures := func() int { b.mu.Lock(); defer b.mu.Unlock(); return b.m[spoke].failures }

	// Failures landing while it is open (calls admitted before it opened).
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); b.failure(spoke, boom) }()
	}
	wg.Wait()
	if got := failures(); got != breakerThreshold {
		t.Fatalf("failures while open = %d, want %d (no growth)", got, breakerThreshold)
	}

	// Cooldown elapsed: one probe is admitted; it and N duplicates fail together.
	clock = clock.Add(breakerBaseCooldown + time.Second)
	if ok, _ := b.allow(spoke); !ok {
		t.Fatal("probe not admitted after cooldown")
	}
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); b.failure(spoke, boom) }()
	}
	wg.Wait()
	if got := failures(); got != breakerThreshold+1 {
		t.Fatalf("failures after one probe round = %d, want exactly %d", got, breakerThreshold+1)
	}
}
