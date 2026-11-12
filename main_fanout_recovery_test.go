package main

import (
	"context"
	"net"
	"sync"
	"testing"
	"time"
)

// timeoutNetErr is a transport timeout, the shape a SIGSTOPped spoke produces.
type timeoutNetErr struct{}

func (timeoutNetErr) Error() string   { return "Client.Timeout exceeded while awaiting headers" }
func (timeoutNetErr) Timeout() bool   { return true }
func (timeoutNetErr) Temporary() bool { return true }

var _ net.Error = timeoutNetErr{}

// A spoke that was unreachable for 56s and answers again must stop being
// reported within breakerMaxCooldown plus one refresh interval (spokeDataTTL)
// of resuming. The rollouts and health-checks caches read it through the one
// shared breaker, on a fake clock; each failed call costs spokeFetchTimeout.
// Live on bd5195ec the flag stayed ~46s after SIGCONT.
func TestRecoveredSpokeClearsWithinCooldownPlusOneRefresh(t *testing.T) {
	spokeSkips.set("alice|https://spoke.example", time.Time{}) // no skip window left by another test
	prev := breakers
	breakers = newSpokeBreakers()
	t.Cleanup(func() { waitForFanoutBackground(); breakers = prev })

	clock := time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC)
	var mu sync.Mutex // refreshes run on their own goroutines
	now := func() time.Time { mu.Lock(); defer mu.Unlock(); return clock }
	advance := func(d time.Duration) { mu.Lock(); clock = clock.Add(d); mu.Unlock() }
	breakers.now = now
	rollouts := newSWRCache[string](spokeDataTTL, spokeColdGrace, spokeRefreshTimeout)
	health := newSWRCache[string](spokeDataTTL, spokeColdGrace, spokeRefreshTimeout)
	for _, c := range []*swrCache[string]{rollouts, health} {
		c.now = now
		c.staleWait = 50 * time.Millisecond // real-time bound on the stale wait
	}

	const spoke = "https://spoke.example"
	key := "alice|" + spoke
	down := false
	fetch := func(context.Context) (string, error) {
		if ok, err := breakers.allow(spoke); !ok {
			return "", err
		}
		var err error
		if down {
			advance(spokeFetchTimeout) // the hang costs its client timeout
			err = &spokeTransportError{err: timeoutNetErr{}}
		}
		recordSpokeOutcome(spoke, err)
		if err != nil {
			return "", err
		}
		return "ok", nil
	}
	read := func() swrMeta {
		_, meta, _ := rollouts.loadMeta(context.Background(), key, fetch)
		health.loadMeta(context.Background(), key, fetch)
		waitForFanoutBackground()
		return meta
	}

	read() // warm, healthy
	down = true
	for el := time.Duration(0); el < 56*time.Second; el += 5 * time.Second {
		advance(5 * time.Second)
		read()
	}
	down = false
	resumed := now()
	cleared := time.Duration(-1)
	for el := time.Duration(0); el <= 90*time.Second; el += time.Second {
		advance(time.Second)
		if read().StaleErr == nil {
			cleared = now().Sub(resumed)
			break
		}
	}
	t.Logf("cleared %s after the spoke resumed", cleared)
	if limit := breakerMaxCooldown + spokeDataTTL; cleared < 0 || cleared > limit {
		t.Fatalf("recovered spoke still reported %s after it resumed; want within %s (breakerMaxCooldown + spokeDataTTL)", cleared, limit)
	}
}
