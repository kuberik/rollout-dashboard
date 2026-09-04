package kubernetes

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ClusterSpec names one spoke dashboard for RunMultiStream to subscribe to —
// the same {name, url} shape main.go's ClusterInfo carries, duplicated here
// (rather than imported) so this package stays free of a dependency on the
// main package.
type ClusterSpec struct {
	Name string
	URL  string
}

// MultiStreamOptions configures one hub-side aggregated change-event stream —
// the engine behind GET /api/events/stream. See RunMultiStream's doc comment
// for the merge model.
type MultiStreamOptions struct {
	// LocalHub is the EventHub to read this process's own informer events
	// from. Defaults to the package-level Hub when nil; tests pass their own
	// so they don't share state with other tests or the real cache.
	LocalHub *EventHub

	// LocalName is this process's own cluster display name — stamped onto
	// every local ChangeEvent whose Cluster field is still empty (cache.go's
	// publishChange never sets it), and reported as always-connected in the
	// "clusters" snapshot.
	LocalName string

	// Spokes are the other dashboards to subscribe to. Empty means
	// single-cluster behavior: local events only, plus one "clusters" event
	// naming just LocalName.
	Spokes []ClusterSpec

	// Token is forwarded as every spoke request's bearer token — the
	// caller's own OIDC token, never a shared/cached credential — so each
	// spoke applies the caller's own RBAC visibility filter to what it
	// sends back. This process does not re-filter events a spoke already
	// filtered and tagged.
	Token string

	// FanoutHeader, if non-empty, is set on every spoke request so the
	// spoke's own handler knows this is already a fan-out leg and must not
	// discover/subscribe to spokes of its own — avoids hub↔spoke
	// subscription cycles. Matches main_fanout.go's fanoutHeader.
	FanoutHeader string

	// HTTPClient issues the spoke requests. Defaults to http.DefaultClient.
	HTTPClient *http.Client

	// Filter, if set, is applied to each LOCAL batch (after cluster
	// tagging) before it reaches Handlers.OnChanges — the per-user
	// visibility check every other read in this codebase applies. Spoke
	// batches are never passed through Filter; the spoke already applied
	// the caller's own visibility to them.
	Filter func([]ChangeEvent) []ChangeEvent

	// HeartbeatInterval, if > 0, fires Handlers.OnHeartbeat on this cadence.
	HeartbeatInterval time.Duration

	// LocalBufSize is the buffer size passed to LocalHub.Register. Defaults
	// to 32.
	LocalBufSize int

	// SpokeOutBufSize sizes the channel every spoke subscription's parsed
	// batches land on before Run forwards them. Defaults to 64. A full
	// buffer drops the batch (same backpressure rule EventHub itself
	// applies to a slow client) rather than blocking a spoke's reader.
	SpokeOutBufSize int
}

// MultiStreamHandlers are Run's callbacks. Every call happens synchronously
// from Run's own goroutine, one at a time, never concurrently with another —
// so a caller (main.go's SSE handler) can write straight to an
// http.ResponseWriter from inside them with no locking of its own.
type MultiStreamHandlers struct {
	// OnChanges is called once per source batch ready to forward — one call
	// per local flush, and one call per batch a spoke sent, kept separate
	// rather than merged into a bigger batch (the 250ms coalescing already
	// happened at its source; merging further here would just add latency
	// with no coalescing benefit).
	OnChanges func([]ChangeEvent)

	// OnClusters is called once immediately (before Run's select loop
	// starts, i.e. before returning control to the caller) with the initial
	// {name: connected} snapshot, and again every time any cluster's
	// connected state changes.
	OnClusters func(map[string]bool)

	// OnHeartbeat fires on Options.HeartbeatInterval, if set.
	OnHeartbeat func()

	// OnLocalDropped is called if LocalHub drops this subscriber for
	// backpressure (its channel closed — see EventHub.flush). Run returns
	// immediately afterward; the caller should end the SSE response so the
	// browser's EventSource reconnects with a clean buffer.
	OnLocalDropped func()
}

type spokeConnEvent struct {
	cluster   string
	connected bool
}

// RunMultiStream merges this process's own hub-local ChangeEvent stream
// (opts.LocalHub) with a live subscription to every opts.Spokes dashboard's
// own GET /api/events/stream, until ctx is done or the local hub drops this
// subscriber for backpressure. It is the whole engine behind the multi-
// cluster GET /api/events/stream contract:
//
//   - Local events are tagged with opts.LocalName (if not already tagged)
//     and passed through opts.Filter before being handed to
//     handlers.OnChanges.
//   - Each spoke is subscribed to under opts.Token — the caller's own bearer
//     token, exactly as main_fanout.go's fetchSpoke forwards it — so the
//     spoke applies the caller's own RBAC visibility and this process never
//     needs to re-filter what the spoke already filtered and tagged.
//     Reconnects with jittered exponential backoff (1s→30s cap) on any
//     connect/read error; a spoke's own local coalescing (its own EventHub)
//     means each batch that does arrive is forwarded to handlers.OnChanges
//     as-is, no further coalescing added here.
//   - handlers.OnClusters is called once immediately with the starting
//     snapshot (LocalName always true; every spoke false until its first
//     successful connect) and again on every connectivity flip.
//   - A spoke that is down, slow, or erroring never blocks local events —
//     each spoke runs its own goroutine writing into a shared, buffered,
//     drop-on-full channel that Run's single select loop reads alongside
//     the local hub channel.
//
// On return, every goroutine RunMultiStream spawned has already exited (it
// waits for them) — safe to call repeatedly (e.g. once per test iteration,
// or once per SSE request) without leaking.
func RunMultiStream(ctx context.Context, opts MultiStreamOptions, handlers MultiStreamHandlers) {
	hub := opts.LocalHub
	if hub == nil {
		hub = Hub
	}
	localBufSize := opts.LocalBufSize
	if localBufSize <= 0 {
		localBufSize = 32
	}
	spokeBufSize := opts.SpokeOutBufSize
	if spokeBufSize <= 0 {
		spokeBufSize = 64
	}
	httpClient := opts.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}

	id, localCh := hub.Register(localBufSize)
	defer hub.Unregister(id)

	subCtx, cancel := context.WithCancel(ctx)

	spokeOut := make(chan []ChangeEvent, spokeBufSize)
	stateCh := make(chan spokeConnEvent, len(opts.Spokes)*2+4)

	connState := make(map[string]bool, len(opts.Spokes)+1)
	connState[opts.LocalName] = true
	for _, sp := range opts.Spokes {
		connState[sp.Name] = false
	}

	var wg sync.WaitGroup
	for _, sp := range opts.Spokes {
		wg.Add(1)
		go func(sp ClusterSpec) {
			defer wg.Done()
			subscribeSpoke(subCtx, spokeSubscription{
				url:          sp.URL,
				clusterName:  sp.Name,
				token:        opts.Token,
				fanoutHeader: opts.FanoutHeader,
				client:       httpClient,
			}, spokeOut, stateCh)
		}(sp)
	}
	// Order matters: stop the heartbeat (registered after this, so it runs
	// first), THEN cancel the spoke subscriptions and wait for them to
	// actually exit, and only THEN unregister from the local hub. Waiting
	// here — rather than leaving it to happen in the background — is what
	// makes a single Run call leak-free on its own, which is what lets the
	// leak test call it in a plain loop instead of needing its own
	// goroutine-count polling per iteration.
	defer func() {
		cancel()
		wg.Wait()
	}()

	emitClusters := func() {
		if handlers.OnClusters == nil {
			return
		}
		snapshot := make(map[string]bool, len(connState))
		for k, v := range connState {
			snapshot[k] = v
		}
		handlers.OnClusters(snapshot)
	}
	emitClusters()

	var heartbeatC <-chan time.Time
	if opts.HeartbeatInterval > 0 {
		ticker := time.NewTicker(opts.HeartbeatInterval)
		defer ticker.Stop()
		heartbeatC = ticker.C
	}

	for {
		select {
		case <-ctx.Done():
			return
		case batch, ok := <-localCh:
			if !ok {
				if handlers.OnLocalDropped != nil {
					handlers.OnLocalDropped()
				}
				return
			}
			// batch is a slice SHARED across every client currently
			// registered on hub (EventHub.flush sends the same slice to
			// every client channel) — copy before tagging so this doesn't
			// mutate what another connected client is about to read.
			tagged := make([]ChangeEvent, len(batch))
			for i, ev := range batch {
				if ev.Cluster == "" {
					ev.Cluster = opts.LocalName
				}
				tagged[i] = ev
			}
			if opts.Filter != nil {
				tagged = opts.Filter(tagged)
			}
			if len(tagged) > 0 && handlers.OnChanges != nil {
				handlers.OnChanges(tagged)
			}
		case batch := <-spokeOut:
			if len(batch) > 0 && handlers.OnChanges != nil {
				handlers.OnChanges(batch)
			}
		case upd := <-stateCh:
			if connState[upd.cluster] != upd.connected {
				connState[upd.cluster] = upd.connected
				emitClusters()
			}
		case <-heartbeatC:
			if handlers.OnHeartbeat != nil {
				handlers.OnHeartbeat()
			}
		}
	}
}

// spokeSubscription is one spoke's connection parameters, passed to
// subscribeSpoke.
type spokeSubscription struct {
	url          string
	clusterName  string
	token        string
	fanoutHeader string
	client       *http.Client
}

// subscribeSpoke connects to sub.url's own GET /api/events/stream and
// forwards parsed "changes" batches onto out, until ctx is done. Reconnects
// with jittered exponential backoff (1s→30s cap) on any connect/read error.
// Reports every up/down transition on state — starts down, so a caller that
// initializes its own connectivity map to false and only reacts to
// transitions (as RunMultiStream does) stays correct without this function
// needing to send a redundant "still down" event before the first connect
// attempt even starts.
func subscribeSpoke(ctx context.Context, sub spokeSubscription, out chan<- []ChangeEvent, state chan<- spokeConnEvent) {
	const initialBackoff = 1 * time.Second
	const maxBackoff = 30 * time.Second
	backoff := initialBackoff

	connected := false
	setConnected := func(v bool) {
		if v == connected {
			return
		}
		connected = v
		// state is sized with headroom for every spoke (RunMultiStream:
		// len(opts.Spokes)*2+4) and each spoke only ever has one flip in
		// flight at a time, so this send does not need a <-ctx.Done()
		// escape hatch to stay non-blocking — but include one anyway: it
		// is what makes the DEFERRED final setConnected(false) (below, at
		// the moment ctx is already cancelled and RunMultiStream's select
		// loop may have already returned) provably never block.
		select {
		case state <- spokeConnEvent{cluster: sub.clusterName, connected: v}:
		case <-ctx.Done():
		}
	}
	defer setConnected(false)

	for {
		if ctx.Err() != nil {
			return
		}

		err := connectAndReadSpoke(ctx, sub, out, setConnected)
		setConnected(false)

		if ctx.Err() != nil {
			return
		}
		if err != nil {
			log.Printf("events/stream: spoke %q (%s) disconnected: %v; reconnecting", sub.clusterName, sub.url, err)
		}

		wait := backoff/2 + time.Duration(rand.Int63n(int64(backoff)/2+1))
		select {
		case <-time.After(wait):
		case <-ctx.Done():
			return
		}
		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}

// connectAndReadSpoke makes one connection attempt to sub's event stream and
// blocks reading it until it ends (error, EOF, or ctx cancellation). Calls
// setConnected(true) only once the connection is actually established (a
// 200 response), so a failed dial or a non-200 never flips the caller's
// connectivity state.
func connectAndReadSpoke(ctx context.Context, sub spokeSubscription, out chan<- []ChangeEvent, setConnected func(bool)) error {
	reqURL := strings.TrimRight(sub.url, "/") + "/api/events/stream"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return err
	}
	if sub.token != "" {
		req.Header.Set("Authorization", "Bearer "+sub.token)
	}
	if sub.fanoutHeader != "" {
		req.Header.Set(sub.fanoutHeader, "1")
	}
	req.Header.Set("Accept", "text/event-stream")

	resp, err := sub.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	setConnected(true)

	return readSSE(resp.Body, func(event, data string) {
		if event != "changes" || data == "" {
			return
		}
		var events []ChangeEvent
		if err := json.Unmarshal([]byte(data), &events); err != nil {
			log.Printf("events/stream: spoke %q sent an unparsable changes payload: %v", sub.clusterName, err)
			return
		}
		select {
		case out <- events:
		case <-ctx.Done():
		default:
			// Merged spoke channel is full — drop this batch rather than
			// block the reader, the same backpressure rule EventHub itself
			// applies to a client that isn't draining fast enough.
		}
	})
}

// readSSE is a minimal Server-Sent-Events frame reader — just enough to
// parse the event/data fields this codebase's own SSE responses produce
// (main.go's sse.Encode calls: "event: <name>\ndata: <json>\n\n", plus the
// "retry:"/comment preamble bytes the stream handler writes before its
// first real event), not a general-purpose SSE client. Calls onEvent once
// per dispatched (non-empty-data) event. Returns io.EOF when the body ends
// without error — a natural stream close is still "disconnected" from the
// caller's point of view, so it reconnects the same as any other error.
func readSSE(body io.Reader, onEvent func(event, data string)) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 4096), 1<<20)

	var event string
	var dataLines []string
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case line == "":
			if len(dataLines) > 0 {
				onEvent(event, strings.Join(dataLines, "\n"))
			}
			event = ""
			dataLines = nil
		case strings.HasPrefix(line, ":"):
			// comment line (e.g. ": connected") — ignore
		case strings.HasPrefix(line, "event:"):
			event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			dataLines = append(dataLines, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		default:
			// retry:, id:, or anything else this codebase doesn't emit — ignore.
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return io.EOF
}
