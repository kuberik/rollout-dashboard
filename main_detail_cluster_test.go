package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// The single-rollout GET carries the same source-cluster annotation the list adds,
// so the frontend can key the rollout's release catalogue by (cluster, namespace, source).
func TestRolloutDetailCarriesItsSourceCluster(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetClusterPathTestState(t)
	t.Setenv("CLUSTER_NAME", "hub1")
	fakeClient, err := kubernetes.NewTestClient([]client.Object{rolloutObj("team-a", "app-1")}...)
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}
	defer kubernetes.SetReadClientForTest(fakeClient)()

	w := httptest.NewRecorder()
	setupRouter().ServeHTTP(w, httptest.NewRequest("GET", "/api/rollouts/team-a/app-1", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d (body: %s)", w.Code, w.Body.String())
	}
	var body struct {
		Rollout struct {
			Metadata struct {
				Annotations map[string]string `json:"annotations"`
			} `json:"metadata"`
		} `json:"rollout"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if got := body.Rollout.Metadata.Annotations[sourceClusterAnnotation]; got != "hub1" {
		t.Fatalf("source-cluster annotation = %q, want hub1 (annotations: %v)", got, body.Rollout.Metadata.Annotations)
	}
	if body.Rollout.Metadata.Annotations[sourceDashboardAnnotation] == "" {
		t.Fatalf("source-dashboard annotation missing: %v", body.Rollout.Metadata.Annotations)
	}
}
