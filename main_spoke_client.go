package main

import (
	"net/http"
	"time"
)

// newSpokeHTTPClient is the ONE constructor for every hub->spoke HTTP client
// (proxy, fan-out fetch, name probe, SSE multistream). It never follows
// redirects: Go strips only Authorization/Cookie on a cross-host redirect, so
// following one would leak every other header (fanout marker, anything
// forwarded) to whatever host a spoke names. Callers see the 3xx itself: the
// proxy relays it to the browser unchanged, fan-out/name probe treat it as a
// failed spoke (non-200 status). timeout 0 means none (SSE; context governs).
func newSpokeHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Transport: fanoutTransport,
		Timeout:   timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}
