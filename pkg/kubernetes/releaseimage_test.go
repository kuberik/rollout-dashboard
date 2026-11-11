package kubernetes

import (
	"context"
	"testing"
	"time"

	imagereflectorv1 "github.com/fluxcd/image-reflector-controller/api/v1"
	meta "github.com/fluxcd/pkg/apis/meta"
	releasev1alpha1 "github.com/kuberik/rollout-dashboard/pkg/apis/release/v1alpha1"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

func source(spec releasev1alpha1.ReleaseSourceSpec, status releasev1alpha1.ReleaseSourceStatus) *releasev1alpha1.ReleaseSource {
	return &releasev1alpha1.ReleaseSource{ObjectMeta: metav1.ObjectMeta{Name: "src", Namespace: "ns"}, Spec: spec, Status: status}
}

func resolve(t *testing.T, ref string, objs ...client.Object) (*ReleaseImage, error) {
	t.Helper()
	c, err := NewTestClient(objs...)
	require.NoError(t, err)
	return c.ResolveReleaseImage(context.Background(), rolloutWithSource(ref))
}

func TestResolveReleaseImage_OCIImageAndSecretAndLastSync(t *testing.T) {
	synced := metav1.NewTime(time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC))
	got, err := resolve(t, "src", source(
		releasev1alpha1.ReleaseSourceSpec{OCI: &releasev1alpha1.OCISource{Image: "ghcr.io/o/app", SecretRef: &corev1.LocalObjectReference{Name: "pull"}}},
		releasev1alpha1.ReleaseSourceStatus{LastSyncTime: &synced},
	))
	require.NoError(t, err)
	require.Equal(t, "ghcr.io/o/app", got.Image)
	require.Equal(t, "pull", got.SecretName)
	require.Equal(t, "2026-11-01T12:00:00Z", got.LastSync)
}

func TestResolveReleaseImage_ImagePolicyRefThroughImageRepository(t *testing.T) {
	got, err := resolve(t, "src",
		source(releasev1alpha1.ReleaseSourceSpec{OCI: &releasev1alpha1.OCISource{ImagePolicyRef: &corev1.LocalObjectReference{Name: "pol"}}}, releasev1alpha1.ReleaseSourceStatus{}),
		&imagereflectorv1.ImagePolicy{
			ObjectMeta: metav1.ObjectMeta{Name: "pol", Namespace: "ns"},
			Spec:       imagereflectorv1.ImagePolicySpec{ImageRepositoryRef: meta.NamespacedObjectReference{Name: "repo"}},
		},
		&imagereflectorv1.ImageRepository{
			ObjectMeta: metav1.ObjectMeta{Name: "repo", Namespace: "ns"},
			Spec: imagereflectorv1.ImageRepositorySpec{
				Image:     "ghcr.io/o/policy",
				SecretRef: &meta.LocalObjectReference{Name: "repo-pull"},
			},
		},
	)
	require.NoError(t, err)
	require.Equal(t, "ghcr.io/o/policy", got.Image)
	require.Equal(t, "repo-pull", got.SecretName)
}

func TestResolveReleaseImage_NoSourceIs422(t *testing.T) {
	_, err := resolve(t, "")
	require.ErrorIs(t, err, ErrNoReleaseImage)
	status, ok := IsReleaseImageUnresolvable(err)
	require.True(t, ok)
	require.Equal(t, 422, status)
}

func TestResolveReleaseImage_MissingSourceIs404(t *testing.T) {
	_, err := resolve(t, "src")
	require.True(t, apierrors.IsNotFound(err), "%v", err)
	status, ok := IsReleaseImageUnresolvable(err)
	require.True(t, ok)
	require.Equal(t, 404, status)
}

func TestResolveReleaseImage_BrokenSourceIs422WithTheReason(t *testing.T) {
	notReady := source(
		releasev1alpha1.ReleaseSourceSpec{OCI: &releasev1alpha1.OCISource{Image: "ghcr.io/o/app"}},
		releasev1alpha1.ReleaseSourceStatus{Conditions: []metav1.Condition{{Type: releasev1alpha1.ReadyCondition, Status: metav1.ConditionFalse, Reason: "SourceUnreachable", Message: "registry refused the credentials"}}},
	)
	noOCI := source(releasev1alpha1.ReleaseSourceSpec{}, releasev1alpha1.ReleaseSourceStatus{})
	neither := source(releasev1alpha1.ReleaseSourceSpec{OCI: &releasev1alpha1.OCISource{}}, releasev1alpha1.ReleaseSourceStatus{})
	for name, src := range map[string]*releasev1alpha1.ReleaseSource{"not ready": notReady, "no oci": noOCI, "neither image nor policy": neither} {
		_, err := resolve(t, "src", src)
		require.ErrorIs(t, err, ErrReleaseSourceNotUsable, name)
		status, ok := IsReleaseImageUnresolvable(err)
		require.True(t, ok, name)
		require.Equal(t, 422, status, name)
	}
	_, err := resolve(t, "src", notReady)
	require.Contains(t, err.Error(), "SourceUnreachable")
	require.Contains(t, err.Error(), "registry refused the credentials")
}
