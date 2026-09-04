package kubernetes

import (
	"context"
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
