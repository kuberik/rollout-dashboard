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

// A spoke that answered once and then dies must surface as a clusterError
// flagged stale, with its last-known items still served. Before this, the
// failed refresh left the old payload in the cache with a nil error, so the
// hub showed a dead spoke's old state as current indefinitely.
func TestFanOutMarksDeadSpokeStaleAndRecovers(t *testing.T) {
	var down atomic.Bool
	spoke := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if down.Load() {
			http.Error(w, "gone", http.StatusServiceUnavailable)
			return
		}
		if r.URL.Path == "/api/cluster" {
			fmt.Fprint(w, `{"name":"spoke"}`)
			return
		}
		fmt.Fprint(w, `{"rollouts":{"items":[{"metadata":{"name":"spoke-app","namespace":"default"}}]}}`)
	}))
	defer spoke.Close()

	swapFanoutState(t, 2*time.Second)
	spokeDataCache.ttl = 30 * time.Millisecond

	localURL := "https://kuberik.hub.example"
	envs := envsWithSpoke(localURL, spoke.URL)
	run := func() (map[string]interface{}, []ClusterError) {
		merged, _, errs := fanOutRollouts(context.Background(), localDataWith(envs), localURL, "")
		return map[string]interface{}{"rollouts": merged["rollouts"]}, errs
	}

	// Healthy: no errors.
	if _, errs := run(); len(errs) != 0 {
		t.Fatalf("healthy spoke reported errors: %+v", errs)
	}

	down.Store(true)
	var errs []ClusterError
	var merged map[string]interface{}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
		waitForFanoutBackground()
		merged, errs = run()
		if len(errs) > 0 {
			break
		}
	}
	if len(errs) != 1 {
		t.Fatalf("dead spoke never reported in clusterErrors; got %+v", errs)
	}
	e := errs[0]
	if !e.Stale || e.LastSeen == nil || e.URL != spoke.URL || e.Name != "spoke" || e.Error == "" {
		t.Fatalf("want stale error with lastSeen for the spoke, got %+v", e)
	}
	// Last-known items are still served alongside the warning.
	_ = merged
	m, _, _ := fanOutRollouts(context.Background(), localDataWith(envs), localURL, "")
	if !jsonHasName(t, m["rollouts"], "spoke-app") {
		t.Fatalf("last-known spoke items dropped: %s", m["rollouts"])
	}

	// Recovery clears the flag.
	down.Store(false)
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
		waitForFanoutBackground()
		if _, errs = run(); len(errs) == 0 {
			return
		}
	}
	t.Fatalf("stale flag never cleared after recovery: %+v", errs)
}
