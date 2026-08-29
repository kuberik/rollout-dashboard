package kubernetes

import (
	"context"
	"fmt"

	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	k8sptr "k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// RolloutDependency gates a consumer Rollout on the deployed contract version of
// a provider Rollout. The consumer's release candidates declare what they need via
// "com.kuberik.rollout.requires.<contract>" OCI annotations (surfaced on the
// Rollout as VersionInfo.Requires); a candidate is admitted only once the provider
// has deployed a release whose contract version satisfies that constraint.
//
// Listing is read-only. A cluster that has not installed the CRD returns a
// "no matches for kind" error from the RESTMapper rather than an empty list, and
// callers must treat that as partial data, not as a failure of the whole request.

// GetRolloutDependencies lists RolloutDependencies in a namespace, with spec
// defaults resolved.
func (c *Client) GetRolloutDependencies(ctx context.Context, namespace string) (*rolloutv1alpha1.RolloutDependencyList, error) {
	dependencies := &rolloutv1alpha1.RolloutDependencyList{}
	if err := c.client.List(ctx, dependencies, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list rollout dependencies: %w", err)
	}
	resolveRolloutDependencyDefaults(dependencies)
	return dependencies, nil
}

// GetRolloutDependenciesAllNamespaces lists RolloutDependencies across all
// namespaces, with spec defaults resolved.
func (c *Client) GetRolloutDependenciesAllNamespaces(ctx context.Context) (*rolloutv1alpha1.RolloutDependencyList, error) {
	dependencies := &rolloutv1alpha1.RolloutDependencyList{}
	if err := c.client.List(ctx, dependencies); err != nil {
		return nil, fmt.Errorf("failed to list rollout dependencies across all namespaces: %w", err)
	}
	resolveRolloutDependencyDefaults(dependencies)
	return dependencies, nil
}

// resolveRolloutDependencyDefaults writes the effective value of the two optional
// spec fields back onto the object, so the JSON the frontend receives has exactly
// one populated field per concept and cannot get the defaulting wrong.
//
// The rules themselves are not reimplemented here — ContractName() and
// ProviderNamespace() are the API's own helpers, so this stays correct if the
// defaulting ever changes upstream.
//
//   - spec.contract defaults to spec.providerRef.name
//   - spec.providerRef.namespace defaults to the dependency's own namespace
//
// Mutating the listed objects is safe: client.List decodes fresh copies, and the
// dashboard never writes them back.
func resolveRolloutDependencyDefaults(dependencies *rolloutv1alpha1.RolloutDependencyList) {
	if dependencies == nil {
		return
	}
	for i := range dependencies.Items {
		dependency := &dependencies.Items[i]
		if contract := dependency.Spec.ContractName(); contract != "" {
			dependency.Spec.Contract = k8sptr.To(contract)
		}
		if providerNamespace := dependency.Spec.ProviderNamespace(dependency.Namespace); providerNamespace != "" {
			dependency.Spec.ProviderRef.Namespace = k8sptr.To(providerNamespace)
		}
	}
}
