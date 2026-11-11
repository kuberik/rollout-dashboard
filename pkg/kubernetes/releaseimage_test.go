package kubernetes

import (
	"context"
	"testing"

	imagereflectorv1 "github.com/fluxcd/image-reflector-controller/api/v1"
	meta "github.com/fluxcd/pkg/apis/meta"
	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	releasev1alpha1 "github.com/kuberik/rollout-dashboard/pkg/apis/release/v1alpha1"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func releaseImageClient(t *testing.T, objs ...client.Object) *Client {
	t.Helper()
	s := runtime.NewScheme()
	require.NoError(t, rolloutv1alpha1.AddToScheme(s))
	require.NoError(t, releasev1alpha1.AddToScheme(s))
	require.NoError(t, imagereflectorv1.AddToScheme(s))
	return &Client{client: fake.NewClientBuilder().WithScheme(s).WithObjects(objs...).Build()}
}

func rolloutWithRef(mut func(*rolloutv1alpha1.Rollout)) *rolloutv1alpha1.Rollout {
	r := &rolloutv1alpha1.Rollout{ObjectMeta: metav1.ObjectMeta{Name: "app", Namespace: "ns"}}
	mut(r)
	return r
}

func policyAndRepo() []client.Object {
	return []client.Object{
		&imagereflectorv1.ImagePolicy{
			ObjectMeta: metav1.ObjectMeta{Name: "pol", Namespace: "ns"},
			Spec:       imagereflectorv1.ImagePolicySpec{ImageRepositoryRef: meta.NamespacedObjectReference{Name: "repo"}},
		},
		&imagereflectorv1.ImageRepository{
			ObjectMeta: metav1.ObjectMeta{Name: "repo", Namespace: "ns"},
			Spec: imagereflectorv1.ImageRepositorySpec{
				Image:     "ghcr.io/o/legacy",
				SecretRef: &meta.LocalObjectReference{Name: "creds"},
			},
		},
	}
}

func TestResolveReleaseImage_ReleaseSourceImage(t *testing.T) {
	src := &releasev1alpha1.ReleaseSource{
		ObjectMeta: metav1.ObjectMeta{Name: "src", Namespace: "ns"},
		Spec: releasev1alpha1.ReleaseSourceSpec{OCI: &releasev1alpha1.OCISource{
			Image: "ghcr.io/o/app", SecretRef: &corev1.LocalObjectReference{Name: "pull"},
		}},
	}
	r := rolloutWithRef(func(r *rolloutv1alpha1.Rollout) { r.Spec.ReleaseSourceRef = &corev1.LocalObjectReference{Name: "src"} })
	got, err := releaseImageClient(t, src).ResolveReleaseImage(context.Background(), r)
	require.NoError(t, err)
	require.Equal(t, "ghcr.io/o/app", got.Image)
	require.Equal(t, "pull", got.SecretName)
	require.Nil(t, got.Repository)
}

func TestResolveReleaseImage_ReleaseSourceImagePolicyRef(t *testing.T) {
	src := &releasev1alpha1.ReleaseSource{
		ObjectMeta: metav1.ObjectMeta{Name: "src", Namespace: "ns"},
		Spec: releasev1alpha1.ReleaseSourceSpec{OCI: &releasev1alpha1.OCISource{
			ImagePolicyRef: &corev1.LocalObjectReference{Name: "pol"},
		}},
	}
	r := rolloutWithRef(func(r *rolloutv1alpha1.Rollout) { r.Spec.ReleaseSourceRef = &corev1.LocalObjectReference{Name: "src"} })
	got, err := releaseImageClient(t, append(policyAndRepo(), src)...).ResolveReleaseImage(context.Background(), r)
	require.NoError(t, err)
	require.Equal(t, "ghcr.io/o/legacy", got.Image)
	require.Equal(t, "creds", got.SecretName)
	require.NotNil(t, got.Repository)
}

func TestResolveReleaseImage_LegacyReleasesImagePolicy(t *testing.T) {
	r := rolloutWithRef(func(r *rolloutv1alpha1.Rollout) {
		r.Spec.ReleasesImagePolicy = corev1.LocalObjectReference{Name: "pol"}
	})
	got, err := releaseImageClient(t, policyAndRepo()...).ResolveReleaseImage(context.Background(), r)
	require.NoError(t, err)
	require.Equal(t, "ghcr.io/o/legacy", got.Image)
}

func TestResolveReleaseImage_SourceWinsOverLegacy(t *testing.T) {
	src := &releasev1alpha1.ReleaseSource{
		ObjectMeta: metav1.ObjectMeta{Name: "src", Namespace: "ns"},
		Spec:       releasev1alpha1.ReleaseSourceSpec{OCI: &releasev1alpha1.OCISource{Image: "ghcr.io/o/new"}},
	}
	r := rolloutWithRef(func(r *rolloutv1alpha1.Rollout) {
		r.Spec.ReleaseSourceRef = &corev1.LocalObjectReference{Name: "src"}
		r.Spec.ReleasesImagePolicy = corev1.LocalObjectReference{Name: "pol"}
	})
	got, err := releaseImageClient(t, append(policyAndRepo(), src)...).ResolveReleaseImage(context.Background(), r)
	require.NoError(t, err)
	require.Equal(t, "ghcr.io/o/new", got.Image)
}

func TestResolveReleaseImage_MissingIsNotA500(t *testing.T) {
	ctx := context.Background()
	// no source at all
	_, err := releaseImageClient(t).ResolveReleaseImage(ctx, rolloutWithRef(func(*rolloutv1alpha1.Rollout) {}))
	st, ok := IsReleaseImageUnresolvable(err)
	require.True(t, ok)
	require.Equal(t, 422, st)

	// dangling releaseSourceRef
	r := rolloutWithRef(func(r *rolloutv1alpha1.Rollout) { r.Spec.ReleaseSourceRef = &corev1.LocalObjectReference{Name: "gone"} })
	_, err = releaseImageClient(t).ResolveReleaseImage(ctx, r)
	require.True(t, apierrors.IsNotFound(err))
	st, ok = IsReleaseImageUnresolvable(err)
	require.True(t, ok)
	require.Equal(t, 404, st)

	// dangling imagePolicyRef
	src := &releasev1alpha1.ReleaseSource{
		ObjectMeta: metav1.ObjectMeta{Name: "src", Namespace: "ns"},
		Spec:       releasev1alpha1.ReleaseSourceSpec{OCI: &releasev1alpha1.OCISource{ImagePolicyRef: &corev1.LocalObjectReference{Name: "nope"}}},
	}
	r = rolloutWithRef(func(r *rolloutv1alpha1.Rollout) { r.Spec.ReleaseSourceRef = &corev1.LocalObjectReference{Name: "src"} })
	_, err = releaseImageClient(t, src).ResolveReleaseImage(ctx, r)
	st, ok = IsReleaseImageUnresolvable(err)
	require.True(t, ok)
	require.Equal(t, 404, st)

	// source without oci
	empty := &releasev1alpha1.ReleaseSource{ObjectMeta: metav1.ObjectMeta{Name: "src", Namespace: "ns"}}
	_, err = releaseImageClient(t, empty).ResolveReleaseImage(ctx, r)
	require.Error(t, err)
}
