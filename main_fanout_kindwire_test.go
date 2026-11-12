package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// spokeAnswering serves /api/cluster normally and /api/rollouts through mode:
// 0 healthy, 1 HTTP 403, 2 an HTML page.
func spokeAnswering(mode *atomic.Int32) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/cluster" {
			fmt.Fprint(w, `{"name":"spoke"}`)
			return
		}
		switch mode.Load() {
		case 1:
			http.Error(w, "forbidden", http.StatusForbidden)
		case 2:
			fmt.Fprint(w, "<html>sign in</html>")
		default:
			fmt.Fprint(w, `{"rollouts":{"items":[{"metadata":{"name":"spoke-app","namespace":"default"}}]}}`)
		}
	}))
}

func fanOutErrors(t *testing.T, spokeURL string) []ClusterError {
	t.Helper()
	localURL := "https://kuberik.hub.example"
	_, _, errs := fanOutRollouts(context.Background(), localDataWith(envsWithSpoke(localURL, spokeURL)), localURL, "")
	return errs
}

// The typed kind, status and detail reach the clusterErrors a fan-out returns
// (the API response), for a spoke with nothing cached.
func TestFanOutColdSpokeFailuresAreTyped(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mode   int32
		kind   string
		status int
		detail string
	}{
		{"rejected", 1, clusterKindRejected, 403, ""},
		{"bad answer", 2, clusterKindBadAnswer, 0, clusterDetailNotJSON},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var mode atomic.Int32
			mode.Store(tc.mode)
			spoke := spokeAnswering(&mode)
			defer spoke.Close()
			swapFanoutState(t, 2*time.Second)
			errs := fanOutErrors(t, spoke.URL)
			if len(errs) != 1 {
				t.Fatalf("clusterErrors = %+v", errs)
			}
			if e := errs[0]; e.Kind != tc.kind || e.Status != tc.status || e.Detail != tc.detail || e.Stale {
				t.Fatalf("got kind=%q status=%d detail=%q stale=%v, want %q/%d/%q/false", e.Kind, e.Status, e.Detail, e.Stale, tc.kind, tc.status, tc.detail)
			}
		})
	}
}

// The same typing on the stale branch: a spoke that answered once, then
// started rejecting or sending a page, is reported stale AND typed.
func TestFanOutStaleSpokeFailuresAreTyped(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mode   int32
		kind   string
		status int
		detail string
	}{
		{"rejected", 1, clusterKindRejected, 403, ""},
		{"bad answer", 2, clusterKindBadAnswer, 0, clusterDetailNotJSON},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var mode atomic.Int32
			spoke := spokeAnswering(&mode)
			defer spoke.Close()
			swapFanoutState(t, 2*time.Second)
			spokeDataCache.ttl = 30 * time.Millisecond
			if errs := fanOutErrors(t, spoke.URL); len(errs) != 0 {
				t.Fatalf("healthy spoke reported %+v", errs)
			}
			mode.Store(tc.mode)
			var errs []ClusterError
			deadline := time.Now().Add(3 * time.Second)
			for time.Now().Before(deadline) && len(errs) == 0 {
				time.Sleep(50 * time.Millisecond)
				waitForFanoutBackground()
				errs = fanOutErrors(t, spoke.URL)
			}
			if len(errs) != 1 || !errs[0].Stale {
				t.Fatalf("clusterErrors = %+v, want one stale entry", errs)
			}
			if e := errs[0]; e.Kind != tc.kind || e.Status != tc.status || e.Detail != tc.detail {
				t.Fatalf("stale entry kind=%q status=%d detail=%q, want %q/%d/%q", e.Kind, e.Status, e.Detail, tc.kind, tc.status, tc.detail)
			}
		})
	}
}
