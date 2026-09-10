package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// hangingSpoke is a dashboard URL that accepts the connection and then never
// answers — the exact shape of the 2026-09-10 outage, where one spoke's
// hostname resolved and its ingress was up from the internet but the route
// from inside the hub cluster was black-holed.
func hangingSpoke(t *testing.T) *httptest.Server {
	t.Helper()
	stop := make(chan struct{})
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-stop:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(func() { close(stop); s.Close() })
	return s
}

func envsWithSpoke(localURL, spokeURL string) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{"items":[{
		"metadata":{"name":"app","namespace":"default"},
		"spec":{"environment":"prod"},
		"status":{"environmentInfos":[
			{"environment":"prod","environmentUrl":%q},
			{"environment":"dev","environmentUrl":%q}
		]}
	}]}`, localURL, spokeURL))
}

// swapFanoutState gives a test its own caches and breaker so it neither sees
// nor leaves process-wide state.
func swapFanoutState(t *testing.T, coldGrace time.Duration) {
	t.Helper()
	prevData, prevName, prevBreakers := spokeDataCache, spokeNameCache, breakers
	spokeDataCache = newSWRCache[map[string]json.RawMessage](spokeDataTTL, coldGrace, 4*time.Second)
	spokeNameCache = newSWRCache[string](spokeNameTTL, coldGrace, 4*time.Second)
	breakers = newSpokeBreakers()
	t.Cleanup(func() {
		// Drain first: a background warm still holding the old globals
		// would otherwise race the restore below.
		waitForFanoutBackground()
		spokeDataCache, spokeNameCache, breakers = prevData, prevName, prevBreakers
	})
}

func localDataWith(envs json.RawMessage) map[string]json.RawMessage {
	return map[string]json.RawMessage{
		"rollouts":     json.RawMessage(`{"items":[{"metadata":{"name":"hub-app","namespace":"default"}}]}`),
		"environments": envs,
	}
}

// THE regression test. Before the fix, every /api/rollouts paid the full
// fetchSpoke timeout against a dead spoke — for every request, forever,
// because nothing remembered the previous timeout. After the fix the first
// request bounds its own wait at the cold-start grace window, and once the
// breaker opens the cost goes to roughly nothing.
func TestFanOutDoesNotBlockOnADeadSpoke(t *testing.T) {
	dead := hangingSpoke(t)
	swapFanoutState(t, 200*time.Millisecond)

	localURL := "https://kuberik.hub.example"
	envs := envsWithSpoke(localURL, dead.URL)

	// First request: bounded by the cold grace window, NOT by spokeFetchTimeout.
	start := time.Now()
	merged, _, _ := fanOutRollouts(context.Background(), localDataWith(envs), localURL, "")
	firstElapsed := time.Since(start)

	if firstElapsed > spokeFetchTimeout {
		t.Fatalf("cold request took %v — it waited on the dead spoke's full %v timeout",
			firstElapsed, spokeFetchTimeout)
	}
	// Local data must still be there and correctly attributed.
	if merged["rollouts"] == nil {
		t.Fatal("local rollouts were dropped when the spoke failed")
	}
	if !jsonHasName(t, merged["rollouts"], "hub-app") {
		t.Fatalf("local rollout missing from merged output: %s", merged["rollouts"])
	}

	// Let the abandoned fetches fail so the breaker learns.
	waitForBreakerOpen(t, dead.URL, 6*time.Second)

	// Subsequent requests must be effectively free.
	start = time.Now()
	fanOutRollouts(context.Background(), localDataWith(envs), localURL, "")
	if elapsed := time.Since(start); elapsed > 150*time.Millisecond {
		t.Fatalf("request with an OPEN breaker took %v; a known-dead spoke must cost ~nothing", elapsed)
	}
}

// A dead spoke must not take a healthy one down with it: the healthy
// cluster's rollouts still have to arrive.
func TestFanOutServesHealthySpokeDespiteDeadOne(t *testing.T) {
	dead := hangingSpoke(t)
	healthy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/cluster" {
			fmt.Fprint(w, `{"name":"good"}`)
			return
		}
		fmt.Fprint(w, `{"rollouts":{"items":[{"metadata":{"name":"spoke-app","namespace":"default"}}]}}`)
	}))
	defer healthy.Close()

	swapFanoutState(t, 2*time.Second)

	localURL := "https://kuberik.hub.example"
	envs := json.RawMessage(fmt.Sprintf(`{"items":[{
		"metadata":{"name":"app","namespace":"default"},
		"spec":{"environment":"prod"},
		"status":{"environmentInfos":[
			{"environment":"prod","environmentUrl":%q},
			{"environment":"dev","environmentUrl":%q},
			{"environment":"stress","environmentUrl":%q}
		]}
	}]}`, localURL, healthy.URL, dead.URL))

	merged, clusters, _ := fanOutRollouts(context.Background(), localDataWith(envs), localURL, "")

	if !jsonHasName(t, merged["rollouts"], "hub-app") {
		t.Fatalf("hub rollout missing: %s", merged["rollouts"])
	}
	if !jsonHasName(t, merged["rollouts"], "spoke-app") {
		t.Fatalf("healthy spoke's rollout missing — one dead spoke starved a live one: %s", merged["rollouts"])
	}
	var names []string
	for _, c := range clusters {
		names = append(names, c.Name)
	}
	if len(names) != 1 || names[0] != "good" {
		t.Fatalf("clusters = %v, want just the healthy spoke", names)
	}
}

// A cold-start miss is transient, not a failure — surfacing it as a
// clusterError would put a red banner in front of the user for a spoke that
// is merely slower than the grace window.
func TestColdStartMissIsNotReportedAsAClusterError(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(400 * time.Millisecond)
		fmt.Fprint(w, `{"rollouts":{"items":[]}}`)
	}))
	defer slow.Close()

	swapFanoutState(t, 50*time.Millisecond)

	localURL := "https://kuberik.hub.example"
	envs := envsWithSpoke(localURL, slow.URL)

	_, _, clusterErrors := fanOutRollouts(context.Background(), localDataWith(envs), localURL, "")
	for _, ce := range clusterErrors {
		if ce.URL == slow.URL {
			t.Fatalf("cold-start miss surfaced as a cluster error: %q", ce.Error)
		}
	}
}

// A genuinely unreachable spoke DOES still have to be reported, or an
// operator has no way to see that a cluster is missing from the fleet view.
func TestDeadSpokeIsStillReportedOnceKnownDead(t *testing.T) {
	dead := hangingSpoke(t)
	swapFanoutState(t, 100*time.Millisecond)

	localURL := "https://kuberik.hub.example"
	envs := envsWithSpoke(localURL, dead.URL)

	fanOutRollouts(context.Background(), localDataWith(envs), localURL, "")
	waitForBreakerOpen(t, dead.URL, 6*time.Second)

	var found bool
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && !found {
		_, _, clusterErrors := fanOutRollouts(context.Background(), localDataWith(envs), localURL, "")
		for _, ce := range clusterErrors {
			if ce.URL == dead.URL {
				found = true
			}
		}
		if !found {
			time.Sleep(50 * time.Millisecond)
		}
	}
	if !found {
		t.Fatal("an unreachable spoke was silently omitted; operators need to see it is down")
	}
}

// Opening the event stream must not wait on spoke discovery.
func TestNonBlockingDiscoveryDoesNotTouchTheNetwork(t *testing.T) {
	dead := hangingSpoke(t)
	swapFanoutState(t, 2*time.Second)

	localURL := "https://kuberik.hub.example"
	envs := envsWithSpoke(localURL, dead.URL)

	start := time.Now()
	clusters := discoverClustersNonBlocking(context.Background(), envs, localURL, "")
	elapsed := time.Since(start)

	if elapsed > 100*time.Millisecond {
		t.Fatalf("discovery took %v; the SSE stream's first byte must not wait on a spoke", elapsed)
	}
	if len(clusters) != 1 {
		t.Fatalf("clusters = %v, want the spoke listed under its fallback name", clusters)
	}
	if clusters[0].URL != dead.URL {
		t.Fatalf("clusters[0].URL = %q, want %q", clusters[0].URL, dead.URL)
	}
}

func waitForBreakerOpen(t *testing.T, url string, within time.Duration) {
	t.Helper()
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		if breakers.isOpen(url) {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("breaker for %s never opened within %v", url, within)
}

func jsonHasName(t *testing.T, raw json.RawMessage, name string) bool {
	t.Helper()
	var list struct {
		Items []struct {
			Metadata struct {
				Name string `json:"name"`
			} `json:"metadata"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		t.Fatalf("unmarshal list: %v", err)
	}
	for _, it := range list.Items {
		if it.Metadata.Name == name {
			return true
		}
	}
	return false
}
