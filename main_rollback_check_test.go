package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

func rbVersion(tag, version string, requires map[string]string) rolloutv1alpha1.VersionInfo {
	v := rolloutv1alpha1.VersionInfo{Tag: tag, Requires: requires}
	if version != "" {
		v.Version = ptr.To(version)
	}
	return v
}

func rbRollout(ns, name string, versions ...rolloutv1alpha1.VersionInfo) *rolloutv1alpha1.Rollout {
	r := rolloutObj(ns, name)
	for _, v := range versions {
		r.Status.History = append(r.Status.History, rolloutv1alpha1.DeploymentHistoryEntry{
			Version: v, BakeStatus: ptr.To(rolloutv1alpha1.BakeStatusSucceeded), Timestamp: metav1.Now(),
		})
	}
	return r
}

func rbDep(consumer string, policy rolloutv1alpha1.ProviderRollbackPolicy) *rolloutv1alpha1.RolloutDependency {
	d := &rolloutv1alpha1.RolloutDependency{ObjectMeta: metav1.ObjectMeta{Namespace: "shop", Name: consumer + "-needs-ledger"}}
	d.Spec.RolloutRef.Name = consumer
	d.Spec.ProviderRef = rolloutv1alpha1.ProviderRolloutReference{Name: "ledger-core", Namespace: ptr.To("shop")}
	d.Spec.Contract = ptr.To("ledger")
	d.Spec.ProviderRollback = policy
	return d
}

type rbResponse struct {
	Tag             string                            `json:"tag"`
	Breaks          []rolloutv1alpha1.DependencyBreak `json:"breaks"`
	HiddenConsumers int                               `json:"hiddenConsumers"`
}

func getRollbackCheck(t *testing.T, path string) (int, rbResponse, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ClusterPathRewriteHandler(setupRouter()).ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	var body rbResponse
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("unmarshal: %v (%s)", err, w.Body.String())
		}
	}
	return w.Code, body, w.Body.String()
}

// ledger-core history: 7.0.0 running, 5.1.0 earlier. checkout runs 3.2.0 and
// needs ledger ^6.0.0, which 5.1.0 does not serve.
func rbWorld(policy rolloutv1alpha1.ProviderRollbackPolicy) []client.Object {
	provider := rbRollout("shop", "ledger-core",
		rbVersion("v7", "7.0.0", nil), rbVersion("v5", "5.1.0", nil))
	consumer := rbRollout("shop", "checkout", rbVersion("c3", "3.2.0", map[string]string{"ledger": "^6.0.0"}))
	return []client.Object{provider, consumer, rbDep("checkout", policy)}
}

func TestRollbackCheck_ConsumerBreaks(t *testing.T) {
	withHCReadClient(t, nil, rbWorld("")...)
	code, body, raw := getRollbackCheck(t, "/api/rollouts/shop/ledger-core/rollback-check?tag=v5")
	if code != 200 {
		t.Fatalf("status %d: %s", code, raw)
	}
	if body.Tag != "v5" || len(body.Breaks) != 1 {
		t.Fatalf("want one break for v5, got %s", raw)
	}
	b := body.Breaks[0]
	if b.Kind != "ConsumerRequires" || b.Rollout != "checkout" || b.Reason != "ConstraintNotSatisfied" || b.Allowed || b.Requires != "^6.0.0" || b.Version != "3.2.0" {
		t.Fatalf("unexpected break: %+v", b)
	}
}

func TestRollbackCheck_AllowEdgeIsReportedAllowed(t *testing.T) {
	withHCReadClient(t, nil, rbWorld(rolloutv1alpha1.ProviderRollbackAllow)...)
	code, body, raw := getRollbackCheck(t, "/api/rollouts/shop/ledger-core/rollback-check?tag=v5")
	if code != 200 || len(body.Breaks) != 1 || !body.Breaks[0].Allowed {
		t.Fatalf("want one Allowed break, got %d %s", code, raw)
	}
}

func TestRollbackCheck_NoConsumersIsEmptyArray(t *testing.T) {
	provider := rbRollout("shop", "ledger-core", rbVersion("v7", "7.0.0", nil), rbVersion("v5", "5.1.0", nil))
	withHCReadClient(t, nil, provider)
	code, _, raw := getRollbackCheck(t, "/api/rollouts/shop/ledger-core/rollback-check?tag=v5")
	if code != 200 {
		t.Fatalf("status %d: %s", code, raw)
	}
	var generic map[string]json.RawMessage
	_ = json.Unmarshal([]byte(raw), &generic)
	if string(generic["breaks"]) != "[]" {
		t.Fatalf(`breaks must be [] not null, got %s`, raw)
	}
}

func TestRollbackCheck_UnknownTagIs404(t *testing.T) {
	withHCReadClient(t, nil, rbWorld("")...)
	code, _, raw := getRollbackCheck(t, "/api/rollouts/shop/ledger-core/rollback-check?tag=nope")
	if code != http.StatusNotFound {
		t.Fatalf("want 404, got %d: %s", code, raw)
	}
}

func TestRollbackCheck_MissingTagIs400(t *testing.T) {
	withHCReadClient(t, nil, rbWorld("")...)
	code, _, raw := getRollbackCheck(t, "/api/rollouts/shop/ledger-core/rollback-check")
	if code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", code, raw)
	}
}

func TestRollbackCheck_HubProxiesToSpoke(t *testing.T) {
	resetClusterPathTestState(t)
	t.Setenv("CLUSTER_NAME", "hub1")
	spoke := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/rollouts/shop/ledger-core/rollback-check" || r.URL.Query().Get("tag") != "v5" {
			t.Errorf("spoke got %q", r.URL.String())
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"tag":"v5","breaks":[{"kind":"ConsumerRequires","rollout":"checkout"}]}`))
	}))
	defer spoke.Close()
	registry.put([]ClusterInfo{{Name: "spoke1", URL: spoke.URL}})
	code, body, raw := getRollbackCheck(t, "/api/clusters/spoke1/rollouts/shop/ledger-core/rollback-check?tag=v5")
	if code != 200 || len(body.Breaks) != 1 || body.Breaks[0].Rollout != "checkout" {
		t.Fatalf("spoke answer not relayed: %d %s", code, raw)
	}
}

// Two consumers of ledger-core: checkout (ns shop, visible) and risk (ns
// secret, not listable by the restricted viewer).
func rbVisibilityWorld() []client.Object {
	objs := rbWorld("")
	risk := rbRollout("secret", "risk", rbVersion("r1", "1.0.0", map[string]string{"ledger": "^6.0.0"}))
	d := rbDep("risk", "")
	d.Namespace = "secret"
	return append(objs, risk, d)
}

func rbLimitedViewer(t *testing.T, allowed map[string]bool) {
	t.Cleanup(kubernetes.SetListRolloutsPermissionCheckForTest(func(_ *gin.Context, ns string) (bool, error) {
		return allowed[ns], nil
	}))
}

func getRollbackCheckAs(t *testing.T, token string) (int, rbResponse, string) {
	t.Helper()
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/rollouts/shop/ledger-core/rollback-check?tag=v5", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	ClusterPathRewriteHandler(setupRouter()).ServeHTTP(w, req)
	var body rbResponse
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	return w.Code, body, w.Body.String()
}

func TestRollbackCheck_HiddenConsumerTrimmedAndCounted(t *testing.T) {
	gin.SetMode(gin.TestMode)
	hcIsolation(t)
	withHCReadClient(t, nil, rbVisibilityWorld()...)
	rbLimitedViewer(t, map[string]bool{"shop": true})
	code, body, raw := getRollbackCheckAs(t, "tok-shop")
	if code != 200 {
		t.Fatalf("status %d: %s", code, raw)
	}
	if len(body.Breaks) != 1 || body.Breaks[0].Rollout != "checkout" {
		t.Fatalf("want only the visible checkout break, got %s", raw)
	}
	if body.HiddenConsumers != 1 || strings.Contains(raw, "risk") || strings.Contains(raw, "secret") {
		t.Fatalf("want hiddenConsumers=1 and no trace of the hidden consumer, got %s", raw)
	}
}

func TestRollbackCheck_VisibleConsumerKeptNoHiddenField(t *testing.T) {
	gin.SetMode(gin.TestMode)
	hcIsolation(t)
	withHCReadClient(t, nil, rbWorld("")...)
	rbLimitedViewer(t, map[string]bool{"shop": true})
	code, body, raw := getRollbackCheckAs(t, "tok-shop")
	if code != 200 || len(body.Breaks) != 1 || strings.Contains(raw, "hiddenConsumers") {
		t.Fatalf("want the visible break and no hiddenConsumers, got %d %s", code, raw)
	}
}

func TestRollbackCheck_UnrestrictedViewerSeesEverything(t *testing.T) {
	gin.SetMode(gin.TestMode)
	hcIsolation(t)
	withHCReadClient(t, nil, rbVisibilityWorld()...)
	code, body, raw := getRollbackCheckAs(t, "")
	if code != 200 || len(body.Breaks) != 2 || strings.Contains(raw, "hiddenConsumers") {
		t.Fatalf("no-token viewer must see both breaks, got %d %s", code, raw)
	}
}

// A hidden Allow edge and a hidden TargetRequires provider are trimmed from
// the body but never counted: neither is a consumer the rollback would break.
func TestRollbackCheck_HiddenAllowAndProviderRowsNotCounted(t *testing.T) {
	gin.SetMode(gin.TestMode)
	hcIsolation(t)
	// ledger-core (shop) has a hidden Allow consumer "risk" in ns secret.
	objs := rbWorld("")
	risk := rbRollout("secret", "risk", rbVersion("r1", "1.0.0", map[string]string{"ledger": "^6.0.0"}))
	d := rbDep("risk", rolloutv1alpha1.ProviderRollbackAllow)
	d.Namespace = "secret"
	// web (shop): its older build w1 needs ledger ^9, served by hidden provider
	// vault-ledger (ns secret) at 7.0.0, so TargetRequires names a hidden provider.
	web := rbRollout("shop", "web", rbVersion("w2", "2.0.0", nil), rbVersion("w1", "1.0.0", map[string]string{"ledger": "^9.0.0"}))
	vault := rbRollout("secret", "vault-ledger", rbVersion("v1", "7.0.0", nil))
	wd := rbDep("web", "")
	wd.Name = "web-needs-vault"
	wd.Spec.ProviderRef = rolloutv1alpha1.ProviderRolloutReference{Name: "vault-ledger", Namespace: ptr.To("secret")}
	objs = append(objs, risk, d, web, vault, wd)
	withHCReadClient(t, nil, objs...)
	rbLimitedViewer(t, map[string]bool{"shop": true})

	for _, path := range []string{
		"/api/rollouts/shop/ledger-core/rollback-check?tag=v5",
		"/api/rollouts/shop/web/rollback-check?tag=w1",
	} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer tok-shop")
		ClusterPathRewriteHandler(setupRouter()).ServeHTTP(w, req)
		raw := w.Body.String()
		if w.Code != 200 || strings.Contains(raw, "hiddenConsumers") || strings.Contains(raw, "risk") || strings.Contains(raw, "vault-ledger") || strings.Contains(raw, "secret") {
			t.Fatalf("%s: want hidden rows trimmed and uncounted, got %d %s", path, w.Code, raw)
		}
	}
}
