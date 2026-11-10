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
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

func gateKindFixture() []client.Object {
	ro := rolloutObj("team-a", "app")
	ro.Status.Gates = []rolloutv1alpha1.RolloutGateStatusSummary{{Name: "manual"}, {Name: "sched"}, {Name: "ghd-x"}, {Name: "dep"}}
	mk := func(name, owner string) *rolloutv1alpha1.RolloutGate {
		g := &rolloutv1alpha1.RolloutGate{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: name}}
		g.Spec.RolloutRef = &corev1.LocalObjectReference{Name: "app"}
		if owner == "" {
			av := []string{}
			g.Spec.AllowedVersions = &av
		}
		if owner != "" {
			g.OwnerReferences = []metav1.OwnerReference{{Kind: owner, Name: "o", APIVersion: "x/v1", UID: "u"}}
		}
		return g
	}
	return []client.Object{ro, mk("manual", ""), mk("sched", "RolloutSchedule"), mk("ghd-x", "Environment"), mk("dep", "RolloutDependency")}
}

func assertGateKinds(t *testing.T, gates []interface{}) {
	t.Helper()
	want := map[string]string{"manual": "approval", "sched": "schedule", "ghd-x": "promotion", "dep": "dependency"}
	if len(gates) != len(want) {
		t.Fatalf("gates = %d, want %d", len(gates), len(want))
	}
	for _, g := range gates {
		m := g.(map[string]interface{})
		if m["kind"] != want[m["name"].(string)] {
			t.Errorf("gate %v kind = %v, want %v", m["name"], m["kind"], want[m["name"].(string)])
		}
	}
}

func TestRolloutsListAndDetail_GateSummariesCarryKind(t *testing.T) {
	gin.SetMode(gin.TestMode)
	fc, err := kubernetes.NewTestClient(gateKindFixture()...)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(kubernetes.SetReadClientForTest(fc))
	r := setupRouter()

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/rollouts", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("list status %d: %s", w.Code, w.Body.String())
	}
	var list struct {
		Rollouts struct {
			Items []struct {
				Status struct {
					Gates []interface{} `json:"gates"`
				} `json:"status"`
			} `json:"items"`
		} `json:"rollouts"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	assertGateKinds(t, list.Rollouts.Items[0].Status.Gates)

	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/rollouts/team-a/app", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("detail status %d: %s", w.Code, w.Body.String())
	}
	var detail struct {
		Rollout struct {
			Status struct {
				Gates []interface{} `json:"gates"`
			} `json:"status"`
		} `json:"rollout"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	assertGateKinds(t, detail.Rollout.Status.Gates)
}

func TestRolloutPin_ResponseGateSummariesCarryKind(t *testing.T) {
	gin.SetMode(gin.TestMode)
	fc, err := kubernetes.NewTestClient(gateKindFixture()...)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(kubernetes.SetReadClientForTest(fc))
	prev := writeClientFn
	writeClientFn = func(*gin.Context) (*kubernetes.Client, error) { return fc, nil }
	t.Cleanup(func() { writeClientFn = prev })

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/rollouts/team-a/app/pin", strings.NewReader(`{"version":"v1"}`))
	req.Header.Set("Content-Type", "application/json")
	setupRouter().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("pin status %d: %s", w.Code, w.Body.String())
	}
	var out struct {
		Rollout struct {
			Status struct {
				Gates []interface{} `json:"gates"`
			} `json:"status"`
		} `json:"rollout"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	assertGateKinds(t, out.Rollout.Status.Gates)
}

func TestRolloutDetail_GateWithoutRolloutRefDoesNotPanic(t *testing.T) {
	gin.SetMode(gin.TestMode)
	objs := append(gateKindFixture(), &rolloutv1alpha1.RolloutGate{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "no-ref"}})
	fc, err := kubernetes.NewTestClient(objs...)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(kubernetes.SetReadClientForTest(fc))
	w := httptest.NewRecorder()
	setupRouter().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/rollouts/team-a/app", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("detail status %d: %s", w.Code, w.Body.String())
	}
}
