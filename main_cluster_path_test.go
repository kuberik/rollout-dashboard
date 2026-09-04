package main

import (
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// PERF/ROUTING-2026-09-04 Part 1: GET|POST /api/clusters/:cluster/<rest> is
// the path form of /api/<rest>?cluster=:cluster. These tests exercise the
// real production wiring — ClusterPathRewriteHandler(setupRouter()), exactly
// what main() serves — rather than reimplementing splitClusterPath's logic
// in the test.

// resetClusterPathTestState clears the two pieces of global state these
// tests depend on so test order never leaks between them: the spoke name→URL
// registry (main_registry.go) and the deprecated-?cluster=-alias log-once
// gate (main_proxy.go).
func resetClusterPathTestState(t *testing.T) {
	t.Helper()
	registry.put(nil)
	deprecatedClusterQueryAliasOnce = sync.Once{}
}

func TestClusterPathRewrite_HubLocalPathForm(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetClusterPathTestState(t)
	t.Setenv("CLUSTER_NAME", "hub1")

	objs := []client.Object{
		rolloutObj("team-a", "app-1"),
		rolloutObj("team-b", "app-2"),
	}
	fakeClient, err := kubernetes.NewTestClient(objs...)
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}
	restore := kubernetes.SetReadClientForTest(fakeClient)
	defer restore()

	handler := ClusterPathRewriteHandler(setupRouter())

	req := httptest.NewRequest("GET", "/api/clusters/hub1/rollouts", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !contains(body, "app-1") || !contains(body, "app-2") {
		t.Fatalf("expected both rollouts in the hub-local path-form response, got: %s", body)
	}
}

func TestClusterPathRewrite_SpokeProxyPathForm(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetClusterPathTestState(t)
	t.Setenv("CLUSTER_NAME", "hub1")

	spoke := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/rollouts" {
			t.Errorf("spoke received unexpected path %q (cluster prefix not stripped correctly)", r.URL.Path)
		}
		if r.URL.Query().Get("cluster") != "" {
			t.Errorf("spoke should never see a cluster= query param forwarded to it (proxyToRemote strips it), got %q", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"rollouts":{"items":[{"metadata":{"namespace":"dev","name":"spoke-app"}}]}}`))
	}))
	defer spoke.Close()

	registry.put([]ClusterInfo{{Name: "spoke1", URL: spoke.URL}})

	// No k8s read client fixture needed: SpokeProxyMiddleware resolves
	// "spoke1" from the registry (fresh, just populated above) and aborts
	// into proxyToRemote before the local /api/rollouts handler ever runs.
	handler := ClusterPathRewriteHandler(setupRouter())

	req := httptest.NewRequest("GET", "/api/clusters/spoke1/rollouts", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	if !contains(w.Body.String(), "spoke-app") {
		t.Fatalf("expected the spoke's own response body to be relayed back, got: %s", w.Body.String())
	}
}

func TestClusterPathRewrite_UnknownCluster(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetClusterPathTestState(t)
	t.Setenv("CLUSTER_NAME", "hub1")

	// A read client with zero Environments means resolveClusterURL's
	// fallback discovery finds no spokes either — "ghost" resolves to
	// nothing, exactly as an unregistered ?cluster=ghost does today.
	fakeClient, err := kubernetes.NewTestClient()
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}
	restore := kubernetes.SetReadClientForTest(fakeClient)
	defer restore()

	handler := ClusterPathRewriteHandler(setupRouter())

	req := httptest.NewRequest("GET", "/api/clusters/ghost/rollouts", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502 (body: %s)", w.Code, w.Body.String())
	}
	if !contains(w.Body.String(), "unknown or unreachable cluster") {
		t.Fatalf("expected the same 'unknown or unreachable cluster' error the query form gives, got: %s", w.Body.String())
	}
}

func TestClusterPathRewrite_EventsStreamPathFormRejectedWith404(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetClusterPathTestState(t)
	t.Setenv("CLUSTER_NAME", "hub1")

	handler := ClusterPathRewriteHandler(setupRouter())

	req := httptest.NewRequest("GET", "/api/clusters/hub1/events/stream", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 — /api/clusters/:cluster/events/stream must never be offered", w.Code)
	}
}

func TestClusterPathRewrite_DeprecatedQueryAliasStillWorksAndLogsOnce(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetClusterPathTestState(t)
	t.Setenv("CLUSTER_NAME", "hub1")

	fakeClient, err := kubernetes.NewTestClient(rolloutObj("team-a", "app-1"))
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}
	restore := kubernetes.SetReadClientForTest(fakeClient)
	defer restore()

	var logBuf strings.Builder
	origOutput := log.Writer()
	log.SetOutput(&logBuf)
	defer log.SetOutput(origOutput)

	handler := ClusterPathRewriteHandler(setupRouter())

	do := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "/api/rollouts?cluster=hub1", nil)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}

	w1 := do()
	if w1.Code != http.StatusOK {
		t.Fatalf("query-form alias: status = %d, want 200 (body: %s)", w1.Code, w1.Body.String())
	}
	if !contains(w1.Body.String(), "app-1") {
		t.Fatalf("query-form alias: expected the rollout in the response, got: %s", w1.Body.String())
	}
	if !contains(logBuf.String(), "deprecated ?cluster=") {
		t.Fatalf("expected a deprecation log line after the first ?cluster= request, got log: %s", logBuf.String())
	}

	logBuf.Reset()
	w2 := do()
	if w2.Code != http.StatusOK {
		t.Fatalf("second query-form call: status = %d, want 200", w2.Code)
	}
	if contains(logBuf.String(), "deprecated ?cluster=") {
		t.Fatalf("expected the deprecation line to log only once per process, got a second one: %s", logBuf.String())
	}
}

func TestClusterPathRewrite_PrefixStrippedWithOwnQueryString(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetClusterPathTestState(t)
	t.Setenv("CLUSTER_NAME", "hub1")

	objs := []client.Object{
		rolloutObj("team-a", "app-1"),
		rolloutObj("team-b", "app-2"),
	}
	fakeClient, err := kubernetes.NewTestClient(objs...)
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}
	restore := kubernetes.SetReadClientForTest(fakeClient)
	defer restore()

	handler := ClusterPathRewriteHandler(setupRouter())

	// The path-form prefix must be stripped without disturbing rollouts'
	// OWN ?namespace= query parameter — the rewrite has to merge cluster=
	// into the existing query string, not replace it.
	req := httptest.NewRequest("GET", "/api/clusters/hub1/rollouts?namespace=team-a", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !contains(body, "app-1") {
		t.Fatalf("expected team-a's rollout in a namespace=team-a-filtered response, got: %s", body)
	}
	if contains(body, "app-2") {
		t.Fatalf("expected team-b's rollout to be excluded by namespace=team-a, got: %s", body)
	}
}

func TestClusterPathRewrite_POSTBodyForwarded(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetClusterPathTestState(t)
	t.Setenv("CLUSTER_NAME", "hub1")

	const sentBody = `{"version":"v2.0.0"}`
	var gotBody string
	var gotMethod string
	spoke := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true}`))
	}))
	defer spoke.Close()

	registry.put([]ClusterInfo{{Name: "spoke1", URL: spoke.URL}})

	handler := ClusterPathRewriteHandler(setupRouter())

	// Route through a real registered POST route (/pin) so gin actually
	// matches and enters the api group's middleware chain — SpokeProxyMiddleware
	// aborts into proxyToRemote before the real pin handler (which would need
	// a write client) ever runs.
	req := httptest.NewRequest("POST", "/api/clusters/spoke1/rollouts/team-a/app-1/pin", strings.NewReader(sentBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	if gotMethod != "POST" {
		t.Fatalf("spoke saw method %q, want POST", gotMethod)
	}
	if gotBody != sentBody {
		t.Fatalf("spoke saw body %q, want %q — POST body must be forwarded intact", gotBody, sentBody)
	}
}

// Direct unit coverage of splitClusterPath's edge cases, independent of the
// full router.
func TestSplitClusterPath(t *testing.T) {
	cases := []struct {
		path        string
		wantRest    string
		wantCluster string
		wantOK      bool
	}{
		{"/api/clusters/prod/rollouts", "/rollouts", "prod", true},
		{"/api/clusters/prod/rollouts/ns1/app1/pin", "/rollouts/ns1/app1/pin", "prod", true},
		{"/api/clusters/prod", "", "", false},
		{"/api/clusters/prod/", "", "", false},
		{"/api/clusters//rollouts", "", "", false},
		{"/api/rollouts", "", "", false},
		{"/api/clusters", "", "", false},
	}
	for _, tc := range cases {
		rest, cluster, ok := splitClusterPath(tc.path)
		if ok != tc.wantOK || rest != tc.wantRest || cluster != tc.wantCluster {
			t.Errorf("splitClusterPath(%q) = (%q, %q, %v), want (%q, %q, %v)",
				tc.path, rest, cluster, ok, tc.wantRest, tc.wantCluster, tc.wantOK)
		}
	}
}
