package kubernetes

import (
	"sync"
	"time"
)

// ChangeEvent is one informer add/update/delete on a cached type (cache.go's
// cachedByObject), coalesced by EventHub and broadcast over SSE
// (main.go's GET /api/events/stream) so the frontend can invalidate its
// TanStack queries the instant something changes instead of polling on a
// timer. See PERF-2026-09-04 §C.6/C.7.
type ChangeEvent struct {
	Type            string `json:"type"` // "add" | "update" | "delete"
	Kind            string `json:"kind"`
	Namespace       string `json:"namespace"`
	Name            string `json:"name"`
	ResourceVersion string `json:"resourceVersion"`
	Ts              int64  `json:"ts"` // unix millis
}

// EventHub coalesces informer events into small batches (one flush per
// window) and fans them out to connected SSE clients, each with its own
// bounded buffer.
//
// Deliberately does NOT do per-user namespace visibility filtering — that
// requires a SelfSubjectAccessReview round trip (kubernetes.
// CanListRolloutsInNamespace / FilterEventsByVisibility), and running that
// inside flush() while holding h.mu would let one slow/uncached check stall
// delivery to every other connected client. The HTTP handler
// (main.go's /api/events/stream) filters the raw batch it reads from its own
// channel, in its own goroutine, after Register returns it — same visibility
// rule as every other read, just applied one layer up from here.
type EventHub struct {
	mu      sync.Mutex
	clients map[uint64]chan []ChangeEvent
	nextID  uint64

	pendingMu sync.Mutex
	pending   map[string]ChangeEvent

	window   time.Duration
	stop     chan struct{}
	stopOnce sync.Once
}

// NewEventHub builds a hub and starts its coalescing loop in a background
// goroutine. window is how often pending events are flushed to clients (the
// spec: 250ms in production; tests use a much shorter window so they don't
// sleep for real time).
func NewEventHub(window time.Duration) *EventHub {
	h := &EventHub{
		clients: make(map[uint64]chan []ChangeEvent),
		pending: make(map[string]ChangeEvent),
		window:  window,
		stop:    make(chan struct{}),
	}
	go h.loop()
	return h
}

func (h *EventHub) loop() {
	ticker := time.NewTicker(h.window)
	defer ticker.Stop()
	for {
		select {
		case <-h.stop:
			return
		case <-ticker.C:
			h.flush()
		}
	}
}

// Stop ends the coalescing goroutine. Production never calls this (the hub
// runs for the process lifetime, same as the informer cache it sits behind);
// it exists so tests can assert on goroutine counts deterministically instead
// of leaking one background goroutine per test.
func (h *EventHub) Stop() {
	h.stopOnce.Do(func() { close(h.stop) })
}

// flush drains the pending set and pushes one batch to every client's
// channel. A client whose channel is full (not draining fast enough — a slow
// network, a backgrounded tab that stopped reading) is dropped rather than
// blocking delivery to everyone else or growing memory without bound; the
// handler on the other end of the channel turns a closed channel into a
// `retry:` hint and ends the response so the browser's EventSource
// reconnects.
func (h *EventHub) flush() {
	h.pendingMu.Lock()
	if len(h.pending) == 0 {
		h.pendingMu.Unlock()
		return
	}
	batch := make([]ChangeEvent, 0, len(h.pending))
	for _, ev := range h.pending {
		batch = append(batch, ev)
	}
	h.pending = make(map[string]ChangeEvent)
	h.pendingMu.Unlock()

	h.mu.Lock()
	defer h.mu.Unlock()
	for id, ch := range h.clients {
		select {
		case ch <- batch:
		default:
			close(ch)
			delete(h.clients, id)
		}
	}
}

// Publish records one informer event, keyed by (kind, namespace, name) so
// repeated updates to the same object inside one coalescing window collapse
// into that object's latest state instead of one SSE message per watch
// event — e.g. a Rollout that gets three status patches in 250ms produces one
// "update" event, not three.
func (h *EventHub) Publish(ev ChangeEvent) {
	key := ev.Kind + "/" + ev.Namespace + "/" + ev.Name
	h.pendingMu.Lock()
	h.pending[key] = ev
	h.pendingMu.Unlock()
}

// Register adds a new client with a buffered channel of size bufSize and
// returns its id (for Unregister) and the channel to read coalesced batches
// from. The channel is closed by the hub itself when the client is dropped
// for backpressure (see flush) — callers must treat a closed channel as
// "reconnect", not as an error.
func (h *EventHub) Register(bufSize int) (uint64, <-chan []ChangeEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.nextID++
	id := h.nextID
	ch := make(chan []ChangeEvent, bufSize)
	h.clients[id] = ch
	return id, ch
}

// Unregister removes a client. Safe to call after the hub has already
// dropped the client for backpressure — the map entry is already gone by
// then, so this is a no-op, not a double-close.
func (h *EventHub) Unregister(id uint64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if ch, ok := h.clients[id]; ok {
		close(ch)
		delete(h.clients, id)
	}
}

// ClientCount reports the number of currently registered clients.
func (h *EventHub) ClientCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

// Hub is the process-lifetime event hub. cache.go's InitReadCache registers
// an informer event handler per cached type that calls Hub.Publish; main.go's
// /api/events/stream handler calls Hub.Register/Unregister per SSE
// connection.
var Hub = NewEventHub(250 * time.Millisecond)
