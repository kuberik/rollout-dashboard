package kubernetes

import (
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	k8sptr "k8s.io/utils/ptr"
)

// CHILDREN-2026-09-04: apps/v1 Deployment and ReplicaSet joined the informer
// cache (cache.go's cachedByObject) so the children/managed-resources read
// paths can be served from memory and so add/update/delete on either kind
// reaches the /api/events/stream push path. These tests cover the kind
// mapping (kindOf/cachedByObject stay in sync) and the ReplicaSet update
// filter (shouldPublishUpdate) that keeps a noisy status-only RS write from
// flooding the stream.

func TestCachedByObject_IncludesDeploymentAndReplicaSet(t *testing.T) {
	byObject := cachedByObject()

	foundDeployment, foundReplicaSet := false, false
	for obj := range byObject {
		switch obj.(type) {
		case *appsv1.Deployment:
			foundDeployment = true
		case *appsv1.ReplicaSet:
			foundReplicaSet = true
		}
	}
	if !foundDeployment {
		t.Fatalf("expected cachedByObject() to include apps/v1 Deployment")
	}
	if !foundReplicaSet {
		t.Fatalf("expected cachedByObject() to include apps/v1 ReplicaSet")
	}
}

func TestKindOf_DeploymentAndReplicaSet(t *testing.T) {
	if got := kindOf(&appsv1.Deployment{}); got != "Deployment" {
		t.Fatalf("kindOf(*appsv1.Deployment{}) = %q, want %q", got, "Deployment")
	}
	if got := kindOf(&appsv1.ReplicaSet{}); got != "ReplicaSet" {
		t.Fatalf("kindOf(*appsv1.ReplicaSet{}) = %q, want %q", got, "ReplicaSet")
	}
}

// TestKindOf_MatchesCachedByObject guards the doc-comment promise on kindOf
// ("a plain type switch over the same set cachedByObject() lists") — every
// type registered for caching must also produce a real Kind name, not the
// fmt.Sprintf("%T", obj) fallback that indicates a missing case.
func TestKindOf_MatchesCachedByObject(t *testing.T) {
	for obj := range cachedByObject() {
		kind := kindOf(obj)
		if kind == "" {
			t.Fatalf("kindOf(%T) returned an empty kind", obj)
		}
		if kind[0] == '*' {
			t.Fatalf("kindOf(%T) fell through to the fmt.Sprintf(\"%%T\", obj) default (%q) — add a case for it", obj, kind)
		}
	}
}

func TestShouldPublishUpdate_NonReplicaSetKindsAlwaysPublish(t *testing.T) {
	for _, kind := range []string{"Rollout", "Deployment", "Environment", "SomeUnknownKind"} {
		if !shouldPublishUpdate(kind, "old", "new") {
			t.Fatalf("shouldPublishUpdate(%q, ...) = false, want true (only ReplicaSet is filtered)", kind)
		}
	}
}

func TestShouldPublishUpdate_ReplicaSet_NonRSObjectsAlwaysPublish(t *testing.T) {
	// A DeletedFinalStateUnknown wrapper or any other non-*appsv1.ReplicaSet
	// value must never be silently dropped — publishChange unwraps that
	// separately; shouldPublishUpdate only special-cases the real type.
	if !shouldPublishUpdate("ReplicaSet", "not-a-replicaset", &appsv1.ReplicaSet{}) {
		t.Fatalf("expected publish=true when oldObj isn't a *appsv1.ReplicaSet")
	}
	if !shouldPublishUpdate("ReplicaSet", &appsv1.ReplicaSet{}, "not-a-replicaset") {
		t.Fatalf("expected publish=true when newObj isn't a *appsv1.ReplicaSet")
	}
}

func baseReplicaSet() *appsv1.ReplicaSet {
	return &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "team-a",
			Name:      "app-1-abc123",
			Labels:    map[string]string{"pod-template-hash": "abc123"},
		},
		Spec: appsv1.ReplicaSetSpec{
			Replicas: k8sptr.To(int32(3)),
		},
		Status: appsv1.ReplicaSetStatus{
			Replicas:          3,
			ReadyReplicas:     3,
			AvailableReplicas: 3,
		},
	}
}

func TestShouldPublishUpdate_ReplicaSet_BookkeepingOnlyChangeIsFiltered(t *testing.T) {
	oldRS := baseReplicaSet()
	newRS := baseReplicaSet()
	// Simulate the noisy write this filter exists for: only
	// observedGeneration/timestamps change, nothing a viewer would see.
	newRS.Status.ObservedGeneration = oldRS.Status.ObservedGeneration + 1
	newRS.ResourceVersion = "12345"

	if shouldPublishUpdate("ReplicaSet", oldRS, newRS) {
		t.Fatalf("expected a bookkeeping-only ReplicaSet update (observedGeneration/resourceVersion only) to be filtered out")
	}
}

func TestShouldPublishUpdate_ReplicaSet_ReadyReplicasChangeIsPublished(t *testing.T) {
	oldRS := baseReplicaSet()
	newRS := baseReplicaSet()
	newRS.Status.ReadyReplicas = 2

	if !shouldPublishUpdate("ReplicaSet", oldRS, newRS) {
		t.Fatalf("expected a readyReplicas change to be published")
	}
}

func TestShouldPublishUpdate_ReplicaSet_AvailableReplicasChangeIsPublished(t *testing.T) {
	oldRS := baseReplicaSet()
	newRS := baseReplicaSet()
	newRS.Status.AvailableReplicas = 1

	if !shouldPublishUpdate("ReplicaSet", oldRS, newRS) {
		t.Fatalf("expected an availableReplicas change to be published")
	}
}

func TestShouldPublishUpdate_ReplicaSet_ReplicasChangeIsPublished(t *testing.T) {
	oldRS := baseReplicaSet()
	newRS := baseReplicaSet()
	newRS.Status.Replicas = 4

	if !shouldPublishUpdate("ReplicaSet", oldRS, newRS) {
		t.Fatalf("expected a status.replicas change to be published")
	}
}

func TestShouldPublishUpdate_ReplicaSet_SpecReplicasChangeIsPublished(t *testing.T) {
	oldRS := baseReplicaSet()
	newRS := baseReplicaSet()
	newRS.Spec.Replicas = k8sptr.To(int32(5))

	if !shouldPublishUpdate("ReplicaSet", oldRS, newRS) {
		t.Fatalf("expected a spec.replicas change to be published")
	}
}

func TestShouldPublishUpdate_ReplicaSet_TemplateHashChangeIsPublished(t *testing.T) {
	oldRS := baseReplicaSet()
	newRS := baseReplicaSet()
	newRS.Labels = map[string]string{"pod-template-hash": "def456"}

	if !shouldPublishUpdate("ReplicaSet", oldRS, newRS) {
		t.Fatalf("expected a pod-template-hash label change to be published")
	}
}

func TestShouldPublishUpdate_ReplicaSet_NilSpecReplicasHandledSafely(t *testing.T) {
	oldRS := baseReplicaSet()
	oldRS.Spec.Replicas = nil
	newRS := baseReplicaSet()
	newRS.Spec.Replicas = nil

	if shouldPublishUpdate("ReplicaSet", oldRS, newRS) {
		t.Fatalf("expected two nil spec.Replicas to compare equal (both unset), got a publish")
	}

	newRS2 := baseReplicaSet()
	newRS2.Spec.Replicas = k8sptr.To(int32(3))
	if !shouldPublishUpdate("ReplicaSet", oldRS, newRS2) {
		t.Fatalf("expected nil -> set spec.Replicas to be published")
	}
}
