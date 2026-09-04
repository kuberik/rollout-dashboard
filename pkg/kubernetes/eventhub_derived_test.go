package kubernetes

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ktesting "k8s.io/client-go/testing"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// DERIVED-2026-09-04: ChangeEvent.Derived carries the same response bodies
// GET .../children and GET .../managed-resources would compute, attached
// once per coalesced batch (eventhub.go's attachDerived, called from
// flush() before the per-client fan-out loop) rather than once per
// subscriber. These tests exercise attachDerived directly, and the full
// EventHub/flush() path for the "one computation, N subscribers" cost claim.

func TestAttachDerived_DeploymentEvent_PopulatesManagedResourceAndChildren(t *testing.T) {
	c, namespace, name := fixtureDeploymentWithOneReplicaSetAndPod(t)

	events := []ChangeEvent{
		{Type: "update", Kind: "Deployment", Namespace: namespace, Name: name},
	}
	out := attachDerived(context.Background(), c, events, newDerivedCache())

	if len(out) != 1 {
		t.Fatalf("expected 1 event back, got %d", len(out))
	}
	if out[0].Derived == nil {
		t.Fatalf("expected Derived to be populated for a Deployment update event")
	}
	var derived DerivedData
	if err := json.Unmarshal(out[0].Derived, &derived); err != nil {
		t.Fatalf("Derived is not valid JSON: %v (%s)", err, out[0].Derived)
	}
	if derived.ManagedResource == nil {
		t.Fatalf("expected ManagedResource for a Deployment event, got nil: %+v", derived)
	}
	if derived.ManagedResource.GroupVersionKind != "apps/v1/Deployment" || derived.ManagedResource.Name != name {
		t.Fatalf("unexpected ManagedResource identity: %+v", derived.ManagedResource)
	}
	if derived.Children == nil || len(derived.Children.ReplicaSets) != 1 {
		t.Fatalf("expected Children with 1 ReplicaSet for a Deployment event, got %+v", derived.Children)
	}
	if derived.OwnerDeployment != nil {
		t.Fatalf("did not expect OwnerDeployment on a Deployment event, got %+v", derived.OwnerDeployment)
	}
}

func TestAttachDerived_DeploymentDeleteEvent_OmitsDerived(t *testing.T) {
	c, namespace, name := fixtureDeploymentWithOneReplicaSetAndPod(t)

	events := []ChangeEvent{
		{Type: "delete", Kind: "Deployment", Namespace: namespace, Name: name},
	}
	out := attachDerived(context.Background(), c, events, newDerivedCache())

	if out[0].Derived != nil {
		t.Fatalf("expected Derived to be omitted for a Deployment delete event (contract: add/update only), got %s", out[0].Derived)
	}
}

func TestAttachDerived_ReplicaSetEvent_PopulatesOwnerAndChildren(t *testing.T) {
	c, namespace, _ := fixtureDeploymentWithOneReplicaSetAndPod(t)

	for _, evType := range []string{"add", "update", "delete"} {
		t.Run(evType, func(t *testing.T) {
			events := []ChangeEvent{
				{Type: evType, Kind: "ReplicaSet", Namespace: namespace, Name: "web-abc123", ownerDeployment: "web"},
			}
			out := attachDerived(context.Background(), c, events, newDerivedCache())

			if out[0].Derived == nil {
				t.Fatalf("expected Derived to be populated for a ReplicaSet %s event", evType)
			}
			var derived DerivedData
			if err := json.Unmarshal(out[0].Derived, &derived); err != nil {
				t.Fatalf("Derived is not valid JSON: %v (%s)", err, out[0].Derived)
			}
			if derived.OwnerDeployment == nil || derived.OwnerDeployment.Namespace != namespace || derived.OwnerDeployment.Name != "web" {
				t.Fatalf("unexpected OwnerDeployment: %+v", derived.OwnerDeployment)
			}
			if derived.Children == nil || len(derived.Children.ReplicaSets) != 1 {
				t.Fatalf("expected Children with 1 ReplicaSet for a ReplicaSet %s event, got %+v", evType, derived.Children)
			}
			if derived.ManagedResource != nil {
				t.Fatalf("did not expect ManagedResource on a ReplicaSet event, got %+v", derived.ManagedResource)
			}
		})
	}
}

func TestAttachDerived_ReplicaSetEventWithoutOwner_OmitsDerived(t *testing.T) {
	c, namespace, _ := fixtureDeploymentWithOneReplicaSetAndPod(t)

	// ownerDeployment unset — e.g. a ReplicaSet with no Deployment owner
	// (orphaned, or owned by something else). publishChange (cache.go) never
	// sets ownerDeployment in that case; attachDerived must not guess.
	events := []ChangeEvent{
		{Type: "update", Kind: "ReplicaSet", Namespace: namespace, Name: "web-abc123"},
	}
	out := attachDerived(context.Background(), c, events, newDerivedCache())

	if out[0].Derived != nil {
		t.Fatalf("expected Derived to be omitted for a ReplicaSet event with no resolved owner, got %s", out[0].Derived)
	}
}

func TestAttachDerived_OtherKinds_NeverPopulatesDerived(t *testing.T) {
	c, _, _ := fixtureDeploymentWithOneReplicaSetAndPod(t)

	events := []ChangeEvent{
		{Type: "update", Kind: "Rollout", Namespace: "team-a", Name: "app-1"},
	}
	out := attachDerived(context.Background(), c, events, newDerivedCache())

	if out[0].Derived != nil {
		t.Fatalf("expected Derived to stay nil for a kind outside the Deployment/ReplicaSet contract, got %s", out[0].Derived)
	}
}

func TestAttachDerived_NilClientIsNoop(t *testing.T) {
	events := []ChangeEvent{
		{Type: "update", Kind: "Deployment", Namespace: "team-a", Name: "web"},
	}
	out := attachDerived(context.Background(), nil, events, newDerivedCache())
	if out[0].Derived != nil {
		t.Fatalf("expected a nil client to be a no-op, got Derived=%s", out[0].Derived)
	}
}

func TestAttachDerived_DoesNotMutateInputSlice(t *testing.T) {
	c, namespace, name := fixtureDeploymentWithOneReplicaSetAndPod(t)

	events := []ChangeEvent{
		{Type: "update", Kind: "Deployment", Namespace: namespace, Name: name},
	}
	_ = attachDerived(context.Background(), c, events, newDerivedCache())

	if events[0].Derived != nil {
		t.Fatalf("attachDerived must return a new slice, not mutate its input — got Derived=%s on the original", events[0].Derived)
	}
}

// TestAttachDerived_ChildrenMatchesHandlerPath is the "handler and event
// path produce identical JSON for the same deployment" check the task
// calls for: BuildDeploymentChildren is the single function both main.go's
// /children handler and attachDerived call, so this asserts that identity
// holds through attachDerived's own JSON round trip too, not just that both
// call sites happen to reference the same Go function.
func TestAttachDerived_ChildrenMatchesHandlerPath(t *testing.T) {
	c, namespace, name := fixtureDeploymentWithOneReplicaSetAndPod(t)
	ctx := context.Background()

	directChildren, err := BuildDeploymentChildren(ctx, c, namespace, name)
	if err != nil {
		t.Fatalf("BuildDeploymentChildren (handler path): %v", err)
	}
	directJSON, err := json.Marshal(directChildren)
	if err != nil {
		t.Fatalf("marshal direct children: %v", err)
	}

	events := []ChangeEvent{
		{Type: "update", Kind: "Deployment", Namespace: namespace, Name: name},
	}
	out := attachDerived(ctx, c, events, newDerivedCache())
	var derived DerivedData
	if err := json.Unmarshal(out[0].Derived, &derived); err != nil {
		t.Fatalf("Derived is not valid JSON: %v (%s)", err, out[0].Derived)
	}
	eventJSON, err := json.Marshal(derived.Children)
	if err != nil {
		t.Fatalf("marshal event-path children: %v", err)
	}

	if string(directJSON) != string(eventJSON) {
		t.Fatalf("handler path and event path produced different JSON for the same deployment:\nhandler: %s\nevent:   %s", directJSON, eventJSON)
	}
}

func TestMarshalDerived_KeepsSmallPayload(t *testing.T) {
	d := DerivedData{OwnerDeployment: &OwnerDeploymentRef{Namespace: "team-a", Name: "web"}}
	got := marshalDerived(d)
	if got == nil {
		t.Fatalf("expected a small derived payload to be kept")
	}
}

func TestMarshalDerived_DropsOversizedPayload(t *testing.T) {
	// Build a Children payload whose marshaled JSON is well over
	// maxDerivedBytes (96 KiB) — the size-guard contract: derived is
	// dropped (nil), never truncated.
	big := make([]RSInfo, 0, 200)
	for i := 0; i < 200; i++ {
		big = append(big, RSInfo{
			Name:      fmt.Sprintf("rs-%d", i),
			Namespace: "team-a",
			Pods: []PodInfo{{
				Name:    fmt.Sprintf("pod-%d", i),
				Message: strings.Repeat("x", 600),
			}},
		})
	}
	d := DerivedData{Children: &DeploymentChildren{ReplicaSets: big}}

	// Sanity check the fixture is actually oversized before asserting the
	// guard caught it, so this test fails loudly (not silently-vacuously) if
	// the fixture size ever drifts below the guard.
	raw, err := json.Marshal(d)
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	if len(raw) <= maxDerivedBytes {
		t.Fatalf("test fixture (%d bytes) is not actually oversized (guard is %d bytes) — strengthen the fixture", len(raw), maxDerivedBytes)
	}

	got := marshalDerived(d)
	if got != nil {
		t.Fatalf("expected an oversized derived payload to be dropped (nil), got %d bytes", len(got))
	}
}

func TestDerivedCache_DebouncesRepeatedComputationWithinWindow(t *testing.T) {
	c, namespace, name := fixtureDeploymentWithOneReplicaSetAndPod(t)
	listCount := countPodListCalls(t, c)

	cache := newDerivedCache()
	ctx := context.Background()
	cache.get(ctx, c, namespace, name)
	cache.get(ctx, c, namespace, name)
	cache.get(ctx, c, namespace, name)

	if got := atomic.LoadInt32(listCount); got != 1 {
		t.Fatalf("expected 1 Pods LIST across 3 calls within the debounce window, got %d", got)
	}
}

func TestDerivedCache_RecomputesAfterDebounceWindowExpires(t *testing.T) {
	if testing.Short() {
		t.Skip("sleeps past derivedDebounceWindow; skipped in -short")
	}
	c, namespace, name := fixtureDeploymentWithOneReplicaSetAndPod(t)
	listCount := countPodListCalls(t, c)

	cache := newDerivedCache()
	ctx := context.Background()
	cache.get(ctx, c, namespace, name)
	time.Sleep(derivedDebounceWindow + 50*time.Millisecond)
	cache.get(ctx, c, namespace, name)

	if got := atomic.LoadInt32(listCount); got != 2 {
		t.Fatalf("expected a fresh Pods LIST once the debounce window passed, got %d total", got)
	}
}

// countPodListCalls wires an atomic counter into c's fake clientset via a
// PrependReactor, returning the counter. c must have been built by
// fixtureDeploymentWithOneReplicaSetAndPod (NewTestClientWithPods).
func countPodListCalls(t *testing.T, c *Client) *int32 {
	t.Helper()
	fakeClientset, ok := c.GetClientset().(interface {
		PrependReactor(verb, resource string, reaction ktesting.ReactionFunc)
	})
	if !ok {
		t.Fatalf("test client's clientset does not support PrependReactor — expected a k8s.io/client-go/kubernetes/fake.Clientset")
	}
	var count int32
	fakeClientset.PrependReactor("list", "pods", func(action ktesting.Action) (bool, runtime.Object, error) {
		atomic.AddInt32(&count, 1)
		return false, nil, nil
	})
	return &count
}

// TestEventHub_DerivedComputedOnceForNSubscribers is the "one computation
// per batch across N subscribers" cost claim (DERIVED-2026-09-04's own
// task): registers several subscribers on one hub, publishes a single
// ReplicaSet event, and asserts every subscriber's copy of the batch carries
// Derived — while the Pods LIST behind it only fired once, not once per
// subscriber. This is what proves attachDerived runs in flush(), on the
// shared side, before the per-client fan-out loop, rather than downstream in
// each connection's own Filter callback (where main.go's /events/stream
// handler still runs AttachObjects/FilterEventsByVisibility today).
func TestEventHub_DerivedComputedOnceForNSubscribers(t *testing.T) {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "team-a", Name: "web", UID: types.UID("dep-uid-1"),
		},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
	}
	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "team-a", Name: "web-abc123", UID: types.UID("rs-uid-1"),
			Labels: map[string]string{"app": "web"},
			OwnerReferences: []metav1.OwnerReference{
				{APIVersion: "apps/v1", Kind: "Deployment", Name: "web", UID: types.UID("dep-uid-1")},
			},
		},
	}
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "team-a", Name: "web-abc123-xyz",
			Labels: map[string]string{"app": "web"},
			OwnerReferences: []metav1.OwnerReference{
				{APIVersion: "apps/v1", Kind: "ReplicaSet", Name: "web-abc123", UID: types.UID("rs-uid-1")},
			},
		},
	}

	fakeClient, fakeClientset, err := NewTestClientWithPods([]client.Object{deployment, rs}, pod)
	if err != nil {
		t.Fatalf("NewTestClientWithPods: %v", err)
	}
	var listCount int32
	fakeClientset.PrependReactor("list", "pods", func(action ktesting.Action) (bool, runtime.Object, error) {
		atomic.AddInt32(&listCount, 1)
		return false, nil, nil
	})

	restore := SetReadClientForTest(fakeClient)
	defer restore()

	hub := NewEventHub(15 * time.Millisecond)
	defer hub.Stop()

	const subscribers = 5
	chans := make([]<-chan []ChangeEvent, subscribers)
	for i := 0; i < subscribers; i++ {
		_, ch := hub.Register(8)
		chans[i] = ch
	}

	// ownerDeployment is set directly on the literal, the same way
	// cache.go's publishChange derives it from the ReplicaSet's own
	// OwnerReferences before calling Publish — this test publishes directly
	// rather than driving a real informer callback, since only Publish/flush
	// (not the informer wiring) is what's under test here.
	hub.Publish(ChangeEvent{
		Type: "update", Kind: "ReplicaSet", Namespace: "team-a", Name: "web-abc123",
		ownerDeployment: "web",
	})

	for i, ch := range chans {
		select {
		case batch := <-ch:
			if len(batch) != 1 {
				t.Fatalf("subscriber %d: expected 1 event, got %d", i, len(batch))
			}
			if batch[0].Derived == nil {
				t.Fatalf("subscriber %d: expected Derived to be populated", i)
			}
			var derived DerivedData
			if err := json.Unmarshal(batch[0].Derived, &derived); err != nil {
				t.Fatalf("subscriber %d: Derived is not valid JSON: %v", i, err)
			}
			if derived.OwnerDeployment == nil || derived.OwnerDeployment.Name != "web" {
				t.Fatalf("subscriber %d: unexpected OwnerDeployment: %+v", i, derived.OwnerDeployment)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("subscriber %d: timed out waiting for a batch", i)
		}
	}

	if got := atomic.LoadInt32(&listCount); got != 1 {
		t.Fatalf("expected exactly 1 Pods LIST for %d subscribers sharing one batch, got %d", subscribers, got)
	}
}
