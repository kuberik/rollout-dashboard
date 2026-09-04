package kubernetes

import (
	"context"
	"errors"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// DERIVED-2026-09-04: BuildDeploymentChildren is the extracted, directly
// testable core of what used to be main.go's
// GET /namespaces/:ns/deployments/:name/children handler body — these tests
// exercise it against fixtures built with NewTestClientWithPods, the same
// way managed_resources_children_test.go already exercises
// GetKustomizationManagedResources.

func fixtureDeploymentWithOneReplicaSetAndPod(t *testing.T) (*Client, string, string) {
	t.Helper()
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "team-a",
			Name:      "web",
			UID:       types.UID("dep-uid-1"),
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "2",
			},
		},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
		Status: appsv1.DeploymentStatus{
			Replicas:          1,
			ReadyReplicas:     1,
			UpdatedReplicas:   1,
			AvailableReplicas: 1,
		},
	}
	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "team-a",
			Name:      "web-abc123",
			UID:       types.UID("rs-uid-1"),
			Labels:    map[string]string{"app": "web"},
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "2",
			},
			OwnerReferences: []metav1.OwnerReference{
				{APIVersion: "apps/v1", Kind: "Deployment", Name: "web", UID: types.UID("dep-uid-1")},
			},
		},
		Spec: appsv1.ReplicaSetSpec{
			Replicas: int32Ptr(1),
		},
		Status: appsv1.ReplicaSetStatus{
			Replicas:      1,
			ReadyReplicas: 1,
		},
	}
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "team-a",
			Name:      "web-abc123-xyz",
			Labels:    map[string]string{"app": "web"},
			OwnerReferences: []metav1.OwnerReference{
				{APIVersion: "apps/v1", Kind: "ReplicaSet", Name: "web-abc123", UID: types.UID("rs-uid-1")},
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			Conditions: []corev1.PodCondition{
				{Type: corev1.PodReady, Status: corev1.ConditionTrue},
			},
		},
	}

	c, _, err := NewTestClientWithPods([]client.Object{deployment, rs}, pod)
	if err != nil {
		t.Fatalf("NewTestClientWithPods: %v", err)
	}
	return c, "team-a", "web"
}

func int32Ptr(v int32) *int32 { return &v }

func TestBuildDeploymentChildren_ReturnsOwnedReplicaSetAndPod(t *testing.T) {
	c, namespace, name := fixtureDeploymentWithOneReplicaSetAndPod(t)

	got, err := BuildDeploymentChildren(context.Background(), c, namespace, name)
	if err != nil {
		t.Fatalf("BuildDeploymentChildren: %v", err)
	}
	if got.Deployment.Name != "web" || got.Deployment.Namespace != "team-a" {
		t.Fatalf("unexpected deployment identity: %+v", got.Deployment)
	}
	if got.Deployment.ReadyReplicas != 1 {
		t.Fatalf("expected ReadyReplicas from Deployment.Status to be echoed, got %+v", got.Deployment)
	}
	if len(got.ReplicaSets) != 1 {
		t.Fatalf("expected exactly 1 owned ReplicaSet, got %d: %+v", len(got.ReplicaSets), got.ReplicaSets)
	}
	rs := got.ReplicaSets[0]
	if rs.Name != "web-abc123" || !rs.IsCurrentRS {
		t.Fatalf("expected the fixture ReplicaSet to be identified as current, got %+v", rs)
	}
	if len(rs.Pods) != 1 || rs.Pods[0].Name != "web-abc123-xyz" {
		t.Fatalf("expected the fixture Pod under its owning ReplicaSet, got %+v", rs.Pods)
	}
	if !rs.Pods[0].Ready {
		t.Fatalf("expected the fixture Pod (PodReady=True) to be reported ready, got %+v", rs.Pods[0])
	}
}

func TestBuildDeploymentChildren_DeploymentNotFound_WrapsSentinel(t *testing.T) {
	c, err := NewTestClient()
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}

	_, err = BuildDeploymentChildren(context.Background(), c, "team-a", "missing")
	if err == nil {
		t.Fatalf("expected an error for a missing deployment, got nil")
	}
	if !errors.Is(err, ErrDeploymentNotFound) {
		t.Fatalf("expected error to wrap ErrDeploymentNotFound, got: %v", err)
	}
}

func TestBuildDeploymentChildren_NilClientset_ReturnsErrorNotPanic(t *testing.T) {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "web"},
		Spec:       appsv1.DeploymentSpec{Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}}},
	}
	// NewTestClient (unlike NewTestClientWithPods) leaves clientset nil — the
	// same "out of scope" state its own doc comment documents. Regression
	// guard: BuildDeploymentChildren must return a clean error here, not
	// panic on a nil GetClientset() the way the pre-extraction handler would
	// have (it called clientset.CoreV1() with no nil check).
	c, err := NewTestClient(deployment)
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}

	_, err = BuildDeploymentChildren(context.Background(), c, "team-a", "web")
	if err == nil {
		t.Fatalf("expected an error for a nil clientset, got nil")
	}
	if errors.Is(err, ErrDeploymentNotFound) {
		t.Fatalf("a nil clientset is not a 'deployment not found' error, got: %v", err)
	}
}
