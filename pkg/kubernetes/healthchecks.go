package kubernetes

import (
	"context"
	"fmt"
	"sort"
	"sync"

	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// GetHealthChecksBySelector returns health checks that match the given selector.
// A namespace whose List fails is skipped (logged), exactly as it always was;
// HealthCheckResolver.ForSelector is the same lookup that also reports which
// namespaces were skipped.
func (c *Client) GetHealthChecksBySelector(ctx context.Context, namespace string, selector *rolloutv1alpha1.HealthCheckSelectorConfig) ([]rolloutv1alpha1.HealthCheck, error) {
	healthChecks, _ := c.NewHealthCheckResolver().ForSelector(ctx, namespace, selector)
	return healthChecks, nil
}

// HealthCheckResolver evaluates HealthCheckSelectorConfigs against one client
// and lists the cluster's Namespaces at most once, however many selectors it
// resolves. The Namespace List is not a cached kind (it is an apiserver call),
// so GET /api/health-checks resolves every rollout's selector through one
// resolver rather than paying that call per rollout. Not safe for concurrent
// use beyond the once-guarded namespace read.
type HealthCheckResolver struct {
	c          *Client
	nsOnce     sync.Once
	namespaces []corev1.Namespace
	nsErr      error
}

// NewHealthCheckResolver returns a resolver scoped to one request.
func (c *Client) NewHealthCheckResolver() *HealthCheckResolver {
	return &HealthCheckResolver{c: c}
}

func (r *HealthCheckResolver) listNamespaces(ctx context.Context) ([]corev1.Namespace, error) {
	r.nsOnce.Do(func() {
		list := &corev1.NamespaceList{}
		if err := r.c.client.List(ctx, list); err != nil {
			r.nsErr = err
			return
		}
		r.namespaces = list.Items
	})
	return r.namespaces, r.nsErr
}

// ForSelector returns the HealthChecks selector matches for a rollout in
// namespace — the per-rollout endpoint's answer — plus the namespaces whose
// read failed, so the result may be missing checks from them. A failed
// Namespace List reports the rollout's own namespace (the search falls back
// to it, as it always has).
func (r *HealthCheckResolver) ForSelector(ctx context.Context, namespace string, selector *rolloutv1alpha1.HealthCheckSelectorConfig) ([]rolloutv1alpha1.HealthCheck, []string) {
	var healthChecks []rolloutv1alpha1.HealthCheck
	var failed []string

	// If no selector is provided, return empty list
	if selector == nil {
		return healthChecks, nil
	}

	// Determine which namespaces to search
	var namespaces []string

	if selector.NamespaceSelector != nil {
		// Parse the namespace selector to find matching namespaces
		nsSelector, err := metav1.LabelSelectorAsSelector(selector.NamespaceSelector)
		if err != nil {
			// If we can't parse the namespace selector, log the error and default to same namespace
			fmt.Printf("Failed to parse namespace selector: %v, defaulting to same namespace\n", err)
			namespaces = []string{namespace}
		} else {
			nsItems, err := r.listNamespaces(ctx)
			if err != nil {
				fmt.Printf("Failed to list namespaces: %v, defaulting to same namespace\n", err)
				namespaces = []string{namespace}
				failed = append(failed, namespace)
			} else {
				// Filter namespaces by the selector
				for _, ns := range nsItems {
					if nsSelector.Matches(labels.Set(ns.Labels)) {
						namespaces = append(namespaces, ns.Name)
					}
				}
			}
		}
	} else {
		// No namespace selector specified, search only in the rollout's namespace
		namespaces = []string{namespace}
	}

	// If no namespaces found, default to the rollout's namespace
	if len(namespaces) == 0 {
		namespaces = []string{namespace}
	}

	// selector.Selector is a plain metav1.LabelSelector matched against each
	// HealthCheck's own labels — that's exactly what a List label selector
	// evaluates server-side, so push it down instead of listing every
	// HealthCheck in the namespace and matching labels in Go.
	var labelSelector labels.Selector
	if selector.Selector != nil {
		sel, err := metav1.LabelSelectorAsSelector(selector.Selector)
		if err != nil {
			fmt.Printf("Failed to parse label selector: %v\n", err)
			return healthChecks, failed
		}
		labelSelector = sel
	}

	// Search in each namespace
	for _, ns := range namespaces {
		healthCheckList := &rolloutv1alpha1.HealthCheckList{}
		listOpts := []client.ListOption{client.InNamespace(ns)}
		if labelSelector != nil {
			listOpts = append(listOpts, client.MatchingLabelsSelector{Selector: labelSelector})
		}
		if err := r.c.client.List(ctx, healthCheckList, listOpts...); err != nil {
			fmt.Printf("Failed to list health checks in namespace %s: %v\n", ns, err)
			failed = append(failed, ns)
			continue // Skip this namespace if there's an error
		}
		SortByNamespaceName(healthCheckList.Items)

		healthChecks = append(healthChecks, healthCheckList.Items...)
	}

	// namespaces itself can come from an uncached, unsorted NamespaceList walk
	// (the NamespaceSelector branch above) — per-namespace sorting alone
	// doesn't make the concatenation across namespaces deterministic if the
	// namespace search order varies between calls, so sort the aggregate too.
	// This is the health-checks card on the rollout Overview page named in the
	// PERF-2026-09-04 §D sweep as reshuffling on reload.
	SortByNamespaceName(healthChecks)

	return healthChecks, failed
}

// RolloutHealthChecksMeta identifies the Rollout a RolloutHealthChecks item
// belongs to. Shaped like ObjectMeta's JSON (metadata.namespace/name/
// annotations) so the hub fan-in's annotateItemsWithSource and mergeItemLists
// apply to it unchanged.
type RolloutHealthChecksMeta struct {
	Namespace   string            `json:"namespace"`
	Name        string            `json:"name"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

// RolloutHealthChecks is one item of GET /api/health-checks: a Rollout and
// exactly the HealthChecks GET /api/rollouts/:ns/:name/health-checks returns
// for it.
type RolloutHealthChecks struct {
	Metadata     RolloutHealthChecksMeta       `json:"metadata"`
	HealthChecks []rolloutv1alpha1.HealthCheck `json:"healthChecks"`
}

// RolloutHealthChecksFor resolves every rollout's healthCheckSelector (rollouts
// without one are skipped) through one HealthCheckResolver. A rollout whose
// lookup failed in any namespace is left OUT rather than returned with a
// short list — a missing item reads as "unknown", a short list would read as
// "these are all of its checks" — and the failed namespaces come back,
// sorted and deduplicated, for the caller's partialReads.
func (c *Client) RolloutHealthChecksFor(ctx context.Context, rollouts []rolloutv1alpha1.Rollout) ([]RolloutHealthChecks, []string) {
	resolver := c.NewHealthCheckResolver()
	items := make([]RolloutHealthChecks, 0, len(rollouts))
	failedSet := map[string]struct{}{}
	for i := range rollouts {
		r := &rollouts[i]
		if r.Spec.HealthCheckSelector == nil {
			continue
		}
		hcs, failed := resolver.ForSelector(ctx, r.Namespace, r.Spec.HealthCheckSelector)
		if len(failed) > 0 {
			for _, ns := range failed {
				failedSet[ns] = struct{}{}
			}
			continue
		}
		if hcs == nil {
			hcs = []rolloutv1alpha1.HealthCheck{}
		}
		items = append(items, RolloutHealthChecks{
			Metadata:     RolloutHealthChecksMeta{Namespace: r.Namespace, Name: r.Name},
			HealthChecks: hcs,
		})
	}
	var failed []string
	for ns := range failedSet {
		failed = append(failed, ns)
	}
	sort.Strings(failed)
	return items, failed
}
