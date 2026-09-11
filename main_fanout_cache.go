package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sync"
	"time"
)

// Stale-while-revalidate caching for hub→spoke fan-out.
//
// PERF-2026-09-10, the second half of the fix the breaker starts (see
// main_fanout_breaker.go). The breaker stops a DEAD spoke from costing a
// request anything. This file stops a LIVE spoke from doing so: before this,
// every /api/rollouts re-fetched every spoke's full rollout payload
// synchronously, so the hub's own 123ms cache-backed read was gated behind a
// cross-cluster HTTP round trip that no one had asked to be fresh.
//
// The contract is the usual stale-while-revalidate one:
//
//   - fresh entry (younger than ttl): served from memory, no HTTP at all.
//   - stale entry: served from memory IMMEDIATELY and a refresh is kicked
//     off in the background, so the request never waits on the network and
//     the next one gets fresh data.
//   - cold (nothing cached): waits at most coldGrace for the in-flight
//     fetch, then gives up and lets the caller proceed without this spoke.
//     The fetch is NOT cancelled — it keeps running and populates the cache,
//     so a first page load that misses the window still warms things for the
//     request right behind it.
//
// The cold grace window exists because "serve local data instantly" is only
// half a feature: a hub that answers in 120ms with the spokes' rollouts
// silently missing has not served the page, it has served a wrong page, and
// the items would pop in later. A bounded wait keeps the common cold-start
// case complete while capping the worst case at coldGrace instead of the
// full HTTP timeout.
//
// # Why the payload cache is keyed per identity
//
// A spoke applies the CALLER'S OWN RBAC to what it returns — fetchSpoke
// forwards the user's bearer token, and the spoke's /api/rollouts trims its
// response to the namespaces that token may list rollouts in (main.go's
// AllowedNamespaces). A spoke payload is therefore user-specific data, and
// caching one user's under a shared key would serve it to the next user and
// silently defeat that whole boundary. So spokeDataCache is keyed by
// identity+URL, where identity is a hash of the bearer token — the exact
// input that determines what the spoke will return.
//
// Cluster NAMES are not user-specific (GET /api/cluster returns the same
// string to everyone), so spokeNameCache is keyed by URL alone and shared,
// like the breaker.
//
// # Tokens are never stored
//
// A refresh takes the token as a closure argument from whichever request
// triggered it, and that closure dies with the goroutine. Nothing here keeps
// a credential past the fetch it was needed for, which is also why refreshes
// are demand-triggered rather than run from a background ticker.

const (
	// spokeDataTTL is how long a spoke's rollout payload is served without
	// re-fetching. The SSE stream (pkg/kubernetes/multistream.go) already
	// pushes a spoke's real changes to the browser, which invalidates the
	// rollouts query and re-requests — so this TTL is a staleness floor for
	// quiet spokes, not the mechanism by which changes are noticed.
	spokeDataTTL = 10 * time.Second

	// spokeNameTTL can be long: a cluster's name effectively never changes.
	spokeNameTTL = 10 * time.Minute

	// spokeColdGrace bounds how long a request with nothing cached waits.
	spokeColdGrace = 1500 * time.Millisecond

	// spokeRefreshTimeout bounds a background refresh. Longer than the
	// grace window on purpose — the request already gave up on it, and a
	// slow-but-working spoke should still land in the cache for next time.
	spokeRefreshTimeout = 8 * time.Second

	// swrMaxEntries caps the payload cache so a stream of distinct tokens
	// cannot grow it without bound.
	swrMaxEntries = 512
)

// errSpokeColdTimeout means nothing was cached and the fetch did not finish
// inside coldGrace. The fetch is still running; this request just proceeds
// without the spoke.
// fanoutBackgroundWG tracks the refreshes and cache warms that deliberately
// outlive the request that started them. Production never waits on it —
// nothing there needs to — but a test that swaps the package-level caches
// does, so a finished test cannot leave a goroutine reading globals it is
// about to restore. Add() is always called before the `go`, never inside it.
var fanoutBackgroundWG sync.WaitGroup

// waitForFanoutBackground blocks until every tracked background fetch has
// finished. Test-only.
func waitForFanoutBackground() { fanoutBackgroundWG.Wait() }

var errSpokeColdTimeout = errors.New("spoke fetch exceeded cold-start grace window; serving without it")

// identityKey hashes a bearer token into a stable cache-key component. Same
// construction as eventStreamIdentity (main_events_cap.go) and for the same
// reason: the token itself must not be used as a map key that might end up
// in a log line or a dump. The empty token maps to a fixed key, which is
// correct — every tokenless caller gets the same unfiltered spoke response.
func identityKey(token string) string {
	if token == "" {
		return "anon"
	}
	sum := sha256.Sum256([]byte("token:" + token))
	return hex.EncodeToString(sum[:])
}

type swrEntry[T any] struct {
	val        T
	ok         bool // a value has been fetched at least once
	err        error
	fetchedAt  time.Time
	lastAccess time.Time
	done       chan struct{} // non-nil while a refresh is in flight
}

// swrCache is a small stale-while-revalidate cache with per-key
// single-flight. Zero background goroutines of its own — refreshes are
// started by whichever request found the entry stale.
type swrCache[T any] struct {
	mu  sync.Mutex
	m   map[string]*swrEntry[T]
	now func() time.Time

	ttl            time.Duration
	coldGrace      time.Duration
	refreshTimeout time.Duration
}

func newSWRCache[T any](ttl, coldGrace, refreshTimeout time.Duration) *swrCache[T] {
	return &swrCache[T]{
		m:              map[string]*swrEntry[T]{},
		now:            time.Now,
		ttl:            ttl,
		coldGrace:      coldGrace,
		refreshTimeout: refreshTimeout,
	}
}

// get returns the cached value for key without ever fetching. Used by
// callers that must not block at all (the SSE handler's spoke discovery).
func (c *swrCache[T]) get(key string) (T, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e := c.m[key]
	if e == nil || !e.ok {
		var zero T
		return zero, false
	}
	e.lastAccess = c.now()
	return e.val, true
}

// load returns the value for key, fetching only as much as the SWR contract
// above requires. ctx bounds only the caller's own wait — a refresh it
// starts runs on its own context and outlives a cancelled request.
func (c *swrCache[T]) load(ctx context.Context, key string, fetch func(context.Context) (T, error)) (T, error) {
	c.mu.Lock()
	now := c.now()
	e := c.m[key]
	if e == nil {
		e = &swrEntry[T]{}
		c.m[key] = e
		c.evictLocked()
	}
	e.lastAccess = now

	if e.ok && now.Sub(e.fetchedAt) < c.ttl {
		val := e.val
		c.mu.Unlock()
		return val, nil
	}

	if e.done == nil {
		e.done = make(chan struct{})
		fanoutBackgroundWG.Add(1)
		go func() {
			defer fanoutBackgroundWG.Done()
			c.refresh(key, fetch)
		}()
	}
	done := e.done
	staleVal, haveStale, lastErr := e.val, e.ok, e.err
	c.mu.Unlock()

	// Stale-but-usable: return now, let the refresh land for next time.
	if haveStale {
		return staleVal, nil
	}

	// Cold. Wait, but only briefly.
	var timer <-chan time.Time
	if c.coldGrace > 0 {
		t := time.NewTimer(c.coldGrace)
		defer t.Stop()
		timer = t.C
	}
	select {
	case <-done:
		c.mu.Lock()
		e := c.m[key]
		if e != nil && e.ok {
			val := e.val
			c.mu.Unlock()
			return val, nil
		}
		var err error
		if e != nil {
			err = e.err
		}
		c.mu.Unlock()
		var zero T
		if err == nil {
			err = lastErr
		}
		return zero, err
	case <-timer:
		var zero T
		return zero, errSpokeColdTimeout
	case <-ctx.Done():
		var zero T
		return zero, ctx.Err()
	}
}

// refresh runs one fetch for key and publishes the result. Deliberately on
// context.Background() (bounded by refreshTimeout) rather than the
// triggering request's context: the whole point is that the result survives
// a request that has already returned.
func (c *swrCache[T]) refresh(key string, fetch func(context.Context) (T, error)) {
	ctx, cancel := context.WithTimeout(context.Background(), c.refreshTimeout)
	defer cancel()

	val, err := fetch(ctx)

	c.mu.Lock()
	e := c.m[key]
	if e == nil {
		e = &swrEntry[T]{}
		c.m[key] = e
	}
	if err == nil {
		e.val = val
		e.ok = true
		e.err = nil
	} else {
		e.err = err
		// A failed refresh deliberately leaves any previous value in place
		// and marks it fresh-enough to stop a hot loop of retries: the
		// breaker decides when to try the network again, not this cache.
	}
	e.fetchedAt = c.now()
	done := e.done
	e.done = nil
	c.mu.Unlock()

	if done != nil {
		close(done)
	}
}

// evictLocked drops entries nothing has touched recently once the map grows
// past swrMaxEntries. Called with c.mu held.
func (c *swrCache[T]) evictLocked() {
	if len(c.m) <= swrMaxEntries {
		return
	}
	cutoff := c.now().Add(-4 * c.ttl)
	for k, e := range c.m {
		if e.done == nil && e.lastAccess.Before(cutoff) {
			delete(c.m, k)
		}
	}
}

// spokeDataCache holds spoke /api/rollouts payloads, keyed
// identity|url — see the per-identity note above.
var spokeDataCache = newSWRCache[map[string]json.RawMessage](spokeDataTTL, spokeColdGrace, spokeRefreshTimeout)

// spokeNameCache holds spoke cluster names, keyed by url alone.
var spokeNameCache = newSWRCache[string](spokeNameTTL, spokeColdGrace, spokeRefreshTimeout)
