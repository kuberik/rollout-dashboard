package kubernetes

import (
	"crypto/sha256"
	"encoding/hex"
	"log"
	"sync"
	"time"
)

// ChangeEvent is one informer add/update/delete on a cached type (cache.go's
// cachedByObject), coalesced by EventHub and broadcast over SSE
// (main.go's GET /api/events/stream) so the frontend can invalidate its
// TanStack queries the instant something changes instead of polling on a
// timer. See PERF-2026-09-04 §C.6/C.7.
//
// Cluster is the display name of the cluster this event happened on — the
// same name the frontend already sees from /api/clusters and the [cluster]
// route segment. cache.go's publishChange (the only in-process producer)
// never sets it; it is always empty when an event first lands in this
// EventHub, because a bare EventHub has no notion of "which cluster am I."
// It is filled in one layer up, by whichever code turns a Hub batch into an
// outbound SSE message: main.go's /api/events/stream handler (via
// RunMultiStream, multistream.go) stamps every local batch with this
// process's own cluster name before it ever reaches a client. A spoke's own
// events therefore arrive at the hub already carrying the spoke's name (the
// spoke's own handler stamped them the same way), so the hub forwards spoke
// batches verbatim rather than re-tagging them.
type ChangeEvent struct {
	Type            string `json:"type"` // "add" | "update" | "delete"
	Kind            string `json:"kind"`
	Namespace       string `json:"namespace"`
	Name            string `json:"name"`
	Cluster         string `json:"cluster"`
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

	// identityOf/byIdentity track only the clients registered through
	// RegisterWithCap (2026-09-04 incident — see its doc comment) — a plain
	// Register call (used directly by every existing test, and by anything
	// that doesn't need the cap) never appears in these maps. byIdentity is
	// kept oldest-first so RegisterWithCap can evict the right end.
	identityOf map[uint64]string
	byIdentity map[string][]uint64

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
		clients:    make(map[uint64]chan []ChangeEvent),
		identityOf: make(map[uint64]string),
		byIdentity: make(map[string][]uint64),
		pending:    make(map[string]ChangeEvent),
		window:     window,
		stop:       make(chan struct{}),
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
			h.dropClientLocked(id)
		}
	}
}

// dropClientLocked closes and removes one client — whatever the reason
// (backpressure in flush, a normal Unregister, or a RegisterWithCap
// eviction) — including its identity bookkeeping, so none of the three call
// sites can leak an entry into identityOf/byIdentity. Caller must hold h.mu.
func (h *EventHub) dropClientLocked(id uint64) {
	if ch, ok := h.clients[id]; ok {
		close(ch)
		delete(h.clients, id)
	}
	identity, ok := h.identityOf[id]
	if !ok {
		return
	}
	delete(h.identityOf, id)
	ids := h.byIdentity[identity]
	for i, v := range ids {
		if v == id {
			ids = append(ids[:i], ids[i+1:]...)
			break
		}
	}
	if len(ids) == 0 {
		delete(h.byIdentity, identity)
	} else {
		h.byIdentity[identity] = ids
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
// dropped the client for backpressure, or evicted it via RegisterWithCap —
// the map entry is already gone by then, so this is a no-op, not a double-
// close (dropClientLocked's h.clients lookup guards the close).
func (h *EventHub) Unregister(id uint64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.dropClientLocked(id)
}

// ClientCount reports the number of currently registered clients.
func (h *EventHub) ClientCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

// IdentityLimits configures the concurrent-subscriber caps RegisterWithCap
// enforces. Either field <= 0 disables that particular cap.
type IdentityLimits struct {
	// MaxPerClient is how many concurrently-registered clients one identity
	// may hold before RegisterWithCap starts evicting that identity's own
	// oldest subscription to make room for a new one.
	MaxPerClient int
	// MaxTotal is the hard ceiling on clients registered across every
	// identity — reaching it refuses new registrations outright rather than
	// evicting anyone, so a flood can't grow the process's memory even
	// transiently.
	MaxTotal int
}

// RegisterWithCap is Register plus the concurrent-subscriber caps that
// defend the hub against a leaked proxy holding open thousands of abandoned
// SSE requests (2026-09-04 incident: a dev proxy in front of the hub never
// closed upstream requests when browsers went away; ~1000 orphaned
// /api/events/stream subscribers, each with its own spoke subscriptions and
// heartbeat ticker, saturated the k8s client's rate limiter and crashed the
// pod).
//
// identity is caller-defined — main.go's handler uses a hash of the bearer
// token when present, else the client IP — this package attaches no meaning
// to it beyond "same string means same caller for capping purposes".
//
// If registering this client would put the hub's total at or beyond
// limits.MaxTotal, registration is refused entirely (ok=false, id/ch zero)
// — the caller must respond (503) without this client ever touching the
// hub, exactly as if RegisterWithCap were never called. Otherwise the
// client is registered exactly as Register would, and if that pushes this
// SAME identity's own concurrent count over limits.MaxPerClient, the
// OLDEST still-registered subscription for this identity is evicted —
// closing its channel via the same dropClientLocked path flush() uses for
// backpressure, which is what makes eviction tear down everything the
// evicted request owned: the losing RunMultiStream call reads a closed
// local channel, fires OnLocalDropped, and returns — cancelling its spoke
// subscriptions and stopping its heartbeat ticker via its own defers (see
// multistream.go). A real user opening a 9th tab therefore evicts their
// own oldest tab, never another identity's stream; a leaked-proxy flood
// loses its oldest copy of itself every time a new one opens.
//
// Returns the new client's id and channel (nil/0 if refused) plus the
// hub's total client count immediately after this call (or, when refused,
// the count that caused the refusal) — so the caller can set
// X-Kuberik-Stream-Clients from this single locked call without a second
// ClientCount round trip.
func (h *EventHub) RegisterWithCap(identity string, bufSize int, limits IdentityLimits) (id uint64, ch <-chan []ChangeEvent, total int, ok bool) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if limits.MaxTotal > 0 && len(h.clients) >= limits.MaxTotal {
		return 0, nil, len(h.clients), false
	}

	h.nextID++
	newID := h.nextID
	newCh := make(chan []ChangeEvent, bufSize)
	h.clients[newID] = newCh
	h.identityOf[newID] = identity
	h.byIdentity[identity] = append(h.byIdentity[identity], newID)

	if limits.MaxPerClient > 0 {
		// Re-read h.byIdentity[identity] from the map each iteration rather
		// than tracking a local copy — dropClientLocked is the single
		// source of truth for that slice's contents, so this loop just
		// keeps asking it "still over cap?" until the answer is no.
		for len(h.byIdentity[identity]) > limits.MaxPerClient {
			evictedID := h.byIdentity[identity][0]
			h.dropClientLocked(evictedID)
			log.Printf(
				"events/stream: identity %s exceeded cap of %d concurrent subscribers, evicted oldest (id=%d); %d/%d for this identity now, %d total",
				shortIdentityHash(identity), limits.MaxPerClient, evictedID, len(h.byIdentity[identity]), limits.MaxPerClient, len(h.clients),
			)
		}
	}

	return newID, newCh, len(h.clients), true
}

// shortIdentityHash is an 8-hex-char fingerprint of identity, used only for
// log lines — never logs a raw bearer-token hash or client IP, just enough
// to correlate repeated evictions from the same caller across log lines.
func shortIdentityHash(identity string) string {
	sum := sha256.Sum256([]byte(identity))
	return hex.EncodeToString(sum[:])[:8]
}

// Hub is the process-lifetime event hub. cache.go's InitReadCache registers
// an informer event handler per cached type that calls Hub.Publish; main.go's
// /api/events/stream handler calls Hub.Register/Unregister per SSE
// connection.
var Hub = NewEventHub(250 * time.Millisecond)
