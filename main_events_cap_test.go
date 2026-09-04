package main

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
)

// TestEventStreamTryRegister_SetsClientCountHeaderOnSuccess is the
// httptest-level check of the handler's cap-check seam (main_events_cap.go)
// on the happy path: registration succeeds, and the response the caller is
// about to build the SSE stream on top of already carries
// X-Kuberik-Stream-Clients so `curl -D-` can see the count without needing
// to read the stream body.
func TestEventStreamTryRegister_SetsClientCountHeaderOnSuccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	hub := kubernetes.NewEventHub(5 * time.Millisecond)
	defer hub.Stop()

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)

	id, ch, ok := eventStreamTryRegister(c, hub, "ip:127.0.0.1")
	if !ok {
		t.Fatalf("expected registration to succeed against a fresh hub")
	}
	if ch == nil {
		t.Fatalf("expected a non-nil channel on success")
	}
	if got := rec.Header().Get("X-Kuberik-Stream-Clients"); got != "1" {
		t.Fatalf("X-Kuberik-Stream-Clients = %q, want %q", got, "1")
	}
	if rec.Code != 200 {
		t.Fatalf("expected the recorder to still be at its default 200 (handler writes SSE headers itself, not this seam), got %d", rec.Code)
	}
	hub.Unregister(id)
}

// TestEventStreamTryRegister_RefusesWith503AndRetryAfterAtGlobalCap is the
// httptest-level check of the handler's cap-check seam on the incident's
// actual defense: once the hub is at EVENT_STREAM_MAX_TOTAL, a new request
// must get a 503 with Retry-After: 30 — set entirely by this seam, before
// the handler would otherwise have gone on to write SSE headers — and the
// client count header must still reflect the (unchanged) total, so a curl
// against a saturated hub can see why it was refused.
func TestEventStreamTryRegister_RefusesWith503AndRetryAfterAtGlobalCap(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("EVENT_STREAM_MAX_TOTAL", "2")
	t.Setenv("EVENT_STREAM_MAX_PER_CLIENT", "") // unset — irrelevant to this test, two different identities

	hub := kubernetes.NewEventHub(5 * time.Millisecond)
	defer hub.Stop()

	fill := func(identity string) uint64 {
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		id, _, ok := eventStreamTryRegister(c, hub, identity)
		if !ok {
			t.Fatalf("registration for %q should have succeeded while under MaxTotal", identity)
		}
		return id
	}
	id1 := fill("ip:10.0.0.1")
	id2 := fill("ip:10.0.0.2")
	defer hub.Unregister(id1)
	defer hub.Unregister(id2)

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	_, ch, ok := eventStreamTryRegister(c, hub, "ip:10.0.0.3")
	if ok {
		t.Fatalf("expected the 3rd registration to be refused at EVENT_STREAM_MAX_TOTAL=2")
	}
	if ch != nil {
		t.Fatalf("expected a nil channel on refusal, got %v", ch)
	}
	if rec.Code != 503 {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if got := rec.Header().Get("Retry-After"); got != "30" {
		t.Fatalf("Retry-After = %q, want %q", got, "30")
	}
	if got := rec.Header().Get("X-Kuberik-Stream-Clients"); got != "2" {
		t.Fatalf("X-Kuberik-Stream-Clients = %q, want %q (the pre-refusal total, unchanged by a refused registration)", got, "2")
	}
	if got := hub.ClientCount(); got != 2 {
		t.Fatalf("a refused registration must never have touched the hub's client count, got %d", got)
	}
	body := rec.Body.String()
	if !contains(body, `"error"`) {
		t.Fatalf("expected a JSON error body, got %s", body)
	}
}

// TestEventStreamTryRegister_EvictsOldestOfSameIdentityAtPerClientCap wires
// EVENT_STREAM_MAX_PER_CLIENT end to end through the handler seam: a 9th
// registration from the SAME identity, with the env var set to 8, must
// succeed (not 503 — only the global cap refuses) while closing the
// oldest of that identity's own still-open channels.
func TestEventStreamTryRegister_EvictsOldestOfSameIdentityAtPerClientCap(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("EVENT_STREAM_MAX_PER_CLIENT", "2")
	t.Setenv("EVENT_STREAM_MAX_TOTAL", "")

	hub := kubernetes.NewEventHub(5 * time.Millisecond)
	defer hub.Stop()

	register := func() (uint64, <-chan []kubernetes.ChangeEvent) {
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		id, ch, ok := eventStreamTryRegister(c, hub, "token:same-caller")
		if !ok {
			t.Fatalf("expected registration to succeed — only the global cap refuses outright")
		}
		return id, ch
	}

	id1, ch1 := register()
	_, ch2 := register()
	id3, ch3 := register() // 3rd for this identity, cap 2 — evicts id1

	select {
	case _, open := <-ch1:
		if open {
			t.Fatalf("expected the oldest (1st) registration's channel to be closed by the 3rd exceeding the per-client cap")
		}
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for the evicted channel to close")
	}
	select {
	case _, open := <-ch2:
		if !open {
			t.Fatalf("2nd registration must not be evicted — it isn't the oldest")
		}
	default:
	}
	select {
	case _, open := <-ch3:
		if !open {
			t.Fatalf("3rd (newest) registration must survive — it's the one that triggered the eviction, not its victim")
		}
	default:
	}

	if got := hub.ClientCount(); got != 2 {
		t.Fatalf("expected 2 registered clients after the eviction, got %d", got)
	}
	hub.Unregister(id3)
	// id1 already evicted; Unregister is a documented no-op on an
	// already-dropped client.
	hub.Unregister(id1)
}
