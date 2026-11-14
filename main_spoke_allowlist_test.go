package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
)

// recordingSpoke counts every request and records credentials it receives.
type recordingSpoke struct {
	*httptest.Server
	hits    atomic.Int64
	cookie  atomic.Value // string
	authHdr atomic.Value // string
}

func newRecordingSpoke(t *testing.T) *recordingSpoke {
	t.Helper()
	rs := &recordingSpoke{}
	rs.cookie.Store("")
	rs.authHdr.Store("")
	rs.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rs.hits.Add(1)
		rs.cookie.Store(r.Header.Get("Cookie"))
		rs.authHdr.Store(r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"name":"evil","clusterName":"evil","rollouts":{"items":[]}}`))
	}))
	t.Cleanup(rs.Close)
	return rs
}

// (b) origin matching edge cases.
func TestSpokeURLAllowed_OriginMatching(t *testing.T) {
	useRealSpokeAllowlist(t, "https://good.com, http://plain.internal:8080, https://*.example.com, https://port.test:8443")
	cases := []struct {
		url  string
		want bool
	}{
		{"https://good.com", true},
		{"https://good.com/api/x?y=1", true},
		{"https://GOOD.com", true},
		{"https://good.com.", true},
		{"https://good.com:443", true},
		{"https://good.com:444", false},
		{"http://good.com", false},              // scheme downgrade
		{"https://good.com.evil.com", false},    // prefix attack
		{"https://evilgood.com", false},         // suffix attack, non-wildcard
		{"https://good.com@evil.com", false},    // userinfo confusion
		{"https://good.com:pw@good.com", false}, // userinfo rejected outright
		{"https://evil.com#@good.com", false},   // fragment confusion
		{"https://evil.com/?good.com", false},
		{"http://plain.internal:8080", true}, // http only when listed
		{"https://plain.internal:8080", false},
		{"http://plain.internal", false}, // default port != 8080
		{"https://a.example.com", true},
		{"https://a.b.example.com", true},
		{"https://example.com", false}, // wildcard needs a label
		{"https://.example.com", false},
		{"https://evilexample.com", false},
		{"https://a.example.com.evil.com", false},
		{"http://a.example.com", false},
		{"https://port.test:8443", true},
		{"https://port.test", false},
		{"", false},
		{"not a url", false},
		{"//good.com", false},
	}
	for _, tc := range cases {
		if got := spokeURLAllowed(tc.url); got != tc.want {
			t.Errorf("spokeURLAllowed(%q) = %v, want %v", tc.url, got, tc.want)
		}
	}
}

func TestSpokeURLAllowed_FailsClosedWhenUnset(t *testing.T) {
	useRealSpokeAllowlist(t, "")
	for _, u := range []string{"https://good.com", "http://127.0.0.1:1"} {
		if spokeURLAllowed(u) {
			t.Errorf("%q allowed with empty allowlist", u)
		}
	}
	// Malformed entries never widen the list.
	useRealSpokeAllowlist(t, "good.com, ftp://good.com, https://*, https://good.com/path, *")
	if spokeURLAllowed("https://good.com") || spokeURLAllowed("https://anything.io") {
		t.Error("malformed entries must be ignored")
	}
}

// (a) discovery drops a non-allowlisted URL and never probes it.
func TestDiscovery_DropsAndNeverProbesNonAllowlisted(t *testing.T) {
	swapFanoutState(t, 0)
	evil := newRecordingSpoke(t)
	good := newRecordingSpoke(t)
	useRealSpokeAllowlist(t, good.URL)
	localURL := "https://kuberik.hub.example"

	envs := envsWithSpoke(localURL, evil.URL)
	if got := discoverClusters(context.Background(), envs, localURL, "tok"); len(got) != 0 {
		t.Fatalf("discoverClusters returned %v", got)
	}
	if got := discoverClustersNonBlocking(context.Background(), envs, localURL, "tok"); len(got) != 0 {
		t.Fatalf("discoverClustersNonBlocking returned %v", got)
	}
	waitForFanoutBackground()
	if n := evil.hits.Load(); n != 0 {
		t.Fatalf("non-allowlisted spoke was probed %d times", n)
	}

	// Allowlisted spoke still discovered.
	envs = envsWithSpoke(localURL, good.URL)
	if got := discoverClusters(context.Background(), envs, localURL, "tok"); len(got) != 1 || got[0].URL != good.URL {
		t.Fatalf("allowlisted spoke not discovered: %v", got)
	}
}

// registry.put is itself a choke point.
func TestRegistryPutRejectsNonAllowlisted(t *testing.T) {
	evil := newRecordingSpoke(t)
	good := newRecordingSpoke(t)
	useRealSpokeAllowlist(t, good.URL)
	registry.put([]ClusterInfo{{Name: "evil", URL: evil.URL}, {Name: "good", URL: good.URL}})
	if _, ok, _ := registry.lookup("evil"); ok {
		t.Fatal("registry cached a non-allowlisted spoke")
	}
	if _, ok, _ := registry.lookup("good"); !ok {
		t.Fatal("registry dropped an allowlisted spoke")
	}
	registry.put(nil)
}

// (c) proxy cookie handling.
func proxyRequest(t *testing.T, base string, cookies ...*http.Cookie) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/x", func(c *gin.Context) { proxyToRemote(c, base) })
	req := httptest.NewRequest(http.MethodGet, "/api/x", nil)
	for _, ck := range cookies {
		req.AddCookie(ck)
	}
	req.Header.Set("Authorization", "Bearer ambient-from-browser")
	r.ServeHTTP(httptest.NewRecorder(), req)
}

func TestProxy_ForwardsOnlyGhTokenCookieToAllowlisted(t *testing.T) {
	spoke := newRecordingSpoke(t)
	useRealSpokeAllowlist(t, spoke.URL)
	proxyRequest(t, spoke.URL,
		&http.Cookie{Name: "gh_token", Value: "ghu_secret"},
		&http.Cookie{Name: "session", Value: "hub-session"},
		&http.Cookie{Name: "IdToken", Value: "oidc"},
	)
	if got := spoke.cookie.Load().(string); got != "gh_token=ghu_secret" {
		t.Fatalf("spoke saw Cookie %q, want only gh_token", got)
	}
	if got := spoke.authHdr.Load().(string); got == "Bearer ambient-from-browser" {
		t.Fatalf("spoke received the browser's raw Authorization header")
	}
}

func TestProxy_NeverReachesNonAllowlisted(t *testing.T) {
	evil := newRecordingSpoke(t)
	useRealSpokeAllowlist(t, "https://other.example")
	proxyRequest(t, evil.URL, &http.Cookie{Name: "gh_token", Value: "ghu_secret"})
	if n := evil.hits.Load(); n != 0 {
		t.Fatalf("proxy reached non-allowlisted spoke (%d hits, Cookie %q)", n, evil.cookie.Load())
	}
}

// (d) fan-out and SSE discovery never reach a non-allowlisted URL.
func TestFanOutAndSSEDiscoveryNeverReachNonAllowlisted(t *testing.T) {
	swapFanoutState(t, 0)
	evil := newRecordingSpoke(t)
	useRealSpokeAllowlist(t, "https://other.example")
	localURL := "https://kuberik.hub.example"
	envs := envsWithSpoke(localURL, evil.URL)

	_, clusters, _ := fanOutRollouts(context.Background(), localDataWith(envs), localURL, "viewer-token")
	if len(clusters) != 0 {
		t.Fatalf("fan-out listed %v", clusters)
	}
	if got := discoverClustersNonBlocking(context.Background(), envs, localURL, "viewer-token"); len(got) != 0 {
		t.Fatalf("SSE discovery returned %v", got)
	}
	// Direct fetches (defense in depth) refuse too.
	if _, err := doFetchSpoke(context.Background(), evil.URL, "/api/rollouts", "viewer-token"); err == nil {
		t.Fatal("doFetchSpoke reached a non-allowlisted spoke")
	}
	if _, err := doFetchSpokeClusterName(context.Background(), evil.URL, "viewer-token"); err == nil {
		t.Fatal("doFetchSpokeClusterName reached a non-allowlisted spoke")
	}
	waitForFanoutBackground()
	if n := evil.hits.Load(); n != 0 {
		t.Fatalf("evil spoke got %d hits (Authorization %q)", n, evil.authHdr.Load())
	}
}
