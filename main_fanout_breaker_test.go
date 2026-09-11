package main

import (
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

func newTestBreakers(now func() time.Time) *spokeBreakers {
	b := newSpokeBreakers()
	b.now = now
	return b
}

// A single failure must NOT open the breaker — a spoke pod restarting
// mid-rollout drops one connection and is healthy a moment later.
func TestBreakerStaysClosedBelowThreshold(t *testing.T) {
	b := newTestBreakers(time.Now)
	b.failure("https://spoke", errors.New("boom"))

	if b.isOpen("https://spoke") {
		t.Fatal("breaker opened after a single failure; threshold is 2")
	}
	if ok, _ := b.allow("https://spoke"); !ok {
		t.Fatal("allow() refused a call while the breaker should still be closed")
	}
}

func TestBreakerOpensAtThresholdAndRefusesInstantly(t *testing.T) {
	b := newTestBreakers(time.Now)
	for i := 0; i < breakerThreshold; i++ {
		b.failure("https://spoke", errors.New("i/o timeout"))
	}

	if !b.isOpen("https://spoke") {
		t.Fatal("breaker did not open at the failure threshold")
	}
	ok, err := b.allow("https://spoke")
	if ok {
		t.Fatal("allow() let a call through while the breaker was open")
	}
	// The reason must survive to the operator, not just "skipped".
	var open *errSpokeCircuitOpen
	if !errors.As(err, &open) {
		t.Fatalf("expected *errSpokeCircuitOpen, got %T", err)
	}
	if open.lastErr == nil || open.lastErr.Error() != "i/o timeout" {
		t.Fatalf("open circuit lost the underlying cause: %v", open.lastErr)
	}
}

// The whole point of the fix: an open breaker must be a memory read, not a
// timeout. Guards against a regression that reintroduces the network call.
func TestBreakerOpenRefusalIsImmediate(t *testing.T) {
	b := newTestBreakers(time.Now)
	for i := 0; i < breakerThreshold; i++ {
		b.failure("https://spoke", errors.New("timeout"))
	}

	start := time.Now()
	for i := 0; i < 1000; i++ {
		if ok, _ := b.allow("https://spoke"); ok {
			t.Fatal("allow() let a call through while open")
		}
	}
	if elapsed := time.Since(start); elapsed > 100*time.Millisecond {
		t.Fatalf("1000 refusals took %v; an open breaker must not do work", elapsed)
	}
}

// After the cooldown exactly ONE caller may probe; the rest keep being
// refused rather than stampeding a host that is probably still down.
func TestBreakerHalfOpenAdmitsOneProbe(t *testing.T) {
	now := time.Now()
	b := newTestBreakers(func() time.Time { return now })
	for i := 0; i < breakerThreshold; i++ {
		b.failure("https://spoke", errors.New("timeout"))
	}

	now = now.Add(breakerBaseCooldown + time.Second)

	admitted := 0
	for i := 0; i < 10; i++ {
		if ok, _ := b.allow("https://spoke"); ok {
			admitted++
		}
	}
	if admitted != 1 {
		t.Fatalf("half-open admitted %d probes, want exactly 1", admitted)
	}
}

func TestBreakerProbeSuccessCloses(t *testing.T) {
	now := time.Now()
	b := newTestBreakers(func() time.Time { return now })
	for i := 0; i < breakerThreshold; i++ {
		b.failure("https://spoke", errors.New("timeout"))
	}
	now = now.Add(breakerBaseCooldown + time.Second)

	ok, _ := b.allow("https://spoke")
	if !ok {
		t.Fatal("half-open did not admit a probe")
	}
	b.success("https://spoke")

	if b.isOpen("https://spoke") {
		t.Fatal("breaker stayed open after a successful probe")
	}
	if ok, _ := b.allow("https://spoke"); !ok {
		t.Fatal("breaker refused a call after recovery")
	}
}

// A failed probe must re-open with a LONGER cooldown, so a long-dead spoke
// is retried rarely instead of once per cooldown forever.
func TestBreakerCooldownBacksOff(t *testing.T) {
	now := time.Now()
	b := newTestBreakers(func() time.Time { return now })

	for i := 0; i < breakerThreshold; i++ {
		b.failure("https://spoke", errors.New("timeout"))
	}
	first := b.m["https://spoke"].openUntil.Sub(now)

	now = now.Add(first + time.Second)
	b.allow("https://spoke")
	b.failure("https://spoke", errors.New("timeout"))
	second := b.m["https://spoke"].openUntil.Sub(now)

	if second <= first {
		t.Fatalf("cooldown did not grow after a failed probe: %v then %v", first, second)
	}
}

func TestBreakerCooldownIsCapped(t *testing.T) {
	b := newTestBreakers(time.Now)
	for i := 0; i < 40; i++ {
		b.failure("https://spoke", errors.New("timeout"))
	}
	got := time.Until(b.m["https://spoke"].openUntil)
	if got > breakerMaxCooldown+time.Second {
		t.Fatalf("cooldown %v exceeded the %v cap (shift overflow?)", got, breakerMaxCooldown)
	}
	if got <= 0 {
		t.Fatalf("cooldown collapsed to %v after many failures", got)
	}
}

func TestBreakerIsPerSpoke(t *testing.T) {
	b := newTestBreakers(time.Now)
	for i := 0; i < breakerThreshold; i++ {
		b.failure("https://dead", errors.New("timeout"))
	}
	if ok, _ := b.allow("https://alive"); !ok {
		t.Fatal("one dead spoke opened another spoke's breaker")
	}
}

func TestBreakerConcurrentUseIsRaceFree(t *testing.T) {
	b := newTestBreakers(time.Now)
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			url := fmt.Sprintf("https://spoke-%d", i%3)
			if ok, _ := b.allow(url); ok {
				if i%2 == 0 {
					b.failure(url, errors.New("timeout"))
				} else {
					b.success(url)
				}
			}
			b.isOpen(url)
		}(i)
	}
	wg.Wait()
}

// The breaker is process-wide, so it must only ever record failures that are
// process-wide facts. An HTTP response — including the SSO login page an
// unauthenticated leg gets back — means the host is UP; counting it would let
// one tokenless request cut every authenticated user off from a live spoke.
func TestOnlyTransportErrorsTripTheBreaker(t *testing.T) {
	prev := breakers
	breakers = newTestBreakers(time.Now)
	defer func() { breakers = prev }()

	for i := 0; i < breakerThreshold+2; i++ {
		recordSpokeOutcome("https://spoke", fmt.Errorf("HTTP 403"))
		recordSpokeOutcome("https://spoke", fmt.Errorf("decode: invalid character '<'"))
	}
	if breakers.isOpen("https://spoke") {
		t.Fatal("HTTP-level failures opened the breaker; only transport failures may")
	}

	for i := 0; i < breakerThreshold; i++ {
		recordSpokeOutcome("https://spoke", &spokeTransportError{err: errors.New("i/o timeout")})
	}
	if !breakers.isOpen("https://spoke") {
		t.Fatal("transport failures did not open the breaker")
	}

	recordSpokeOutcome("https://spoke", nil)
	if breakers.isOpen("https://spoke") {
		t.Fatal("a success did not close the breaker")
	}
}
