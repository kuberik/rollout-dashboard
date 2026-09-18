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

// A healthy cluster names no partial reads at all, so an ordinary response is
// unchanged by this field existing.
//
// The assertion that matters is the second one: an empty-but-PRESENT list means
// "this cluster has none", and must never be reported as a failed read. Only a
// nil list — which is what a failed LIST leaves behind — counts. That is the
// whole distinction `partialReads` exists to carry, and the reason the stage
// meter used to flap between its 14-stage and 3-stage shapes.
func TestRolloutsList_NoPartialReadsWhenEverythingAnswers(t *testing.T) {
	gin.SetMode(gin.TestMode)
	fakeClient, err := kubernetes.NewTestClient([]client.Object{rolloutObj("team-a", "app-1")}...)
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}
	t.Cleanup(kubernetes.SetReadClientForTest(fakeClient))

	r := setupRouter()
	req := httptest.NewRequest(http.MethodGet, "/api/rollouts", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d (body: %s)", w.Code, w.Body.String())
	}
	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, present := body["partialReads"]; present {
		t.Fatalf("partialReads present on a healthy response: %v", body["partialReads"])
	}
	krs, ok := body["kruiseRollouts"].(map[string]interface{})
	if !ok {
		t.Fatalf("kruiseRollouts = %v, want a list object even when empty", body["kruiseRollouts"])
	}
	if items, _ := krs["items"].([]interface{}); len(items) != 0 {
		t.Fatalf("expected zero kruise rollouts in the fixture, got %d", len(items))
	}
}
