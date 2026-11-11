package kubernetes

import (
	"context"
	"testing"
	"time"

	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	releasev1alpha1 "github.com/kuberik/rollout-dashboard/pkg/apis/release/v1alpha1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

func rolloutWithSource(ref string) *rolloutv1alpha1.Rollout {
	r := &rolloutv1alpha1.Rollout{ObjectMeta: metav1.ObjectMeta{Name: "app", Namespace: "ns"}}
	if ref != "" {
		r.Spec.ReleaseSourceRef = &corev1.LocalObjectReference{Name: ref}
	}
	return r
}

func TestRolloutReleaseSourceComesFromTheReferencedSource(t *testing.T) {
	synced := metav1.NewTime(time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC))
	src := &releasev1alpha1.ReleaseSource{
		ObjectMeta: metav1.ObjectMeta{Name: "app-releases", Namespace: "ns"},
		Spec: releasev1alpha1.ReleaseSourceSpec{OCI: &releasev1alpha1.OCISource{
			Image:     "registry.example/app",
			SecretRef: &corev1.LocalObjectReference{Name: "pull"},
		}},
		Status: releasev1alpha1.ReleaseSourceStatus{
			LastSyncTime: &synced,
			Artifact:     &releasev1alpha1.ArtifactMetadata{Title: "App", Description: "An app", SourceURL: "https://example.test/app"},
		},
	}
	c, err := NewTestClient(src)
	if err != nil {
		t.Fatal(err)
	}
	got, err := c.GetRolloutReleaseSource(context.Background(), rolloutWithSource("app-releases"))
	if err != nil {
		t.Fatal(err)
	}
	if got.Spec.OCI.Image != "registry.example/app" || got.Spec.OCI.SecretRef.Name != "pull" {
		t.Errorf("image/secret = %+v", got.Spec.OCI)
	}
	if got.Status.Artifact == nil || got.Status.Artifact.Title != "App" || got.Status.Artifact.SourceURL != "https://example.test/app" {
		t.Errorf("artifact metadata = %+v", got.Status.Artifact)
	}
	if got.Status.LastSyncTime == nil || !got.Status.LastSyncTime.Equal(&synced) {
		t.Errorf("lastSyncTime = %v", got.Status.LastSyncTime)
	}
}

func TestRolloutWithoutAReleaseSourceHasNone(t *testing.T) {
	c, err := NewTestClient()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.GetRolloutReleaseSource(context.Background(), rolloutWithSource("")); err == nil {
		t.Error("a rollout with no releaseSourceRef must not resolve a source")
	}
	if _, err := c.GetRolloutReleaseSource(context.Background(), rolloutWithSource("missing")); err == nil {
		t.Error("a missing source must be an error")
	}
}

func TestReconcileAsksTheReleaseSourceToSyncAndReturnsItsLastSync(t *testing.T) {
	synced := metav1.NewTime(time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC))
	src := &releasev1alpha1.ReleaseSource{
		ObjectMeta: metav1.ObjectMeta{Name: "app-releases", Namespace: "ns"},
		Status:     releasev1alpha1.ReleaseSourceStatus{LastSyncTime: &synced},
	}
	c, err := NewTestClient(rolloutWithSource("app-releases"), src)
	if err != nil {
		t.Fatal(err)
	}
	prev, err := c.ReconcileAllFluxResources(context.Background(), "ns", "app")
	if err != nil {
		t.Fatal(err)
	}
	if prev != "2026-11-01T12:00:00Z" {
		t.Errorf("previousScanTime = %q", prev)
	}
	after := &releasev1alpha1.ReleaseSource{}
	if err := c.client.Get(context.Background(), client.ObjectKey{Namespace: "ns", Name: "app-releases"}, after); err != nil {
		t.Fatal(err)
	}
	if after.Annotations["reconcile.fluxcd.io/requestedAt"] == "" {
		t.Error("the release source was not annotated to sync now")
	}
}
