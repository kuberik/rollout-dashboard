package main

import (
	"fmt"
	"sync"
	"time"
)

// Per-spoke circuit breaker for hub→spoke HTTP.
//
// PERF-2026-09-10: a spoke whose dashboard URL resolves but never answers —
// its ingress up and reachable from outside, its route from inside the hub
// cluster black-holed — used to cost every hub request the FULL fetchSpoke
// timeout, on every request, for every user: 10s on /api/rollouts and 5s on
// /api/clusters, measured as a 20s TTFB on the dashboard's own landing page
// while the hub's local informer-cached reads took 123ms. Nothing anywhere
// remembered that the previous request had just timed out against the same
// host.
//
// This breaker is the memory. It is keyed by spoke base URL and shared
// process-wide, deliberately NOT per user: whether a host answers TCP is a
// property of the network, not of who is asking, so the first user to
// discover a spoke is down spares every other user the same wait. (The
// spoke's response BODY is per-user — see main_fanout_cache.go, which caches
// that separately and per-identity. Only reachability is shared here.)
//
// States, standard three-state breaker:
//
//   - closed: calls go through. Consecutive failures are counted.
//   - open: calls are refused instantly with the last error, until
//     openUntil. Cooldown doubles per consecutive failed probe
//     (breakerBaseCooldown → breakerMaxCooldown) so a long-dead spoke is
//     retried rarely, while a brief blip recovers fast.
//   - half-open: the first caller after openUntil is let through as a probe
//     and marked probing so concurrent callers keep being refused instantly
//     rather than all stampeding a host that is probably still down. Success
//     closes the breaker and resets the cooldown; failure re-opens it.
//
// A single success anywhere resets the failure count — spokes flap, and a
// spoke that answers is healthy regardless of what it did a minute ago.
const (
	// breakerThreshold is how many consecutive failures open the breaker.
	// Two, not one: a single dropped connection or a pod restarting mid-
	// rollout is normal and should not blind the hub to a live spoke for
	// a whole cooldown.
	breakerThreshold = 2

	breakerBaseCooldown = 15 * time.Second
	breakerMaxCooldown  = 5 * time.Minute
)

// errSpokeCircuitOpen is what a refused call returns. It wraps the last real
// error so the /api/rollouts clusterErrors entry still tells an operator WHY
// the spoke is considered down, not merely that it is being skipped.
type errSpokeCircuitOpen struct {
	lastErr error
	until   time.Time
}

func (e *errSpokeCircuitOpen) Error() string {
	return fmt.Sprintf("circuit open for %s (last error: %v)",
		time.Until(e.until).Round(time.Second), e.lastErr)
}

func (e *errSpokeCircuitOpen) Unwrap() error { return e.lastErr }

type breakerEntry struct {
	failures  int
	openUntil time.Time
	probing   bool
	lastErr   error
}

type spokeBreakers struct {
	mu  sync.Mutex
	m   map[string]*breakerEntry
	now func() time.Time // swappable for tests
}

var breakers = newSpokeBreakers()

func newSpokeBreakers() *spokeBreakers {
	return &spokeBreakers{m: map[string]*breakerEntry{}, now: time.Now}
}

// allow reports whether a call to spokeURL may proceed. When it returns
// false, err is the reason to report for this spoke — the caller must not
// make the HTTP call. When it returns true the caller MUST eventually call
// exactly one of success/failure for that URL, or a half-open probe stays
// marked probing and the breaker never re-closes.
func (b *spokeBreakers) allow(spokeURL string) (bool, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	e := b.m[spokeURL]
	if e == nil || e.openUntil.IsZero() {
		return true, nil
	}
	now := b.now()
	if now.Before(e.openUntil) {
		return false, &errSpokeCircuitOpen{lastErr: e.lastErr, until: e.openUntil}
	}
	// Cooldown elapsed — half-open. Exactly one probe at a time.
	if e.probing {
		return false, &errSpokeCircuitOpen{lastErr: e.lastErr, until: e.openUntil}
	}
	e.probing = true
	return true, nil
}

// success closes the breaker for spokeURL and forgets its failure history.
func (b *spokeBreakers) success(spokeURL string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.m, spokeURL)
}

// failure records a failed call, opening the breaker once breakerThreshold
// consecutive failures have accumulated.
func (b *spokeBreakers) failure(spokeURL string, err error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	e := b.m[spokeURL]
	if e == nil {
		e = &breakerEntry{}
		b.m[spokeURL] = e
	}
	e.probing = false
	e.failures++
	e.lastErr = err
	if e.failures < breakerThreshold {
		return
	}
	// Cooldown doubles for each failure past the threshold.
	cooldown := breakerBaseCooldown << (e.failures - breakerThreshold)
	if cooldown > breakerMaxCooldown || cooldown <= 0 {
		cooldown = breakerMaxCooldown
	}
	e.openUntil = b.now().Add(cooldown)
}

// isOpen reports whether spokeURL is currently being skipped. Read-only —
// unlike allow it never claims a half-open probe, so callers that only want
// to know the state (logging, tests) cannot accidentally consume one.
func (b *spokeBreakers) isOpen(spokeURL string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	e := b.m[spokeURL]
	return e != nil && !e.openUntil.IsZero() && b.now().Before(e.openUntil)
}

// spokeTransportError marks a failure where the hub never got an HTTP
// response at all — connection refused, DNS failure, TLS error, or the
// client timeout elapsing. Only these count against a spoke's breaker; see
// recordSpokeOutcome in main_fanout.go for why.
type spokeTransportError struct{ err error }

func (e *spokeTransportError) Error() string { return e.err.Error() }
func (e *spokeTransportError) Unwrap() error { return e.err }
