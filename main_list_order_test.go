package main

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// PERF-2026-09-04 §D: /api/rollouts and the health-checks route both read
// through the informer-cache-backed client, whose LIST order is a Go map
// walk — nondeterministic between calls even with nothing changed in the
// cluster. Before pkg/kubernetes sorted its own List results, two
// back-to-back requests for the same data could come back as different JSON
// byte-for-byte (different item order), which also meant a different SHA-256
// ETag every time — defeating the 304 revalidation path writeJSONWithETag
// exists for. These two tests hit the real production route/handler wiring
// (setupRouter, main.go) against a fake Kubernetes client and assert two
// consecutive calls are byte-identical.

func rolloutObj(namespace, name string) *rolloutv1alpha1.Rollout {
	return &rolloutv1alpha1.Rollout{ObjectMeta: metav1.ObjectMeta{Namespace: namespace, Name: name}}
}

func TestRolloutsListHandler_DeterministicAcrossCalls(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// Enough distinct objects, spread across enough namespaces, that a fake
	// client whose backing store is itself a Go map would be very likely to
	// visit them in a different order across two List calls if nothing
	// downstream fixed the order.
	var objs []client.Object
	for _, ns := range []string{"hello-dep-dev", "hello-dep-staging", "hello-dep-prod", "checkout", "billing"} {
		for _, name := range []string{"api-app", "web-app", "worker-app"} {
			objs = append(objs, rolloutObj(ns, name))
		}
	}
	fakeClient, err := kubernetes.NewTestClient(objs...)
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}
	restore := kubernetes.SetReadClientForTest(fakeClient)
	defer restore()

	r := setupRouter()

	do := func() (status int, body []byte, etag string) {
		req := httptest.NewRequest("GET", "/api/rollouts", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code, w.Body.Bytes(), w.Header().Get("ETag")
	}

	status1, body1, etag1 := do()
	if status1 != 200 {
		t.Fatalf("first call: status = %d, body = %s", status1, body1)
	}
	if etag1 == "" {
		t.Fatalf("first call: expected an ETag header on /api/rollouts")
	}

	// Sanity: the fixture actually made it into the response, so a
	// pre-fix test run against this fixture size would have a real chance of
	// catching a reintroduced ordering bug (an empty/near-empty list can't).
	var parsed struct {
		Rollouts struct {
			Items []struct {
				Metadata struct {
					Namespace string `json:"namespace"`
					Name      string `json:"name"`
				} `json:"metadata"`
			} `json:"items"`
		} `json:"rollouts"`
	}
	if err := json.Unmarshal(body1, &parsed); err != nil {
		t.Fatalf("unmarshal response: %v (body: %s)", err, body1)
	}
	if len(parsed.Rollouts.Items) != len(objs) {
		t.Fatalf("got %d rollouts in the response, want %d", len(parsed.Rollouts.Items), len(objs))
	}
	for i := 1; i < len(parsed.Rollouts.Items); i++ {
		prev, cur := parsed.Rollouts.Items[i-1].Metadata, parsed.Rollouts.Items[i].Metadata
		if prev.Namespace > cur.Namespace || (prev.Namespace == cur.Namespace && prev.Name > cur.Name) {
			t.Fatalf("rollouts not in (namespace, name) order: %s/%s before %s/%s",
				prev.Namespace, prev.Name, cur.Namespace, cur.Name)
		}
	}

	for i := 0; i < 5; i++ {
		status, body, etag := do()
		if status != 200 {
			t.Fatalf("call %d: status = %d, body = %s", i+2, status, body)
		}
		if etag != etag1 {
			t.Fatalf("call %d: ETag = %s, want %s (same data, different order leaked into the response)", i+2, etag, etag1)
		}
		if string(body) != string(body1) {
			t.Fatalf("call %d: body differs from call 1:\n--- call 1 ---\n%s\n--- call %d ---\n%s", i+2, body1, i+2, body)
		}
	}
}

func TestHealthChecksHandler_DeterministicAcrossCalls(t *testing.T) {
	gin.SetMode(gin.TestMode)

	rollout := rolloutObj("checkout", "api-app")
	// Non-nil but otherwise empty selector: GetHealthChecksBySelector treats a
	// nil selector as "no health checks" outright, but an empty one means
	// "every HealthCheck in the rollout's own namespace" (no label filter, no
	// namespace selector) — exactly the case that needs sorting.
	rollout.Spec.HealthCheckSelector = &rolloutv1alpha1.HealthCheckSelectorConfig{}
	objs := []client.Object{rollout}
	for _, name := range []string{"db-check", "queue-check", "http-check", "cache-check", "disk-check", "cert-check"} {
		objs = append(objs, &rolloutv1alpha1.HealthCheck{
			ObjectMeta: metav1.ObjectMeta{Namespace: "checkout", Name: name},
		})
	}
	fakeClient, err := kubernetes.NewTestClient(objs...)
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}
	restore := kubernetes.SetReadClientForTest(fakeClient)
	defer restore()

	r := setupRouter()

	do := func() (status int, body []byte) {
		req := httptest.NewRequest("GET", "/api/rollouts/checkout/api-app/health-checks", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code, w.Body.Bytes()
	}

	status1, body1 := do()
	if status1 != 200 {
		t.Fatalf("first call: status = %d, body = %s", status1, body1)
	}

	var parsed struct {
		HealthChecks []struct {
			Metadata struct {
				Name string `json:"name"`
			} `json:"metadata"`
		} `json:"healthChecks"`
	}
	if err := json.Unmarshal(body1, &parsed); err != nil {
		t.Fatalf("unmarshal response: %v (body: %s)", err, body1)
	}
	if len(parsed.HealthChecks) != 6 {
		t.Fatalf("got %d health checks in the response, want 6", len(parsed.HealthChecks))
	}
	for i := 1; i < len(parsed.HealthChecks); i++ {
		if parsed.HealthChecks[i-1].Metadata.Name > parsed.HealthChecks[i].Metadata.Name {
			t.Fatalf("health checks not name-ordered: %s before %s",
				parsed.HealthChecks[i-1].Metadata.Name, parsed.HealthChecks[i].Metadata.Name)
		}
	}

	for i := 0; i < 5; i++ {
		status, body := do()
		if status != 200 {
			t.Fatalf("call %d: status = %d, body = %s", i+2, status, body)
		}
		if string(body) != string(body1) {
			t.Fatalf("call %d: body differs from call 1 — this route has no ETag today, so this is the only signal:\n--- call 1 ---\n%s\n--- call %d ---\n%s", i+2, body1, i+2, body)
		}
	}
}
