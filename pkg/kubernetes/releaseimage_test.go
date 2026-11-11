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
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func releaseImageClient(t *testing.T, objs ...client.Object) *Client {
	t.Helper()
	s := runtime.NewScheme()
	require.NoError(t, releasev1alpha1.AddToScheme(s))
	require.NoError(t, imagereflectorv1.AddToScheme(s))
	return &Client{client: fake.NewClientBuilder().WithScheme(s).WithObjects(objs...).Build()}
}

// rolloutWithRef returns the typed Rollout (which has no releaseSourceRef
// field in the pinned API) and the stored object, which carries
// spec.releaseSourceRef and/or spec.releasesImagePolicy.
func rolloutWithRef(sourceRef, legacyPolicy string) (*rolloutv1alpha1.Rollout, client.Object) {
	r := &rolloutv1alpha1.Rollout{ObjectMeta: metav1.ObjectMeta{Name: "app", Namespace: "ns"}}
	if legacyPolicy != "" {
		r.Spec.ReleasesImagePolicy = corev1.LocalObjectReference{Name: legacyPolicy}
	}
	spec := map[string]interface{}{}
	if sourceRef != "" {
		spec["releaseSourceRef"] = map[string]interface{}{"name": sourceRef}
	}
	if legacyPolicy != "" {
		spec["releasesImagePolicy"] = map[string]interface{}{"name": legacyPolicy}
	}
	u := &unstructured.Unstructured{Object: map[string]interface{}{"spec": spec}}
	u.SetGroupVersionKind(rolloutv1alpha1.GroupVersion.WithKind("Rollout"))
	u.SetName("app")
	u.SetNamespace("ns")
	return r, u
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
	r, ro := rolloutWithRef("src", "")
	got, err := releaseImageClient(t, ro, src).ResolveReleaseImage(context.Background(), r)
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
	r, ro := rolloutWithRef("src", "")
	got, err := releaseImageClient(t, append(policyAndRepo(), ro, src)...).ResolveReleaseImage(context.Background(), r)
	require.NoError(t, err)
	require.Equal(t, "ghcr.io/o/legacy", got.Image)
	require.Equal(t, "creds", got.SecretName)
	require.NotNil(t, got.Repository)
}

func TestResolveReleaseImage_LegacyReleasesImagePolicy(t *testing.T) {
	r, ro := rolloutWithRef("", "pol")
	got, err := releaseImageClient(t, append(policyAndRepo(), ro)...).ResolveReleaseImage(context.Background(), r)
	require.NoError(t, err)
	require.Equal(t, "ghcr.io/o/legacy", got.Image)
}

func TestResolveReleaseImage_SourceWinsOverLegacy(t *testing.T) {
	src := &releasev1alpha1.ReleaseSource{
		ObjectMeta: metav1.ObjectMeta{Name: "src", Namespace: "ns"},
		Spec:       releasev1alpha1.ReleaseSourceSpec{OCI: &releasev1alpha1.OCISource{Image: "ghcr.io/o/new"}},
	}
	r, ro := rolloutWithRef("src", "pol")
	got, err := releaseImageClient(t, append(policyAndRepo(), ro, src)...).ResolveReleaseImage(context.Background(), r)
	require.NoError(t, err)
	require.Equal(t, "ghcr.io/o/new", got.Image)
}

func TestResolveReleaseImage_MissingIsNotA500(t *testing.T) {
	ctx := context.Background()
	// no source at all
	r, ro := rolloutWithRef("", "")
	_, err := releaseImageClient(t, ro).ResolveReleaseImage(ctx, r)
	st, ok := IsReleaseImageUnresolvable(err)
	require.True(t, ok)
	require.Equal(t, 422, st)

	// dangling releaseSourceRef
	r, ro = rolloutWithRef("gone", "")
	_, err = releaseImageClient(t, ro).ResolveReleaseImage(ctx, r)
	require.True(t, apierrors.IsNotFound(err))
	st, ok = IsReleaseImageUnresolvable(err)
	require.True(t, ok)
	require.Equal(t, 404, st)

	// dangling imagePolicyRef
	src := &releasev1alpha1.ReleaseSource{
		ObjectMeta: metav1.ObjectMeta{Name: "src", Namespace: "ns"},
		Spec:       releasev1alpha1.ReleaseSourceSpec{OCI: &releasev1alpha1.OCISource{ImagePolicyRef: &corev1.LocalObjectReference{Name: "nope"}}},
	}
	r, ro = rolloutWithRef("src", "")
	_, err = releaseImageClient(t, ro, src).ResolveReleaseImage(ctx, r)
	st, ok = IsReleaseImageUnresolvable(err)
	require.True(t, ok)
	require.Equal(t, 404, st)

	// source without oci
	empty := &releasev1alpha1.ReleaseSource{ObjectMeta: metav1.ObjectMeta{Name: "src", Namespace: "ns"}}
	_, err = releaseImageClient(t, ro, empty).ResolveReleaseImage(ctx, r)
	require.Error(t, err)
}

// The typed Rollout has no releaseSourceRef field; resolution must still work
// from the stored object alone.
func TestResolveReleaseImage_TypedRolloutHasNoRefField(t *testing.T) {
	src := &releasev1alpha1.ReleaseSource{
		ObjectMeta: metav1.ObjectMeta{Name: "src", Namespace: "ns"},
		Spec:       releasev1alpha1.ReleaseSourceSpec{OCI: &releasev1alpha1.OCISource{Image: "ghcr.io/o/app"}},
	}
	r, ro := rolloutWithRef("src", "")
	require.Empty(t, r.Spec.ReleasesImagePolicy.Name)
	got, err := releaseImageClient(t, ro, src).ResolveReleaseImage(context.Background(), r)
	require.NoError(t, err)
	require.Equal(t, "ghcr.io/o/app", got.Image)
}
