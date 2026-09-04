package kubernetes

import (
	"context"
	"testing"
	"time"

	kustomizev1 "github.com/fluxcd/kustomize-controller/api/v1"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
)

// CHILDREN-2026-09-04: the children (/namespaces/:ns/deployments/:name/children)
// and managed-resources (/kustomizations/:ns/:name/managed-resources) read
// paths now serve apps/v1 Deployment and ReplicaSet from the same
// controller-runtime client cache.go's read cache backs — these tests
// exercise the Client-level methods those handlers call, against the fake
// client fixtures this package's other tests already use (NewTestClient).

func TestGetDeployment_ReturnsFixture(t *testing.T) {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "web"},
	}
	c, err := NewTestClient(deployment)
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}

	got, err := c.GetDeployment(context.Background(), "team-a", "web")
	if err != nil {
		t.Fatalf("GetDeployment: %v", err)
	}
	if got.Namespace != "team-a" || got.Name != "web" {
		t.Fatalf("got wrong deployment: %+v", got)
	}
}

func TestGetDeployment_NotFoundReturnsError(t *testing.T) {
	c, err := NewTestClient()
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}

	if _, err := c.GetDeployment(context.Background(), "team-a", "missing"); err == nil {
		t.Fatalf("expected an error for a missing deployment, got nil")
	}
}

func TestGetReplicaSetsBySelector_FiltersByLabelSelector(t *testing.T) {
	matching := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "team-a", Name: "web-abc123",
			Labels: map[string]string{"app": "web"},
		},
	}
	otherApp := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "team-a", Name: "worker-def456",
			Labels: map[string]string{"app": "worker"},
		},
	}
	otherNamespace := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "team-b", Name: "web-ghi789",
			Labels: map[string]string{"app": "web"},
		},
	}
	c, err := NewTestClient(matching, otherApp, otherNamespace)
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}

	selector := labels.SelectorFromSet(labels.Set{"app": "web"})
	got, err := c.GetReplicaSetsBySelector(context.Background(), "team-a", selector)
	if err != nil {
		t.Fatalf("GetReplicaSetsBySelector: %v", err)
	}
	if len(got.Items) != 1 || got.Items[0].Name != "web-abc123" {
		t.Fatalf("expected exactly [web-abc123], got %+v", got.Items)
	}
}

func TestAppsV1CachedKind(t *testing.T) {
	cases := []struct {
		group, version, kind string
		want                 bool
	}{
		{"apps", "v1", "Deployment", true},
		{"apps", "v1", "ReplicaSet", true},
		{"apps", "v1", "StatefulSet", false},
		{"apps", "v1beta1", "Deployment", false},
		{"", "v1", "ConfigMap", false},
		{"kustomize.toolkit.fluxcd.io", "v1", "Kustomization", false},
	}
	for _, tc := range cases {
		if got := appsV1CachedKind(tc.group, tc.version, tc.kind); got != tc.want {
			t.Errorf("appsV1CachedKind(%q, %q, %q) = %v, want %v", tc.group, tc.version, tc.kind, got, tc.want)
		}
	}
}

// inventoryEntryID mirrors object.ObjMetadata's String() format
// ("<namespace>_<name>_<group>_<kind>") without importing the cli-utils
// object package into the test, since that format is a stable, documented
// contract (ResourceRef.ID's own doc comment in kustomize-controller/api).
func inventoryEntryID(namespace, name, group, kind string) string {
	return namespace + "_" + name + "_" + group + "_" + kind
}

func TestGetKustomizationManagedResources_DeploymentAndReplicaSet_ServedViaCachedPath(t *testing.T) {
	created := metav1.NewTime(time.Now().Add(-time.Hour))

	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         "team-a",
			Name:              "web",
			CreationTimestamp: created,
		},
	}
	replicaSet := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         "team-a",
			Name:              "web-abc123",
			CreationTimestamp: created,
		},
	}
	kustomization := &kustomizev1.Kustomization{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "hello-world"},
		Status: kustomizev1.KustomizationStatus{
			Inventory: &kustomizev1.ResourceInventory{
				Entries: []kustomizev1.ResourceRef{
					{ID: inventoryEntryID("team-a", "web", "apps", "Deployment"), Version: "v1"},
					{ID: inventoryEntryID("team-a", "web-abc123", "apps", "ReplicaSet"), Version: "v1"},
				},
			},
		},
	}

	c, err := NewTestClient(deployment, replicaSet, kustomization)
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}

	got, err := c.GetKustomizationManagedResources(context.Background(), "team-a", "hello-world")
	if err != nil {
		t.Fatalf("GetKustomizationManagedResources: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 managed resources, got %d: %+v", len(got), got)
	}

	byKind := map[string]ManagedResourceStatus{}
	for _, r := range got {
		byKind[r.GroupVersionKind] = r
	}

	dep, ok := byKind["apps/v1/Deployment"]
	if !ok {
		t.Fatalf("expected an apps/v1/Deployment entry, got %+v", got)
	}
	if dep.Name != "web" || dep.Namespace != "team-a" {
		t.Fatalf("Deployment entry has wrong identity: %+v", dep)
	}
	if dep.Object == nil {
		t.Fatalf("expected the cached Deployment path to still populate Object")
	}
	if dep.Object.GetAPIVersion() != "apps/v1" || dep.Object.GetKind() != "Deployment" {
		t.Fatalf("expected Object's apiVersion/kind to be stamped (typed Get/List doesn't populate TypeMeta), got apiVersion=%q kind=%q", dep.Object.GetAPIVersion(), dep.Object.GetKind())
	}
	// The fake client fixture has no managedFields (nothing sets them via
	// server-side apply in this test), so managedResourceStatusFromObject's
	// fallback must use CreationTimestamp — not leave the Go zero value,
	// which the frontend has no guard against (see that function's doc
	// comment).
	if dep.LastModified.IsZero() {
		t.Fatalf("expected LastModified to fall back to CreationTimestamp instead of the zero value")
	}
	// metav1.Time round-trips through JSON at whole-second precision (its
	// MarshalJSON drops fractional seconds) — the object goes through
	// exactly that round trip inside listInventoryGroupCached's
	// runtime.DefaultUnstructuredConverter.ToUnstructured conversion, so
	// compare truncated to the second rather than requiring exact equality.
	if !dep.LastModified.Truncate(time.Second).Equal(created.Time.Truncate(time.Second)) {
		t.Fatalf("expected LastModified to equal CreationTimestamp %v, got %v", created.Time, dep.LastModified)
	}

	rs, ok := byKind["apps/v1/ReplicaSet"]
	if !ok {
		t.Fatalf("expected an apps/v1/ReplicaSet entry, got %+v", got)
	}
	if rs.Name != "web-abc123" || rs.Namespace != "team-a" {
		t.Fatalf("ReplicaSet entry has wrong identity: %+v", rs)
	}
	if rs.Object == nil || rs.Object.GetAPIVersion() != "apps/v1" || rs.Object.GetKind() != "ReplicaSet" {
		t.Fatalf("expected ReplicaSet Object with apiVersion/kind stamped, got %+v", rs.Object)
	}
	if rs.LastModified.IsZero() {
		t.Fatalf("expected ReplicaSet LastModified to fall back to CreationTimestamp instead of the zero value")
	}
}

func TestGetKustomizationManagedResources_NonAppsKindStillUsesGenericPath(t *testing.T) {
	// A ConfigMap in the inventory must still go through the generic
	// unstructured List path (listInventoryGroup falls back when
	// appsV1CachedKind says no) — this is a regression guard that adding
	// the Deployment/ReplicaSet fast path didn't accidentally swallow every
	// other kind.
	kustomization := &kustomizev1.Kustomization{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "hello-world"},
		Status: kustomizev1.KustomizationStatus{
			Inventory: &kustomizev1.ResourceInventory{
				Entries: []kustomizev1.ResourceRef{
					{ID: inventoryEntryID("team-a", "missing-cm", "", "ConfigMap"), Version: "v1"},
				},
			},
		},
	}
	c, err := NewTestClient(kustomization)
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}

	got, err := c.GetKustomizationManagedResources(context.Background(), "team-a", "hello-world")
	if err != nil {
		t.Fatalf("GetKustomizationManagedResources: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 managed resource (NotFound), got %d: %+v", len(got), got)
	}
	if got[0].Status != "NotFound" {
		t.Fatalf("expected NotFound status for a ConfigMap absent from the fixture, got %+v", got[0])
	}
}
