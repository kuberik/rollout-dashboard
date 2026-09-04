package kubernetes

import (
	"errors"
	"fmt"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

var errFake = errors.New("fake SSAR failure")

// waitFor polls cond until it's true or the deadline passes, failing the
// test otherwise. Coalescing is time-driven (a ticker), so tests need to
// wait across at least one window rather than asserting synchronously.
func waitFor(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	if !cond() {
		t.Fatalf("condition not met within %s", timeout)
	}
}

func TestEventHub_CoalescesRepeatedUpdatesToOneBatch(t *testing.T) {
	h := NewEventHub(20 * time.Millisecond)
	defer h.Stop()

	_, ch := h.Register(8)

	// Three rapid updates to the SAME object inside one coalescing window
	// must collapse into one event for that object, not three.
	for i := 0; i < 3; i++ {
		h.Publish(ChangeEvent{Type: "update", Kind: "Rollout", Namespace: "team-a", Name: "app-1", ResourceVersion: "1"})
	}
	// A different object in the same window must still get its own event.
	h.Publish(ChangeEvent{Type: "add", Kind: "Rollout", Namespace: "team-a", Name: "app-2", ResourceVersion: "1"})

	select {
	case batch := <-ch:
		if len(batch) != 2 {
			t.Fatalf("expected 2 coalesced events (one per distinct object), got %d: %+v", len(batch), batch)
		}
		byName := map[string]ChangeEvent{}
		for _, ev := range batch {
			byName[ev.Name] = ev
		}
		if byName["app-1"].Type != "update" {
			t.Fatalf("expected app-1's event to be the update, got %+v", byName["app-1"])
		}
		if byName["app-2"].Type != "add" {
			t.Fatalf("expected app-2's event to be the add, got %+v", byName["app-2"])
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for coalesced batch")
	}
}

func TestEventHub_EmptyWindowSendsNothing(t *testing.T) {
	h := NewEventHub(10 * time.Millisecond)
	defer h.Stop()

	_, ch := h.Register(8)

	// No Publish calls at all — several coalescing windows must pass with no
	// batch delivered, not an empty one, so the SSE handler never wakes up to
	// encode a no-op message.
	select {
	case batch := <-ch:
		t.Fatalf("expected no batch when nothing was published, got %+v", batch)
	case <-time.After(80 * time.Millisecond):
		// expected
	}
}

func TestEventHub_BackpressureDropsSlowClientWithoutBlockingOthers(t *testing.T) {
	h := NewEventHub(5 * time.Millisecond)
	defer h.Stop()

	// bufSize 1: the first flush fills it; a second flush before the slow
	// client drains must drop it instead of blocking the hub's single
	// coalescing goroutine (which would stall every other client too).
	slowID, slowCh := h.Register(1)
	_, fastCh := h.Register(8)

	h.Publish(ChangeEvent{Kind: "Rollout", Namespace: "ns", Name: "a", Type: "add"})
	waitFor(t, time.Second, func() bool { return len(fastCh) == 1 || len(slowCh) == 1 })

	// Don't drain slowCh. Publish again so a second flush has to deal with a
	// full slowCh buffer.
	h.Publish(ChangeEvent{Kind: "Rollout", Namespace: "ns", Name: "b", Type: "add"})

	// The fast client (drained promptly below) must still receive both
	// batches — backpressure on one client must not stall delivery to
	// another.
	select {
	case <-fastCh:
	case <-time.After(time.Second):
		t.Fatal("fast client did not receive its first batch")
	}
	select {
	case <-fastCh:
	case <-time.After(time.Second):
		t.Fatal("fast client did not receive its second batch (was blocked by the slow client)")
	}

	// The slow client must have been dropped: its channel is closed, and the
	// hub no longer counts it.
	waitFor(t, time.Second, func() bool {
		_, open := <-slowCh
		return !open
	})
	waitFor(t, time.Second, func() bool { return h.ClientCount() == 1 })

	h.Unregister(slowID) // no-op, already dropped — must not panic (double close)
}

func TestEventHub_RegisterUnregisterDoesNotLeakGoroutines(t *testing.T) {
	h := NewEventHub(5 * time.Millisecond)
	defer h.Stop()

	runtime.GC()
	before := runtime.NumGoroutine()

	const n = 20
	for i := 0; i < n; i++ {
		id, ch := h.Register(4)
		h.Publish(ChangeEvent{Kind: "Rollout", Namespace: "ns", Name: "obj", Type: "add"})
		select {
		case <-ch:
		case <-time.After(200 * time.Millisecond):
		}
		h.Unregister(id)
	}

	waitFor(t, 2*time.Second, func() bool { return h.ClientCount() == 0 })

	runtime.GC()
	after := runtime.NumGoroutine()
	// Register/Unregister spawn no goroutines of their own (only the hub's
	// one long-lived coalescing loop exists regardless of client count) — a
	// handful of goroutines of slack for the Go runtime/test harness itself
	// is fine, growth proportional to n (20) would mean a leak.
	if after > before+5 {
		t.Fatalf("goroutine count grew from %d to %d after %d connect/disconnect cycles — possible leak", before, after, n)
	}
}

// TestEventHub_LoadTwentyClientsTwoHundredEvents is the load test the
// verification plan calls for directly: 20 SSE clients connected at once,
// 200 informer events published against them, then all 20 disconnect — the
// goroutine count afterward must be back where it started. Register/
// Unregister themselves spawn no goroutines (see the doc comment on
// EventHub), so this is really asserting the hub's one coalescing loop is
// the only background goroutine the whole scenario ever needed.
func TestEventHub_LoadTwentyClientsTwoHundredEvents(t *testing.T) {
	h := NewEventHub(5 * time.Millisecond)
	defer h.Stop()

	runtime.GC()
	before := runtime.NumGoroutine()

	const numClients = 20
	const numEvents = 200

	type client struct {
		id uint64
		ch <-chan []ChangeEvent
	}
	clients := make([]client, numClients)
	for i := range clients {
		id, ch := h.Register(64)
		clients[i] = client{id: id, ch: ch}
	}

	// Drain every client concurrently while the publisher fires, so a full
	// buffer never causes a spurious drop in this test (backpressure itself
	// is covered separately, above).
	var wg sync.WaitGroup
	received := make([]int, numClients)
	for i, cl := range clients {
		wg.Add(1)
		go func(i int, ch <-chan []ChangeEvent) {
			defer wg.Done()
			for batch := range ch {
				received[i] += len(batch)
			}
		}(i, cl.ch)
	}

	for i := 0; i < numEvents; i++ {
		h.Publish(ChangeEvent{
			Kind:      "Rollout",
			Namespace: "ns",
			Name:      fmt.Sprintf("obj-%d", i), // distinct keys — nothing here should coalesce away
			Type:      "add",
		})
	}

	// Give the coalescing loop time to flush everything, then disconnect
	// every client.
	time.Sleep(100 * time.Millisecond)
	for _, cl := range clients {
		h.Unregister(cl.id)
	}
	wg.Wait()

	for i, n := range received {
		if n != numEvents {
			t.Errorf("client %d received %d/%d events", i, n, numEvents)
		}
	}

	waitFor(t, 2*time.Second, func() bool { return h.ClientCount() == 0 })

	runtime.GC()
	after := runtime.NumGoroutine()
	if after > before+5 {
		t.Fatalf("goroutine count grew from %d to %d after %d clients / %d events — possible leak", before, after, numClients, numEvents)
	}
}

func TestFilterEventsByVisibility_NoToken_StreamsEverything(t *testing.T) {
	resetVisibilityCache()
	calls := 0
	withFakeChecker(t, func(c *gin.Context, ns string) (bool, error) {
		calls++
		return false, nil
	})

	c := newTestGinContext(t, "")
	events := []ChangeEvent{
		{Kind: "Rollout", Namespace: "team-a", Name: "app-1"},
		{Kind: "Rollout", Namespace: "team-b", Name: "app-2"},
	}
	out := FilterEventsByVisibility(c, events)
	if len(out) != 2 {
		t.Fatalf("expected service-account (no-token) mode to pass every event through, got %d/%d", len(out), len(events))
	}
	if calls != 0 {
		t.Fatalf("expected the SSAR checker to be skipped entirely when no token is present, got %d calls", calls)
	}
}

func TestFilterEventsByVisibility_FiltersToAllowedNamespaces(t *testing.T) {
	resetVisibilityCache()
	withFakeChecker(t, func(c *gin.Context, ns string) (bool, error) {
		return ns == "team-a", nil
	})

	c := newTestGinContext(t, "user-token")
	events := []ChangeEvent{
		{Kind: "Rollout", Namespace: "team-a", Name: "app-1"},
		{Kind: "Rollout", Namespace: "team-b", Name: "app-2"},
		{Kind: "Rollout", Namespace: "team-a", Name: "app-3"},
	}
	out := FilterEventsByVisibility(c, events)
	if len(out) != 2 {
		t.Fatalf("expected only team-a's 2 events to pass, got %d: %+v", len(out), out)
	}
	for _, ev := range out {
		if ev.Namespace != "team-a" {
			t.Fatalf("leaked an event from a namespace the caller may not list: %+v", ev)
		}
	}
}

func TestFilterEventsByVisibility_CheckerErrorDropsThatNamespaceOnly(t *testing.T) {
	resetVisibilityCache()
	withFakeChecker(t, func(c *gin.Context, ns string) (bool, error) {
		if ns == "team-broken" {
			return false, errFake
		}
		return true, nil
	})

	c := newTestGinContext(t, "user-token")
	events := []ChangeEvent{
		{Kind: "Rollout", Namespace: "team-broken", Name: "app-1"},
		{Kind: "Rollout", Namespace: "team-a", Name: "app-2"},
	}
	out := FilterEventsByVisibility(c, events)
	if len(out) != 1 || out[0].Namespace != "team-a" {
		t.Fatalf("expected only team-a's event to survive a checker error on team-broken, got %+v", out)
	}
}
