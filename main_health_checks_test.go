package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	envv1alpha1 "github.com/kuberik/environment-controller/api/v1alpha1"
	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/interceptor"
)

// ---- fixtures ----

func hcRollout(ns, name string, sel *rolloutv1alpha1.HealthCheckSelectorConfig) *rolloutv1alpha1.Rollout {
	r := rolloutObj(ns, name)
	r.Spec.HealthCheckSelector = sel
	return r
}

func hcObj(ns, name string, lbls map[string]string) *rolloutv1alpha1.HealthCheck {
	return &rolloutv1alpha1.HealthCheck{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name, Labels: lbls}}
}

func nsObj(name string, lbls map[string]string) *corev1.Namespace {
	return &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: name, Labels: lbls}}
}

func labelSel(kv ...string) *metav1.LabelSelector {
	m := map[string]string{}
	for i := 0; i+1 < len(kv); i += 2 {
		m[kv[i]] = kv[i+1]
	}
	return &metav1.LabelSelector{MatchLabels: m}
}

// envObj is a local Environment whose status names this dashboard (prod) and
// the given spokes, so fanOut discovers them.
func envObj(ns, localURL string, spokeURLs ...string) *envv1alpha1.Environment {
	e := &envv1alpha1.Environment{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: "app"}}
	e.Spec.Environment = "prod"
	e.Status.EnvironmentInfos = []envv1alpha1.EnvironmentInfo{{Environment: "prod", EnvironmentURL: localURL}}
	for i, u := range spokeURLs {
		e.Status.EnvironmentInfos = append(e.Status.EnvironmentInfos,
			envv1alpha1.EnvironmentInfo{Environment: fmt.Sprintf("spoke-%d", i), EnvironmentURL: u})
	}
	return e
}

type hcItem struct {
	Metadata struct {
		Namespace   string            `json:"namespace"`
		Name        string            `json:"name"`
		Annotations map[string]string `json:"annotations"`
	} `json:"metadata"`
	HealthChecks []json.RawMessage `json:"healthChecks"`
}

type hcResponse struct {
	RolloutHealthChecks struct {
		Items []hcItem `json:"items"`
	} `json:"rolloutHealthChecks"`
	Clusters      []ClusterInfo  `json:"clusters"`
	ClusterErrors []ClusterError `json:"clusterErrors"`
	PartialReads  []string       `json:"partialReads"`
}

func withHCReadClient(t *testing.T, funcs *interceptor.Funcs, objs ...client.Object) {
	t.Helper()
	var (
		cl  *kubernetes.Client
		err error
	)
	if funcs != nil {
		cl, err = kubernetes.NewTestClientWithInterceptor(*funcs, objs...)
	} else {
		cl, err = kubernetes.NewTestClient(objs...)
	}
	if err != nil {
		t.Fatalf("test client: %v", err)
	}
	t.Cleanup(kubernetes.SetReadClientForTest(cl))
}

func getHealthChecks(t *testing.T, path string, hdr map[string]string) (int, hcResponse, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	ClusterPathRewriteHandler(setupRouter()).ServeHTTP(w, req)
	var body hcResponse
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("unmarshal %s: %v (%s)", path, err, w.Body.String())
		}
	}
	return w.Code, body, w.Body.String()
}

func itemKeys(items []hcItem) []string {
	var out []string
	for _, it := range items {
		out = append(out, it.Metadata.Namespace+"/"+it.Metadata.Name)
	}
	sort.Strings(out)
	return out
}

func hcNames(raws []json.RawMessage) []string {
	out := []string{}
	for _, r := range raws {
		var hc rolloutv1alpha1.HealthCheck
		_ = json.Unmarshal(r, &hc)
		out = append(out, hc.Namespace+"/"+hc.Name)
	}
	return out
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// hcIsolation gives a test a fresh name, no spokes, no leaked fan-out state.
func hcIsolation(t *testing.T) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	resetClusterPathTestState(t)
	t.Setenv("CLUSTER_NAME", "hub1")
	t.Setenv("DASHBOARD_URL", "https://kuberik.hub1.example")
	swapFanoutState(t, 2*time.Second)
	prev := spokeHealthCheckCache
	spokeHealthCheckCache = newSWRCache[map[string]json.RawMessage](spokeDataTTL, 2*time.Second, 4*time.Second)
	t.Cleanup(func() { waitForFanoutBackground(); spokeHealthCheckCache = prev })
}

// ---- visibility ----

// One item per rollout the caller may see that has a selector: the same
// per-namespace "list rollouts" trim /api/rollouts applies. A rollout with
// no selector has no item at all, visible or not.
func TestFleetHealthChecks_Visibility(t *testing.T) {
	sel := &rolloutv1alpha1.HealthCheckSelectorConfig{Selector: labelSel("app", "web")}
	objs := []client.Object{
		hcRollout("team-a", "web", sel),
		hcRollout("team-a", "bare", nil),
		hcRollout("team-b", "web", sel),
		hcObj("team-a", "a-latency", map[string]string{"app": "web"}),
		hcObj("team-b", "b-latency", map[string]string{"app": "web"}),
	}

	cases := []struct {
		name    string
		token   string
		allowed map[string]bool
		want    []string
	}{
		{"no token sees every namespace", "", nil, []string{"team-a/web", "team-b/web"}},
		{"token limited to team-a", "tok-team-a", map[string]bool{"team-a": true}, []string{"team-a/web"}},
		{"token that sees nothing", "tok-none", map[string]bool{}, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			hcIsolation(t)
			withHCReadClient(t, nil, objs...)
			t.Cleanup(kubernetes.SetListRolloutsPermissionCheckForTest(func(_ *gin.Context, ns string) (bool, error) {
				return tc.allowed[ns], nil
			}))
			hdr := map[string]string{}
			if tc.token != "" {
				hdr["Authorization"] = "Bearer " + tc.token
			}
			code, body, raw := getHealthChecks(t, "/api/health-checks", hdr)
			if code != http.StatusOK {
				t.Fatalf("status %d: %s", code, raw)
			}
			if got := itemKeys(body.RolloutHealthChecks.Items); !equalStrings(got, tc.want) {
				t.Fatalf("items = %v, want %v", got, tc.want)
			}
			for _, it := range body.RolloutHealthChecks.Items {
				if it.Metadata.Annotations[sourceClusterAnnotation] != "hub1" {
					t.Fatalf("%s/%s source-cluster = %q, want hub1", it.Metadata.Namespace, it.Metadata.Name, it.Metadata.Annotations[sourceClusterAnnotation])
				}
			}
			if body.PartialReads != nil {
				t.Fatalf("partialReads = %v on a healthy read", body.PartialReads)
			}
		})
	}
}

// A visibility check that errors is an upstream failure, not an empty fleet.
func TestFleetHealthChecks_VisibilityErrorIsNotEmpty(t *testing.T) {
	hcIsolation(t)
	withHCReadClient(t, nil, hcRollout("team-a", "web", &rolloutv1alpha1.HealthCheckSelectorConfig{}))
	t.Cleanup(kubernetes.SetListRolloutsPermissionCheckForTest(func(_ *gin.Context, _ string) (bool, error) {
		return false, errors.New("ssar down")
	}))
	code, _, raw := getHealthChecks(t, "/api/health-checks", map[string]string{"Authorization": "Bearer tok-err"})
	if code < 500 {
		t.Fatalf("status %d (%s), want a 5xx", code, raw)
	}
}

// ---- parity with the per-rollout endpoint ----

// Every item's healthChecks is exactly what
// GET /api/rollouts/:ns/:name/health-checks returns for that rollout, across
// the selector shapes that endpoint handles: label selector, no label
// selector, a namespace selector reaching other namespaces, and a selector
// matching nothing. The Namespace List behind namespace selectors is paid
// once per request, not once per rollout.
func TestFleetHealthChecks_ParityWithPerRolloutEndpoint(t *testing.T) {
	hcIsolation(t)
	objs := []client.Object{
		nsObj("team-a", map[string]string{"tier": "web"}),
		nsObj("team-b", map[string]string{"tier": "web"}),
		nsObj("ops", nil),
		hcRollout("team-a", "labelled", &rolloutv1alpha1.HealthCheckSelectorConfig{Selector: labelSel("app", "web")}),
		hcRollout("team-a", "everything", &rolloutv1alpha1.HealthCheckSelectorConfig{}),
		hcRollout("team-a", "cross-ns", &rolloutv1alpha1.HealthCheckSelectorConfig{
			Selector: labelSel("app", "web"), NamespaceSelector: labelSel("tier", "web")}),
		hcRollout("ops", "cross-ns-2", &rolloutv1alpha1.HealthCheckSelectorConfig{
			NamespaceSelector: labelSel("tier", "web")}),
		hcRollout("team-b", "nothing", &rolloutv1alpha1.HealthCheckSelectorConfig{Selector: labelSel("app", "absent")}),
		hcObj("team-a", "a-web", map[string]string{"app": "web"}),
		hcObj("team-a", "a-db", map[string]string{"app": "db"}),
		hcObj("team-b", "b-web", map[string]string{"app": "web"}),
		hcObj("ops", "ops-web", map[string]string{"app": "web"}),
	}
	var nsLists atomic.Int32
	funcs := interceptor.Funcs{
		List: func(ctx context.Context, c client.WithWatch, list client.ObjectList, opts ...client.ListOption) error {
			if _, ok := list.(*corev1.NamespaceList); ok {
				nsLists.Add(1)
			}
			return c.List(ctx, list, opts...)
		},
	}
	withHCReadClient(t, &funcs, objs...)

	code, body, raw := getHealthChecks(t, "/api/health-checks", nil)
	if code != http.StatusOK {
		t.Fatalf("status %d: %s", code, raw)
	}
	if n := nsLists.Load(); n != 1 {
		t.Fatalf("NamespaceList called %d times for one request, want 1", n)
	}
	want := map[string][]string{
		"team-a/labelled":   {"team-a/a-web"},
		"team-a/everything": {"team-a/a-db", "team-a/a-web"},
		"team-a/cross-ns":   {"team-a/a-web", "team-b/b-web"},
		"ops/cross-ns-2":    {"team-a/a-db", "team-a/a-web", "team-b/b-web"},
		"team-b/nothing":    {},
	}
	if len(body.RolloutHealthChecks.Items) != len(want) {
		t.Fatalf("items = %v, want %d", itemKeys(body.RolloutHealthChecks.Items), len(want))
	}
	r := setupRouter()
	for _, it := range body.RolloutHealthChecks.Items {
		key := it.Metadata.Namespace + "/" + it.Metadata.Name
		got := hcNames(it.HealthChecks)
		if !equalStrings(got, want[key]) {
			t.Errorf("%s: healthChecks = %v, want %v", key, got, want[key])
		}
		if it.HealthChecks == nil {
			t.Errorf("%s: healthChecks is null, want a list", key)
		}

		req := httptest.NewRequest(http.MethodGet, "/api/rollouts/"+key+"/health-checks", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("per-rollout %s: %d %s", key, w.Code, w.Body.String())
		}
		var per struct {
			HealthChecks []json.RawMessage `json:"healthChecks"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &per); err != nil {
			t.Fatalf("per-rollout %s: %v", key, err)
		}
		if len(per.HealthChecks) != len(it.HealthChecks) {
			t.Errorf("%s: fleet has %d checks, per-rollout endpoint %d", key, len(it.HealthChecks), len(per.HealthChecks))
			continue
		}
		// Semantic equality: the hub's source annotation round-trips items
		// through a map, which reorders object keys, never values.
		for i := range per.HealthChecks {
			var a, b interface{}
			_ = json.Unmarshal(per.HealthChecks[i], &a)
			_ = json.Unmarshal(it.HealthChecks[i], &b)
			if !reflect.DeepEqual(a, b) {
				t.Errorf("%s[%d]: fleet %s != per-rollout %s", key, i, it.HealthChecks[i], per.HealthChecks[i])
			}
		}
	}
}

// ---- partial read ----

// A HealthCheck List that fails in one namespace names that namespace in
// partialReads (qualified by cluster) and leaves out only the rollouts whose
// answer depended on it: never an item with a silently short list.
func TestFleetHealthChecks_PartialRead(t *testing.T) {
	hcIsolation(t)
	sel := &rolloutv1alpha1.HealthCheckSelectorConfig{}
	objs := []client.Object{
		hcRollout("team-a", "web", sel),
		hcRollout("team-b", "web", sel),
		hcObj("team-a", "a-web", nil),
		hcObj("team-b", "b-web", nil),
	}
	funcs := interceptor.Funcs{
		List: func(ctx context.Context, c client.WithWatch, list client.ObjectList, opts ...client.ListOption) error {
			if _, ok := list.(*rolloutv1alpha1.HealthCheckList); ok {
				lo := &client.ListOptions{}
				lo.ApplyOptions(opts)
				if lo.Namespace == "team-b" {
					return errors.New("informer not synced")
				}
			}
			return c.List(ctx, list, opts...)
		},
	}
	withHCReadClient(t, &funcs, objs...)

	for _, tc := range []struct {
		name        string
		hdr         map[string]string
		wantPartial []string
	}{
		{"hub qualifies the namespace", nil, []string{"hub1/team-b"}},
		{"leg reports it bare for the hub", map[string]string{fanoutHeader: "1"}, []string{"team-b"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			code, body, raw := getHealthChecks(t, "/api/health-checks", tc.hdr)
			if code != http.StatusOK {
				t.Fatalf("status %d: %s", code, raw)
			}
			if got := itemKeys(body.RolloutHealthChecks.Items); !equalStrings(got, []string{"team-a/web"}) {
				t.Fatalf("items = %v, want only team-a/web", got)
			}
			if !equalStrings(body.PartialReads, tc.wantPartial) {
				t.Fatalf("partialReads = %v, want %v", body.PartialReads, tc.wantPartial)
			}
		})
	}
}

// The rollouts List failing is the whole answer failing: writeUpstreamError.
func TestFleetHealthChecks_RolloutsListFailure(t *testing.T) {
	hcIsolation(t)
	funcs := interceptor.Funcs{
		List: func(ctx context.Context, c client.WithWatch, list client.ObjectList, opts ...client.ListOption) error {
			if _, ok := list.(*rolloutv1alpha1.RolloutList); ok {
				return errors.New("apiserver unavailable")
			}
			return c.List(ctx, list, opts...)
		},
	}
	withHCReadClient(t, &funcs)
	code, _, raw := getHealthChecks(t, "/api/health-checks", nil)
	if code != http.StatusInternalServerError || !contains(raw, "Failed to fetch health checks") {
		t.Fatalf("status %d body %s, want 500 Failed to fetch health checks", code, raw)
	}
}

// ---- fan-in ----

// spokeServer answers /api/cluster and /api/health-checks like a spoke
// dashboard, and records what the hub asked it for.
func spokeServer(t *testing.T, name, body string, sawLeg *atomic.Bool) *httptest.Server {
	t.Helper()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/cluster":
			fmt.Fprintf(w, `{"name":%q}`, name)
		case "/api/health-checks":
			if r.Header.Get(fanoutHeader) != "" && sawLeg != nil {
				sawLeg.Store(true)
			}
			fmt.Fprint(w, body)
		default:
			t.Errorf("spoke %s asked for %s", name, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(s.Close)
	return s
}

func deadSpokeURL(t *testing.T) string {
	t.Helper()
	s := httptest.NewServer(http.NotFoundHandler())
	u := s.URL
	s.Close() // connection refused from here on: a transport failure
	return u
}

// The hub merges a live spoke's items (stamped with its cluster), reports a
// dead spoke in clusterErrors, carries the live spoke's partialReads under its
// name, and still serves its own items.
func TestFleetHealthChecks_HubMergeWithOneSpokeDown(t *testing.T) {
	hcIsolation(t)
	var sawLeg atomic.Bool
	good := spokeServer(t, "dev", `{"rolloutHealthChecks":{"items":[
		{"metadata":{"namespace":"web-dev","name":"web"},"healthChecks":[{"metadata":{"namespace":"web-dev","name":"dev-latency"}}]}
	]},"partialReads":["web-dev-b"]}`, &sawLeg)
	dead := deadSpokeURL(t)
	hubURL := "https://kuberik.hub1.example"

	withHCReadClient(t, nil,
		hcRollout("web-prod", "web", &rolloutv1alpha1.HealthCheckSelectorConfig{}),
		hcObj("web-prod", "prod-latency", nil),
		envObj("web-prod", hubURL, good.URL, dead),
	)

	code, body, raw := getHealthChecks(t, "/api/health-checks", nil)
	if code != http.StatusOK {
		t.Fatalf("status %d: %s", code, raw)
	}
	byCluster := map[string][]string{}
	for _, it := range body.RolloutHealthChecks.Items {
		c := it.Metadata.Annotations[sourceClusterAnnotation]
		byCluster[c] = append(byCluster[c], it.Metadata.Namespace+"/"+it.Metadata.Name+":"+fmt.Sprint(hcNames(it.HealthChecks)))
	}
	if !equalStrings(byCluster["hub1"], []string{"web-prod/web:[web-prod/prod-latency]"}) {
		t.Fatalf("hub items = %v", byCluster["hub1"])
	}
	if !equalStrings(byCluster["dev"], []string{"web-dev/web:[web-dev/dev-latency]"}) {
		t.Fatalf("spoke items = %v", byCluster["dev"])
	}
	if !sawLeg.Load() {
		t.Fatal("hub called the spoke without the fan-out header")
	}
	if len(body.Clusters) != 1 || body.Clusters[0].Name != "dev" {
		t.Fatalf("clusters = %+v, want [dev]", body.Clusters)
	}
	if len(body.ClusterErrors) != 1 || body.ClusterErrors[0].URL != dead {
		t.Fatalf("clusterErrors = %+v, want the dead spoke", body.ClusterErrors)
	}
	if !equalStrings(body.PartialReads, []string{"dev/web-dev-b"}) {
		t.Fatalf("partialReads = %v, want [dev/web-dev-b]", body.PartialReads)
	}

	// The rollouts fan-in keeps its own cache: nothing from this list leaked
	// into spokeDataCache under the same identity|url key.
	if _, ok := spokeDataCache.get(identityKey("") + "|" + good.URL); ok {
		t.Fatal("health-check payload landed in the /api/rollouts spoke cache")
	}
}

// A leg request answers with local data only, even when local Environments
// point at other dashboards: fanning out again would loop hub<->spoke.
func TestFleetHealthChecks_LegReturnsLocalOnly(t *testing.T) {
	hcIsolation(t)
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("a fan-out leg fanned out again: %s", r.URL.Path)
	}))
	t.Cleanup(other.Close)
	withHCReadClient(t, nil,
		hcRollout("web-dev", "web", &rolloutv1alpha1.HealthCheckSelectorConfig{}),
		envObj("web-dev", "https://kuberik.dev.example", other.URL),
	)

	req := httptest.NewRequest(http.MethodGet, "/api/health-checks", nil)
	req.Header.Set(fanoutHeader, "1")
	w := httptest.NewRecorder()
	setupRouter().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var body map[string]json.RawMessage
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	for _, k := range []string{"clusters", "clusterErrors", "partialReads"} {
		if _, ok := body[k]; ok {
			t.Fatalf("leg response carries %q: %s", k, w.Body.String())
		}
	}
	var list struct {
		Items []hcItem `json:"items"`
	}
	_ = json.Unmarshal(body["rolloutHealthChecks"], &list)
	if got := itemKeys(list.Items); !equalStrings(got, []string{"web-dev/web"}) {
		t.Fatalf("leg items = %v", got)
	}
	if len(list.Items[0].Metadata.Annotations) != 0 {
		t.Fatalf("leg stamped annotations itself; the hub does that: %v", list.Items[0].Metadata.Annotations)
	}
}

// /api/clusters/{local}/health-checks reaches the same handler through the
// cluster-path rewrite; /api/clusters/{spoke}/health-checks is proxied.
func TestFleetHealthChecks_ClusterPathForms(t *testing.T) {
	hcIsolation(t)
	withHCReadClient(t, nil, hcRollout("web-prod", "web", &rolloutv1alpha1.HealthCheckSelectorConfig{}))

	code, body, raw := getHealthChecks(t, "/api/clusters/hub1/health-checks", nil)
	if code != http.StatusOK || !equalStrings(itemKeys(body.RolloutHealthChecks.Items), []string{"web-prod/web"}) {
		t.Fatalf("hub-local path form: %d %s", code, raw)
	}

	spoke := spokeServer(t, "dev", `{"rolloutHealthChecks":{"items":[{"metadata":{"namespace":"web-dev","name":"web"},"healthChecks":[]}]}}`, nil)
	registry.put([]ClusterInfo{{Name: "dev", URL: spoke.URL}})
	code, body, raw = getHealthChecks(t, "/api/clusters/dev/health-checks", nil)
	if code != http.StatusOK || !equalStrings(itemKeys(body.RolloutHealthChecks.Items), []string{"web-dev/web"}) {
		t.Fatalf("spoke path form: %d %s", code, raw)
	}
}

// Same body twice gives the same ETag and a conditional request gets 304.
func TestFleetHealthChecks_ETag(t *testing.T) {
	hcIsolation(t)
	withHCReadClient(t, nil, hcRollout("web-prod", "web", &rolloutv1alpha1.HealthCheckSelectorConfig{}), hcObj("web-prod", "x", nil))
	r := setupRouter()
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/health-checks", nil))
	etag := w.Header().Get("ETag")
	if etag == "" {
		t.Fatal("no ETag")
	}
	req := httptest.NewRequest(http.MethodGet, "/api/health-checks", nil)
	req.Header.Set("If-None-Match", etag)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req)
	if w2.Code != http.StatusNotModified {
		t.Fatalf("conditional GET = %d, want 304", w2.Code)
	}
}
