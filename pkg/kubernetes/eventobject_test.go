package kubernetes

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// EVENTS-2026-09-04 Part 2: ChangeEvent.Object carries the full object for a
// fixed set of kinds so the frontend stops refetching on every event. These
// tests exercise AttachObjects directly against a fake client (NewTestClient)
// — the same fixture-building tests in this package (rolloutdependency_test.go,
// sort_test.go) already use.

func TestAttachObjects_PopulatesObjectForKnownKind(t *testing.T) {
	rollout := &rolloutv1alpha1.Rollout{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "app-1", ResourceVersion: "7"},
	}
	fakeClient, err := NewTestClient(rollout)
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}

	events := []ChangeEvent{
		{Type: "update", Kind: "Rollout", Namespace: "team-a", Name: "app-1", ResourceVersion: "7"},
	}
	out := AttachObjects(context.Background(), fakeClient, events)

	if len(out) != 1 {
		t.Fatalf("expected 1 event back, got %d", len(out))
	}
	if out[0].Object == nil {
		t.Fatalf("expected Object to be populated for a known kind, got nil")
	}
	var decoded struct {
		Metadata struct {
			Namespace string `json:"namespace"`
			Name      string `json:"name"`
		} `json:"metadata"`
	}
	if err := json.Unmarshal(out[0].Object, &decoded); err != nil {
		t.Fatalf("Object is not valid JSON: %v (%s)", err, out[0].Object)
	}
	if decoded.Metadata.Namespace != "team-a" || decoded.Metadata.Name != "app-1" {
		t.Fatalf("Object does not describe the expected rollout, got %+v", decoded)
	}
}

// TestAttachObjects_PopulatesObjectForDeploymentAndReplicaSet covers
// CHILDREN-2026-09-04: Deployment and ReplicaSet joined objectCarryingKinds
// alongside cache.go's cachedByObject, so a children/managed-resources
// stream event carries the object the same way every other pushed kind
// already does.
func TestAttachObjects_PopulatesObjectForDeploymentAndReplicaSet(t *testing.T) {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "web", ResourceVersion: "9"},
	}
	replicaSet := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "web-abc123", ResourceVersion: "10"},
	}
	fakeClient, err := NewTestClient(deployment, replicaSet)
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}

	events := []ChangeEvent{
		{Type: "update", Kind: "Deployment", Namespace: "team-a", Name: "web"},
		{Type: "update", Kind: "ReplicaSet", Namespace: "team-a", Name: "web-abc123"},
	}
	out := AttachObjects(context.Background(), fakeClient, events)

	for i, ev := range events {
		if out[i].Object == nil {
			t.Fatalf("expected Object to be populated for kind %s, got nil", ev.Kind)
		}
		var decoded struct {
			Kind     string `json:"kind"`
			Metadata struct {
				Namespace string `json:"namespace"`
				Name      string `json:"name"`
			} `json:"metadata"`
		}
		if err := json.Unmarshal(out[i].Object, &decoded); err != nil {
			t.Fatalf("Object for %s is not valid JSON: %v (%s)", ev.Kind, err, out[i].Object)
		}
		if decoded.Metadata.Namespace != ev.Namespace || decoded.Metadata.Name != ev.Name {
			t.Fatalf("Object for %s does not describe the expected object, got %+v", ev.Kind, decoded)
		}
	}
}

func TestAttachObjects_OmitsObjectOnDelete(t *testing.T) {
	rollout := &rolloutv1alpha1.Rollout{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "app-1"},
	}
	fakeClient, err := NewTestClient(rollout)
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}

	events := []ChangeEvent{
		{Type: "delete", Kind: "Rollout", Namespace: "team-a", Name: "app-1"},
	}
	out := AttachObjects(context.Background(), fakeClient, events)

	if out[0].Object != nil {
		t.Fatalf("expected no Object on a delete event, got %s", out[0].Object)
	}
}

func TestAttachObjects_OmitsObjectForUnknownKind(t *testing.T) {
	fakeClient, err := NewTestClient()
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}

	// RolloutGate is cached for reads (cache.go's cachedByObject) but is
	// deliberately not one of the 8 kinds the events-carry-object contract
	// names.
	events := []ChangeEvent{
		{Type: "add", Kind: "RolloutGate", Namespace: "team-a", Name: "gate-1"},
	}
	out := AttachObjects(context.Background(), fakeClient, events)

	if out[0].Object != nil {
		t.Fatalf("expected no Object for a kind outside the contract, got %s", out[0].Object)
	}
}

func TestAttachObjects_StripsLastAppliedConfigAnnotation(t *testing.T) {
	rollout := &rolloutv1alpha1.Rollout{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "team-a",
			Name:      "app-1",
			Annotations: map[string]string{
				"kubectl.kubernetes.io/last-applied-configuration": `{"huge":"json blob kubectl stores here"}`,
				"kept-annotation": "stays",
			},
		},
	}
	fakeClient, err := NewTestClient(rollout)
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}

	events := []ChangeEvent{{Type: "add", Kind: "Rollout", Namespace: "team-a", Name: "app-1"}}
	out := AttachObjects(context.Background(), fakeClient, events)

	if out[0].Object == nil {
		t.Fatalf("expected Object to be populated")
	}
	if strings.Contains(string(out[0].Object), "last-applied-configuration") {
		t.Fatalf("expected last-applied-configuration annotation to be stripped, got %s", out[0].Object)
	}
	if !strings.Contains(string(out[0].Object), "kept-annotation") {
		t.Fatalf("expected other annotations to survive, got %s", out[0].Object)
	}
}

func TestAttachObjects_OmitsOversizedObject(t *testing.T) {
	// A single annotation comfortably over the 64 KiB guard.
	rollout := &rolloutv1alpha1.Rollout{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:   "team-a",
			Name:        "app-1",
			Annotations: map[string]string{"big": strings.Repeat("x", 70*1024)},
		},
	}
	fakeClient, err := NewTestClient(rollout)
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}

	events := []ChangeEvent{{Type: "add", Kind: "Rollout", Namespace: "team-a", Name: "app-1"}}
	out := AttachObjects(context.Background(), fakeClient, events)

	if out[0].Object != nil {
		t.Fatalf("expected Object to be omitted once JSON exceeds %d bytes, got %d bytes", maxEventObjectBytes, len(out[0].Object))
	}
}

func TestAttachObjects_GetErrorLeavesObjectNil(t *testing.T) {
	// No fixture object at all — the Get inside AttachObjects 404s, the same
	// race as "deleted again between the informer callback and this call."
	fakeClient, err := NewTestClient()
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}

	events := []ChangeEvent{{Type: "update", Kind: "Rollout", Namespace: "team-a", Name: "gone"}}
	out := AttachObjects(context.Background(), fakeClient, events)

	if out[0].Object != nil {
		t.Fatalf("expected no Object when the Get errors, got %s", out[0].Object)
	}
}

func TestAttachObjects_NilClientIsNoop(t *testing.T) {
	events := []ChangeEvent{{Type: "add", Kind: "Rollout", Namespace: "team-a", Name: "app-1"}}
	out := AttachObjects(context.Background(), nil, events)

	if len(out) != 1 || out[0].Object != nil {
		t.Fatalf("expected events to pass through unchanged when k8sClient is nil, got %+v", out)
	}
}

func TestAttachObjects_DoesNotMutateInputSlice(t *testing.T) {
	rollout := &rolloutv1alpha1.Rollout{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "app-1"}}
	fakeClient, err := NewTestClient(rollout)
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}

	events := []ChangeEvent{{Type: "add", Kind: "Rollout", Namespace: "team-a", Name: "app-1"}}
	_ = AttachObjects(context.Background(), fakeClient, events)

	if events[0].Object != nil {
		t.Fatalf("expected AttachObjects to leave its input slice untouched, got Object=%s on the original", events[0].Object)
	}
}

// TestAttachObjects_MultipleKindsAndDistinctObjects covers a realistic mixed
// batch: one coalesced flush touching several of the 8 known kinds plus one
// unknown kind, each getting its own correctly-matched object.
func TestAttachObjects_MultipleKindsAndDistinctObjects(t *testing.T) {
	rollout := &rolloutv1alpha1.Rollout{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "app-1"}}
	hc := &rolloutv1alpha1.HealthCheck{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "hc-1"}}
	fakeClient, err := NewTestClient(rollout, hc)
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}

	events := []ChangeEvent{
		{Type: "update", Kind: "Rollout", Namespace: "team-a", Name: "app-1"},
		{Type: "update", Kind: "HealthCheck", Namespace: "team-a", Name: "hc-1"},
		{Type: "add", Kind: "RolloutTest", Namespace: "team-a", Name: "rt-1"}, // not in the contract
	}
	out := AttachObjects(context.Background(), fakeClient, events)

	if out[0].Object == nil {
		t.Fatalf("expected Rollout event to carry its object")
	}
	if out[1].Object == nil {
		t.Fatalf("expected HealthCheck event to carry its object")
	}
	if out[2].Object != nil {
		t.Fatalf("expected RolloutTest event to carry no object, got %s", out[2].Object)
	}
	if !strings.Contains(string(out[0].Object), "app-1") || strings.Contains(string(out[0].Object), "hc-1") {
		t.Fatalf("Rollout event's Object looks wrong: %s", out[0].Object)
	}
	if !strings.Contains(string(out[1].Object), "hc-1") || strings.Contains(string(out[1].Object), "app-1") {
		t.Fatalf("HealthCheck event's Object looks wrong: %s", out[1].Object)
	}
}

// TestFilterEventsByVisibility_DropsObjectWithTheEvent asserts the spec's
// explicit rule: "an event a caller may not see is dropped, object and all."
func TestFilterEventsByVisibility_DropsObjectWithTheEvent(t *testing.T) {
	resetVisibilityCache()
	withFakeChecker(t, func(c *gin.Context, ns string) (bool, error) {
		return ns == "team-a", nil
	})

	c := newTestGinContext(t, "user-token")
	events := []ChangeEvent{
		{Kind: "Rollout", Namespace: "team-a", Name: "app-1", Object: json.RawMessage(`{"metadata":{"name":"app-1"}}`)},
		{Kind: "Rollout", Namespace: "team-b", Name: "app-2", Object: json.RawMessage(`{"metadata":{"name":"app-2"}}`)},
	}
	out := FilterEventsByVisibility(c, events)

	if len(out) != 1 || out[0].Name != "app-1" {
		t.Fatalf("expected only team-a's event to survive, got %+v", out)
	}
	if out[0].Object == nil {
		t.Fatalf("expected the surviving event to keep its Object")
	}
}

// TestEventHub_LoadTwentyClientsTwoHundredEvents_WithEmbeddedObjects re-runs
// the incident load test (eventhub_test.go) with a realistic per-event
// Object payload attached, to check whether embedding objects (bigger
// payloads per channel element) changes the buffer-fits-under-load story.
// Channel capacity in Go is a count of slice HEADERS, not bytes — a batch's
// payload size does not consume extra channel slots — so this is expected
// to pass with the existing buffer sizes; if it started dropping, that would
// be the signal to raise eventStreamLocalBufSize (main_events_cap.go) or
// MultiStreamOptions.SpokeOutBufSize (multistream.go).
func TestEventHub_LoadTwentyClientsTwoHundredEvents_WithEmbeddedObjects(t *testing.T) {
	h := NewEventHub(5 * time.Millisecond)
	defer h.Stop()

	const numClients = 20
	const numEvents = 200
	// A representative embedded Rollout object — comfortably under the 64
	// KiB guard, comfortably bigger than the bare identity fields alone.
	fatObject := json.RawMessage(`{"metadata":{"name":"app"},"spec":{"note":"` + strings.Repeat("x", 2*1024) + `"}}`)

	type sub struct {
		id uint64
		ch <-chan []ChangeEvent
	}
	clients := make([]sub, numClients)
	for i := range clients {
		id, ch := h.Register(64)
		clients[i] = sub{id: id, ch: ch}
	}

	done := make(chan int, numClients)
	for _, cl := range clients {
		go func(ch <-chan []ChangeEvent) {
			n := 0
			for batch := range ch {
				n += len(batch)
			}
			done <- n
		}(cl.ch)
	}

	for i := 0; i < numEvents; i++ {
		h.Publish(ChangeEvent{
			Kind:      "Rollout",
			Namespace: "ns",
			Name:      fmt.Sprintf("obj-%d", i),
			Type:      "add",
			Object:    fatObject,
		})
	}

	time.Sleep(150 * time.Millisecond)
	for _, cl := range clients {
		h.Unregister(cl.id)
	}

	for i := 0; i < numClients; i++ {
		select {
		case n := <-done:
			if n != numEvents {
				t.Errorf("a client received %d/%d events with embedded objects — buffer sizes may need raising", n, numEvents)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("timed out waiting for a client's drain goroutine to finish")
		}
	}
}
