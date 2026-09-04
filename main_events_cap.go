package main

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"os"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
)

// Concurrent-subscriber caps for GET /api/events/stream (2026-09-04
// incident: a dev proxy in front of the hub never closed upstream requests
// when browsers went away; after a day of automated browser sessions the
// hub had ~1000 live subscribers nobody was reading, each with its own
// per-request spoke subscriptions and a 30s heartbeat, which saturated the
// Kubernetes client's rate limiter and crashed the pod). See
// pkg/kubernetes/eventhub.go's RegisterWithCap for the eviction mechanics.
const (
	defaultEventStreamMaxPerClient = 8
	defaultEventStreamMaxTotal     = 512

	// eventStreamLocalBufSize is the buffer size this handler registers its
	// local hub subscription with — matches multistream.go's own internal
	// default (RunMultiStream would otherwise pick 32 itself, but the
	// handler now registers before calling RunMultiStream so it must pick
	// the same number itself; see MultiStreamOptions.LocalClientCh).
	eventStreamLocalBufSize = 32
)

// eventStreamMaxPerClient returns the per-identity concurrent-subscriber cap
// — env EVENT_STREAM_MAX_PER_CLIENT, default 8.
func eventStreamMaxPerClient() int {
	return envIntOrDefault("EVENT_STREAM_MAX_PER_CLIENT", defaultEventStreamMaxPerClient)
}

// eventStreamMaxTotal returns the process-wide concurrent-subscriber cap —
// env EVENT_STREAM_MAX_TOTAL, default 512.
func eventStreamMaxTotal() int {
	return envIntOrDefault("EVENT_STREAM_MAX_TOTAL", defaultEventStreamMaxTotal)
}

// envIntOrDefault reads a positive int from the named env var, falling back
// to def if it's unset, unparsable, or <= 0 (a cap of 0 or less would mean
// "refuse/evict everything", which is never what an operator setting this
// var by hand means to do — 0 reads as "not configured").
func envIntOrDefault(name string, def int) int {
	v := os.Getenv(name)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return def
	}
	return n
}

// eventStreamTryRegister is GET /api/events/stream's concurrent-subscriber
// cap check, split out from the handler itself purely so it's unit-testable
// via gin.CreateTestContext without a running k8s client, SSE plumbing, or
// the rest of main()'s wiring.
//
// Always sets X-Kuberik-Stream-Clients to the hub's current total (so a
// curl can see the count on every response, success or refusal — see the
// incident doc). On refusal (ok=false, hub at MaxTotal already) it also
// writes Retry-After: 30 and a 503 JSON body itself — the handler's whole
// job at that point is to return without writing anything else, since SSE
// headers can't be un-sent once written. On success, id/ch are the local
// hub subscription the handler must hand to RunMultiStream via
// MultiStreamOptions.LocalClientID/LocalClientCh (NOT register again).
func eventStreamTryRegister(c *gin.Context, hub *kubernetes.EventHub, identity string) (id uint64, ch <-chan []kubernetes.ChangeEvent, ok bool) {
	id, ch, total, ok := hub.RegisterWithCap(identity, eventStreamLocalBufSize, kubernetes.IdentityLimits{
		MaxPerClient: eventStreamMaxPerClient(),
		MaxTotal:     eventStreamMaxTotal(),
	})
	c.Header("X-Kuberik-Stream-Clients", strconv.Itoa(total))
	if !ok {
		c.Header("Retry-After", "30")
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "too many concurrent event stream subscribers, retry shortly",
		})
	}
	return id, ch, ok
}

// eventStreamIdentity is the concurrency-cap identity for one
// /api/events/stream caller: sha256 of the bearer token when present (the
// raw token itself is never hashed alone into something reused elsewhere,
// and never logged — eventhub.go's shortIdentityHash hashes this value
// again before it ever reaches a log line), else the client's IP
// (c.ClientIP(), which already accounts for trusted proxy headers the same
// way every other rate/visibility check in this codebase does). The
// "token:"/"ip:" prefix namespaces the two spaces so a token hash can never
// collide with an IP string.
func eventStreamIdentity(c *gin.Context, token string) string {
	if token != "" {
		sum := sha256.Sum256([]byte("token:" + token))
		return "token:" + hex.EncodeToString(sum[:])
	}
	return "ip:" + c.ClientIP()
}
