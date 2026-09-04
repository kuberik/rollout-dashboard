package kubernetes

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"runtime"
	"testing"
	"time"
)

// newGatedSSESpoke returns an httptest server that behaves like this
// binary's own GET /api/events/stream: it blocks on gate before writing
// anything (so a test can control exactly when the "connection" succeeds),
// then writes the same preamble bytes main.go writes, then one "changes"
// event per entry in events, then blocks until the client disconnects. Every
// changes payload is sent pre-tagged with a cluster name, exactly as a real
// spoke's own handler would send it (RunMultiStream must NOT re-tag or
// re-filter it).
func newGatedSSESpoke(t *testing.T, gate <-chan struct{}, events []string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if gate != nil {
			select {
			case <-gate:
			case <-r.Context().Done():
				return
			}
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatalf("ResponseWriter does not support flushing")
		}
		fmt.Fprint(w, "retry: 5000\n: connected\n\n")
		flusher.Flush()
		for _, data := range events {
			fmt.Fprintf(w, "event: changes\ndata: %s\n\n", data)
			flusher.Flush()
		}
		<-r.Context().Done()
	}))
}

// alwaysFailSpoke returns an httptest server whose every request is
// answered 500 immediately — simulates a spoke that is simply unreachable
// or erroring, never a live SSE connection.
func alwaysFailSpoke(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
}

func waitForValue[T any](t *testing.T, ch <-chan T, timeout time.Duration) T {
	t.Helper()
	select {
	case v := <-ch:
		return v
	case <-time.After(timeout):
		t.Fatalf("timed out after %s waiting for a value", timeout)
		var zero T
		return zero
	}
}

func TestRunMultiStream_MergesAndTagsLocalAndSpokeEvents(t *testing.T) {
	gate := make(chan struct{})
	spoke := newGatedSSESpoke(t, gate, []string{
		`[{"type":"add","kind":"Rollout","namespace":"team-a","name":"spoke-app","cluster":"dev","resourceVersion":"9"}]`,
	})
	defer spoke.Close()
	close(gate) // let it connect immediately — this test isn't about timing

	hub := NewEventHub(5 * time.Millisecond)
	defer hub.Stop()

	changesCh := make(chan []ChangeEvent, 10)
	clustersCh := make(chan map[string]bool, 10)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go RunMultiStream(ctx, MultiStreamOptions{
		LocalHub:   hub,
		LocalName:  "prod",
		Spokes:     []ClusterSpec{{Name: "dev", URL: spoke.URL}},
		HTTPClient: spoke.Client(),
	}, MultiStreamHandlers{
		OnChanges:  func(e []ChangeEvent) { changesCh <- e },
		OnClusters: func(m map[string]bool) { clustersCh <- m },
	})

	// Initial snapshot, sent before Run's select loop starts.
	initial := waitForValue(t, clustersCh, time.Second)
	if !initial["prod"] {
		t.Fatalf("expected local cluster prod to start connected, got %+v", initial)
	}

	// The spoke flips to connected shortly after (async goroutine).
	waitForClusterState(t, clustersCh, "dev", true, 2*time.Second)

	// Publish a LOCAL event with no Cluster set (as cache.go's publishChange
	// always does) — RunMultiStream must tag it with LocalName.
	hub.Publish(ChangeEvent{Type: "update", Kind: "Rollout", Namespace: "team-a", Name: "local-app", ResourceVersion: "1"})

	sawLocal, sawSpoke := false, false
	deadline := time.After(3 * time.Second)
	for !sawLocal || !sawSpoke {
		select {
		case batch := <-changesCh:
			for _, ev := range batch {
				switch ev.Name {
				case "local-app":
					if ev.Cluster != "prod" {
						t.Fatalf("expected local event tagged with LocalName %q, got %q", "prod", ev.Cluster)
					}
					sawLocal = true
				case "spoke-app":
					// Must be forwarded AS-IS — the spoke already tagged it.
					if ev.Cluster != "dev" {
						t.Fatalf("expected spoke event to keep its own cluster tag %q, got %q", "dev", ev.Cluster)
					}
					sawSpoke = true
				}
			}
		case <-deadline:
			t.Fatalf("timed out waiting for both local (seen=%v) and spoke (seen=%v) events", sawLocal, sawSpoke)
		}
	}
}

// waitForClusterState drains clustersCh until it observes cluster's state
// equal to want, or fails after timeout.
func waitForClusterState(t *testing.T, ch <-chan map[string]bool, cluster string, want bool, timeout time.Duration) {
	t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case m := <-ch:
			if v, ok := m[cluster]; ok && v == want {
				return
			}
		case <-deadline:
			t.Fatalf("timed out waiting for cluster %q to report connected=%v", cluster, want)
		}
	}
}

func TestRunMultiStream_ClustersEventAtConnectThenOnFlip(t *testing.T) {
	gate := make(chan struct{})
	spoke := newGatedSSESpoke(t, gate, nil)
	defer spoke.Close()

	hub := NewEventHub(5 * time.Millisecond)
	defer hub.Stop()

	clustersCh := make(chan map[string]bool, 10)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go RunMultiStream(ctx, MultiStreamOptions{
		LocalHub:   hub,
		LocalName:  "prod",
		Spokes:     []ClusterSpec{{Name: "dev", URL: spoke.URL}},
		HTTPClient: spoke.Client(),
	}, MultiStreamHandlers{
		OnClusters: func(m map[string]bool) { clustersCh <- m },
	})

	// The gate is still closed (not released) — the very first snapshot
	// must show the spoke as NOT YET connected, alongside the local
	// cluster already true.
	initial := waitForValue(t, clustersCh, time.Second)
	if initial["prod"] != true || initial["dev"] != false {
		t.Fatalf("expected initial snapshot {prod:true, dev:false}, got %+v", initial)
	}

	// Now let the spoke connection succeed — must flip to true.
	close(gate)
	waitForClusterState(t, clustersCh, "dev", true, 2*time.Second)
}

func TestRunMultiStream_SpokeFailureDoesNotBlockLocalEvents(t *testing.T) {
	spoke := alwaysFailSpoke(t)
	defer spoke.Close()

	hub := NewEventHub(5 * time.Millisecond)
	defer hub.Stop()

	changesCh := make(chan []ChangeEvent, 10)
	clustersCh := make(chan map[string]bool, 10)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go RunMultiStream(ctx, MultiStreamOptions{
		LocalHub:   hub,
		LocalName:  "prod",
		Spokes:     []ClusterSpec{{Name: "dev", URL: spoke.URL}},
		HTTPClient: spoke.Client(),
	}, MultiStreamHandlers{
		OnChanges:  func(e []ChangeEvent) { changesCh <- e },
		OnClusters: func(m map[string]bool) { clustersCh <- m },
	})

	initial := waitForValue(t, clustersCh, time.Second)
	if initial["dev"] != false {
		t.Fatalf("expected a failing spoke to start (and stay) disconnected, got %+v", initial)
	}

	// A broken spoke must never stall local delivery.
	hub.Publish(ChangeEvent{Type: "add", Kind: "Rollout", Namespace: "team-a", Name: "local-app", ResourceVersion: "1"})
	batch := waitForValue(t, changesCh, 2*time.Second)
	if len(batch) != 1 || batch[0].Name != "local-app" || batch[0].Cluster != "prod" {
		t.Fatalf("expected the local event to arrive tagged prod despite the broken spoke, got %+v", batch)
	}

	// The broken spoke must never have reported itself connected in the
	// meantime either.
	select {
	case m := <-clustersCh:
		if m["dev"] {
			t.Fatalf("a permanently-failing spoke must never report connected=true, got %+v", m)
		}
	default:
		// no further clusters events at all is also fine — no flip happened
	}
}

func TestRunMultiStream_ClientDisconnectClosesUpstreamSubscriptionsNoLeak(t *testing.T) {
	spoke := newGatedSSESpoke(t, nil, nil) // connects immediately, then blocks forever on ctx.Done()
	defer spoke.Close()

	hub := NewEventHub(5 * time.Millisecond)
	defer hub.Stop()

	runtime.GC()
	before := runtime.NumGoroutine()

	const n = 20
	for i := 0; i < n; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan struct{})
		clustersCh := make(chan map[string]bool, 10)

		go func() {
			RunMultiStream(ctx, MultiStreamOptions{
				LocalHub:   hub,
				LocalName:  "prod",
				Spokes:     []ClusterSpec{{Name: "dev", URL: spoke.URL}},
				HTTPClient: spoke.Client(),
			}, MultiStreamHandlers{
				OnClusters: func(m map[string]bool) {
					select {
					case clustersCh <- m:
					default:
					}
				},
			})
			close(done)
		}()

		// Wait for the spoke to actually connect before tearing down, so
		// each iteration genuinely exercises "close an established upstream
		// subscription", not just "cancel before it ever dialed".
		waitForClusterState(t, clustersCh, "dev", true, 2*time.Second)

		cancel()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatalf("iteration %d: RunMultiStream did not return within 2s of client disconnect", i)
		}
	}

	waitFor(t, 2*time.Second, func() bool { return hub.ClientCount() == 0 })

	runtime.GC()
	after := runtime.NumGoroutine()
	if after > before+5 {
		t.Fatalf("goroutine count grew from %d to %d after %d connect/disconnect cycles — possible leak", before, after, n)
	}
}

// TestRunMultiStream_EvictedHandlersDoNotLeakGoroutines is the goroutine-
// count assertion the 2026-09-04 incident fix calls for directly: open 20
// concurrent /api/events/stream-shaped handlers under ONE identity with a
// per-identity cap of 8 (each one owning a real spoke-subscription
// goroutine, exactly like the production handler does), and confirm (a)
// only 8 remain registered on the hub, and (b) once the 12 evicted
// handlers' RunMultiStream calls have actually returned, the goroutine
// count is back down to what 8 live handlers alone cost — proving eviction
// tears down everything an evicted request owned (its EventHub
// registration, its spoke subscription goroutine, its heartbeat ticker)
// rather than leaking any of it.
func TestRunMultiStream_EvictedHandlersDoNotLeakGoroutines(t *testing.T) {
	spoke := newGatedSSESpoke(t, nil, nil) // connects immediately, then blocks until ctx done
	defer spoke.Close()

	hub := NewEventHub(5 * time.Millisecond)
	defer hub.Stop()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	runtime.GC()
	trueBefore := runtime.NumGoroutine()

	limits := IdentityLimits{MaxPerClient: 8}

	// startHandler mirrors main.go's stream handler: register with the
	// cap, then hand the pre-registered id/channel to RunMultiStream
	// (which itself owns a heartbeat ticker and a goroutine per spoke) —
	// running RunMultiStream in its own goroutine, the same way one HTTP
	// request's own goroutine would.
	startHandler := func() (done <-chan struct{}) {
		d := make(chan struct{})
		id, ch, _, ok := hub.RegisterWithCap("flooded-identity", 4, limits)
		if !ok {
			t.Fatalf("registration should not be refused — no MaxTotal set")
		}
		go func() {
			RunMultiStream(ctx, MultiStreamOptions{
				LocalHub:          hub,
				LocalName:         "prod",
				LocalClientID:     id,
				LocalClientCh:     ch,
				Spokes:            []ClusterSpec{{Name: "dev", URL: spoke.URL}},
				HTTPClient:        spoke.Client(),
				HeartbeatInterval: 10 * time.Millisecond,
			}, MultiStreamHandlers{})
			close(d)
		}()
		return d
	}

	// First 8: fill the identity's cap exactly, no evictions yet.
	handlerDone := make([]<-chan struct{}, 20)
	for i := 0; i < 8; i++ {
		handlerDone[i] = startHandler()
	}
	waitFor(t, 2*time.Second, func() bool { return hub.ClientCount() == 8 })
	// Let the 8 spoke-subscription goroutines actually dial and settle
	// into steady state before using this moment as the "8 live handlers"
	// goroutine baseline to compare the post-eviction count against.
	time.Sleep(150 * time.Millisecond)
	runtime.GC()
	steadyStateEight := runtime.NumGoroutine()
	// Let any trailing connection-setup goroutines from the initial dial
	// settle before locking in the baseline — a second read a moment later
	// that's no higher just confirms it's really steady, not still rising.
	steadyStateEight = waitForGoroutineCountNear(steadyStateEight, 0, 300*time.Millisecond)

	// 12 more under the SAME identity. Each crosses the cap and evicts the
	// oldest still-registered subscription for "flooded-identity" — with
	// registrations serialized here, that works out to handlerDone[0..11]
	// being evicted (oldest-first) and handlerDone[12..19] surviving; see
	// RegisterWithCap's doc comment for the eviction order this asserts.
	for i := 8; i < 20; i++ {
		handlerDone[i] = startHandler()
	}

	if got := hub.ClientCount(); got != 8 {
		t.Fatalf("expected exactly 8 subscriptions to remain registered under the shared identity's cap of 8, got %d", got)
	}

	for i := 0; i < 12; i++ {
		select {
		case <-handlerDone[i]:
		case <-time.After(2 * time.Second):
			t.Fatalf("evicted handler %d did not exit within 2s of eviction", i)
		}
	}

	// The two checks above (ClientCount()==8, and every evicted handler's
	// done channel actually closing) are already the exact, deterministic
	// proof that no application-owned goroutine leaked: RunMultiStream's
	// own contract is that it has joined every goroutine IT spawned (each
	// spoke's subscribeSpoke) before returning, and done closing only
	// happens after that join. What's left to check here is coarser: the
	// PROCESS's total goroutine count, which also includes net/http
	// Transport/Server connection-teardown goroutines (persistConn
	// readLoop/writeLoop, the server's per-connection goroutine) that
	// close asynchronously a beat after the request context that
	// triggered them — confirmed via goroutine-profile inspection to
	// settle at a small, BOUNDED (not growing with iteration count)
	// overshoot under -race, never tied to RunMultiStream/subscribeSpoke
	// stacks themselves. The wider tolerance here absorbs that std-lib
	// noise without being wide enough to hide a real per-handler leak
	// (which would show up as a multiple of one handler's ~6-goroutine
	// footprint, not a fixed handful).
	const netHTTPTeardownSlack = 20
	afterEvictions := waitForGoroutineCountNear(steadyStateEight, netHTTPTeardownSlack, 3*time.Second)
	if afterEvictions > steadyStateEight+netHTTPTeardownSlack {
		t.Fatalf("goroutine count after 12 evictions (%d) did not return near the 8-live-handler baseline (%d, ±%d) — an evicted handler leaked its spoke goroutine, heartbeat ticker, or hub registration", afterEvictions, steadyStateEight, netHTTPTeardownSlack)
	}

	// Full cleanup: end the 8 survivors too and confirm the whole
	// 20-registration/12-eviction cycle leaves nothing behind, against the
	// real pre-test baseline captured before any handler started.
	cancel()
	for i := 12; i < 20; i++ {
		select {
		case <-handlerDone[i]:
		case <-time.After(2 * time.Second):
			t.Fatalf("surviving handler %d did not exit within 2s of ctx cancellation", i)
		}
	}
	waitFor(t, 2*time.Second, func() bool { return hub.ClientCount() == 0 })

	// Same net/http-teardown-noise reasoning as netHTTPTeardownSlack above
	// applies here too, now against the real pre-test baseline — the
	// ClientCount()==0 wait and every handler's done channel (all 20, by
	// this point) already gave the deterministic, exact proof that no
	// application goroutine is still running.
	after := waitForGoroutineCountNear(trueBefore, netHTTPTeardownSlack, 3*time.Second)
	if after > trueBefore+netHTTPTeardownSlack {
		t.Fatalf("goroutine count grew from %d to %d after the full 20-registration/12-eviction/8-cancel cycle — possible leak", trueBefore, after)
	}
}

// TestRunMultiStream_DoesNotMutateSharedHubBatch guards the bug this file's
// tagging step could easily reintroduce: EventHub.flush sends the SAME
// batch slice to every registered client (see eventhub.go), so tagging a
// local batch's Cluster field must copy first — mutating in place would
// corrupt what a second, concurrently-connected RunMultiStream/plain Hub
// client reads from the same flush.
func TestRunMultiStream_DoesNotMutateSharedHubBatch(t *testing.T) {
	hub := NewEventHub(5 * time.Millisecond)
	defer hub.Stop()

	// A second, plain Hub subscriber — NOT going through RunMultiStream —
	// representing another connected client (or another cluster's own
	// RunMultiStream instance) sharing the exact same flush.
	_, plainCh := hub.Register(8)

	changesCh := make(chan []ChangeEvent, 10)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go RunMultiStream(ctx, MultiStreamOptions{
		LocalHub:  hub,
		LocalName: "prod",
	}, MultiStreamHandlers{
		OnChanges: func(e []ChangeEvent) { changesCh <- e },
	})

	hub.Publish(ChangeEvent{Type: "add", Kind: "Rollout", Namespace: "ns", Name: "a", ResourceVersion: "1"})

	tagged := waitForValue(t, changesCh, time.Second)
	if len(tagged) != 1 || tagged[0].Cluster != "prod" {
		t.Fatalf("expected RunMultiStream's own callback to see the tagged copy, got %+v", tagged)
	}

	raw := waitForValue(t, plainCh, time.Second)
	if len(raw) != 1 || raw[0].Cluster != "" {
		t.Fatalf("RunMultiStream must not mutate the shared batch other Hub clients read — got %+v", raw)
	}
}

// TestRunMultiStream_ForwardsSpokeObjectIntact is EVENTS-2026-09-04 Part 2's
// multistream contract: a spoke attaches ChangeEvent.Object to its own local
// events before ever sending them over its SSE stream (the same way the hub
// attaches objects to ITS OWN local events, in main.go's Filter closure —
// this package only forwards). RunMultiStream must relay a spoke's batch
// verbatim, Object included, exactly as it already does for the spoke's
// Cluster tag (TestRunMultiStream_MergesAndTagsLocalAndSpokeEvents).
func TestRunMultiStream_ForwardsSpokeObjectIntact(t *testing.T) {
	gate := make(chan struct{})
	spoke := newGatedSSESpoke(t, gate, []string{
		`[{"type":"update","kind":"Rollout","namespace":"team-a","name":"spoke-app","cluster":"dev","resourceVersion":"9",` +
			`"object":{"metadata":{"namespace":"team-a","name":"spoke-app"},"spec":{"version":"v2"}}}]`,
	})
	defer spoke.Close()
	close(gate)

	hub := NewEventHub(5 * time.Millisecond)
	defer hub.Stop()

	changesCh := make(chan []ChangeEvent, 10)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go RunMultiStream(ctx, MultiStreamOptions{
		LocalHub:   hub,
		LocalName:  "prod",
		Spokes:     []ClusterSpec{{Name: "dev", URL: spoke.URL}},
		HTTPClient: spoke.Client(),
	}, MultiStreamHandlers{
		OnChanges: func(e []ChangeEvent) { changesCh <- e },
	})

	deadline := time.After(3 * time.Second)
	for {
		select {
		case batch := <-changesCh:
			for _, ev := range batch {
				if ev.Name != "spoke-app" {
					continue
				}
				if ev.Object == nil {
					t.Fatalf("expected the spoke's Object to be forwarded, got nil")
				}
				var decoded struct {
					Metadata struct{ Name string }    `json:"metadata"`
					Spec     struct{ Version string } `json:"spec"`
				}
				if err := json.Unmarshal(ev.Object, &decoded); err != nil {
					t.Fatalf("forwarded Object is not valid JSON: %v (%s)", err, ev.Object)
				}
				if decoded.Metadata.Name != "spoke-app" || decoded.Spec.Version != "v2" {
					t.Fatalf("forwarded Object was altered in transit, got %+v", decoded)
				}
				return
			}
		case <-deadline:
			t.Fatalf("timed out waiting for the spoke's object-carrying event")
		}
	}
}
