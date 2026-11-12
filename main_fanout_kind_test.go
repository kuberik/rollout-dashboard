package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type fakeTimeout struct{}

func (fakeTimeout) Error() string   { return "i/o timeout" }
func (fakeTimeout) Timeout() bool   { return true }
func (fakeTimeout) Temporary() bool { return true }

var _ net.Error = fakeTimeout{}

// The typed kind is what the UI words its notice from; the raw message stays
// for compatibility but is never what a screen branches on.
func TestClusterErrorKindAndStatus(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		kind   string
		status int
	}{
		{"stale wait", errSpokeStaleTimeout, clusterKindTimeout, 0},
		{"transport timeout", &spokeTransportError{err: fakeTimeout{}}, clusterKindTimeout, 0},
		{"deadline", &spokeTransportError{err: context.DeadlineExceeded}, clusterKindTimeout, 0},
		{"refused", &spokeTransportError{err: errors.New("dial tcp: connection refused")}, clusterKindUnreachable, 0},
		{"breaker over refused", &errSpokeCircuitOpen{lastErr: &spokeTransportError{err: errors.New("refused")}, until: time.Now().Add(time.Minute)}, clusterKindUnreachable, 0},
		{"breaker over timeout", &errSpokeCircuitOpen{lastErr: &spokeTransportError{err: fakeTimeout{}}, until: time.Now().Add(time.Minute)}, clusterKindTimeout, 0},
		{"http 403", &spokeStatusError{status: 403}, clusterKindRejected, 403},
		{"wrapped 503", fmt.Errorf("x: %w", &spokeStatusError{status: 503}), clusterKindRejected, 503},
		{"decode", &spokeDecodeError{err: errors.New("invalid character '<'")}, clusterKindBadAnswer, 0},
		{"unknown", errors.New("boom"), clusterKindUnreachable, 0},
	} {
		kind, status := clusterErrorKind(tc.err)
		if kind != tc.kind || status != tc.status {
			t.Errorf("%s: got %q/%d want %q/%d", tc.name, kind, status, tc.kind, tc.status)
		}
	}
}

// The doFetch layer returns the typed errors, with the old message text.
func TestDoFetchSpokeTypesFailures(t *testing.T) {
	for _, tc := range []struct {
		name    string
		handler http.HandlerFunc
		kind    string
		status  int
		msg     string
	}{
		{"rejected", func(w http.ResponseWriter, r *http.Request) { http.Error(w, "no", 403) }, clusterKindRejected, 403, "HTTP 403"},
		{"bad answer", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "<html>login</html>") }, clusterKindBadAnswer, 0, ""},
	} {
		s := httptest.NewServer(tc.handler)
		_, err := doFetchSpoke(context.Background(), s.URL, "/api/rollouts", "")
		s.Close()
		kind, status := clusterErrorKind(err)
		if kind != tc.kind || status != tc.status {
			t.Errorf("%s: got %q/%d (%v) want %q/%d", tc.name, kind, status, err, tc.kind, tc.status)
		}
		if tc.msg != "" && err.Error() != tc.msg {
			t.Errorf("%s: message %q changed, want %q", tc.name, err.Error(), tc.msg)
		}
	}
}
