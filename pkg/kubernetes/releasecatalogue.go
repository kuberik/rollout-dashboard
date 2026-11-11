package kubernetes

import (
	"context"
	"fmt"

	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	releasev1alpha1 "github.com/kuberik/rollout-dashboard/pkg/apis/release/v1alpha1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/discovery"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// ReleaseSource and ReleaseSlice are release-controller's catalogue kinds.
// Like RolloutDependency they are optional: a cluster without
// release-controller has no CRDs, and the list fails with a RESTMapper "no
// matches for kind" error. Callers distinguish that (IsCRDNotInstalled) from a
// real read failure.

// IsCRDNotInstalled reports whether err means the kind's CRD is absent from
// the cluster (as opposed to a transient or authorization failure).
func IsCRDNotInstalled(err error) bool {
	if err == nil {
		return false
	}
	return meta.IsNoMatchError(err) ||
		apierrors.IsNotFound(err) ||
		discovery.IsGroupDiscoveryFailedError(err)
}

// GetReleaseSources lists ReleaseSources in a namespace.
func (c *Client) GetReleaseSources(ctx context.Context, namespace string) (*releasev1alpha1.ReleaseSourceList, error) {
	list := &releasev1alpha1.ReleaseSourceList{}
	if err := c.client.List(ctx, list, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list release sources: %w", err)
	}
	for i := range list.Items {
		stripManagedFields(&list.Items[i].ObjectMeta)
	}
	return list, nil
}

// GetReleaseSourcesAllNamespaces lists ReleaseSources across all namespaces.
func (c *Client) GetReleaseSourcesAllNamespaces(ctx context.Context) (*releasev1alpha1.ReleaseSourceList, error) {
	list := &releasev1alpha1.ReleaseSourceList{}
	if err := c.client.List(ctx, list); err != nil {
		return nil, fmt.Errorf("failed to list release sources across all namespaces: %w", err)
	}
	for i := range list.Items {
		stripManagedFields(&list.Items[i].ObjectMeta)
	}
	return list, nil
}

// GetReleaseSlices lists ReleaseSlices in a namespace.
func (c *Client) GetReleaseSlices(ctx context.Context, namespace string) (*releasev1alpha1.ReleaseSliceList, error) {
	list := &releasev1alpha1.ReleaseSliceList{}
	if err := c.client.List(ctx, list, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list release slices: %w", err)
	}
	for i := range list.Items {
		stripManagedFields(&list.Items[i].ObjectMeta)
	}
	return list, nil
}

// GetReleaseSlicesAllNamespaces lists ReleaseSlices across all namespaces.
func (c *Client) GetReleaseSlicesAllNamespaces(ctx context.Context) (*releasev1alpha1.ReleaseSliceList, error) {
	list := &releasev1alpha1.ReleaseSliceList{}
	if err := c.client.List(ctx, list); err != nil {
		return nil, fmt.Errorf("failed to list release slices across all namespaces: %w", err)
	}
	for i := range list.Items {
		stripManagedFields(&list.Items[i].ObjectMeta)
	}
	return list, nil
}

// stripManagedFields mirrors the informer cache's TransformStripManagedFields
// for reads that bypass the cache (uncached fallback client).
func stripManagedFields(m *metav1.ObjectMeta) { m.ManagedFields = nil }

// GetRolloutReleaseSource returns the ReleaseSource a rollout names in
// spec.releaseSourceRef, read from the rollout's namespace.
func (c *Client) GetRolloutReleaseSource(ctx context.Context, rollout *rolloutv1alpha1.Rollout) (*releasev1alpha1.ReleaseSource, error) {
	if rollout == nil || rollout.Spec.ReleaseSourceRef == nil || rollout.Spec.ReleaseSourceRef.Name == "" {
		return nil, ErrNoReleaseImage
	}
	src := &releasev1alpha1.ReleaseSource{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: rollout.Namespace, Name: rollout.Spec.ReleaseSourceRef.Name}, src); err != nil {
		return nil, fmt.Errorf("failed to get release source: %w", err)
	}
	stripManagedFields(&src.ObjectMeta)
	return src, nil
}
