package kubernetes

import (
	"context"
	"fmt"
	"sort"
	"strings"

	kustomizev1 "github.com/fluxcd/kustomize-controller/api/v1"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/cli-utils/pkg/object"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// HelmRelease support is unstructured on purpose: no typed Flux helm API is
// compiled in, and a cluster without the CRD simply has none.

const (
	helmReleaseGroup = "helm.toolkit.fluxcd.io"
	helmReleaseKind  = "HelmRelease"

	// helmReleaseListVersion is the version HelmReleases are listed with.
	// v2 has been the served and stored version since Flux 2.3.
	helmReleaseListVersion = "v2"

	annotationRollout          = "rollout.kuberik.com/rollout"
	annotationValuesPrefix     = "rollout.kuberik.com/values."
	annotationChartVersionFrom = "rollout.kuberik.com/chart-version.from"
	annotationFromSuffix       = ".from"
)

// HelmReleaseNoInventoryHint explains an empty resource list for a
// HelmRelease that has no status.inventory (helm-controller writes it from
// Flux 2.8 on).
const HelmReleaseNoInventoryHint = "This HelmRelease reports no status.inventory. helm-controller records the objects it manages there from Flux 2.8; on an older Flux the resources are not listed."

func helmReleaseGVK() schema.GroupVersionKind {
	return schema.GroupVersionKind{Group: helmReleaseGroup, Version: helmReleaseListVersion, Kind: helmReleaseKind}
}

// isHelmReleaseGVKString reports whether a ManagedResourceStatus
// GroupVersionKind ("group/version/Kind") names a HelmRelease.
func isHelmReleaseGVKString(gvk string) bool {
	return strings.HasPrefix(gvk, helmReleaseGroup+"/") && strings.HasSuffix(gvk, "/"+helmReleaseKind)
}

// helmCRDAbsent is true for the errors a read of a kind whose CRD is not
// served produces; callers treat it as "none".
func helmCRDAbsent(err error) bool {
	return err != nil && (meta.IsNoMatchError(err) || apierrors.IsNotFound(err))
}

// ListHelmReleases lists the HelmReleases of one namespace. A cluster that
// does not serve the CRD answers with an empty list, not an error.
func (c *Client) ListHelmReleases(ctx context.Context, namespace string) (*unstructured.UnstructuredList, error) {
	list := &unstructured.UnstructuredList{}
	gvk := helmReleaseGVK()
	gvk.Kind += "List"
	list.SetGroupVersionKind(gvk)
	if err := c.client.List(ctx, list, client.InNamespace(namespace)); err != nil {
		if helmCRDAbsent(err) {
			empty := &unstructured.UnstructuredList{}
			empty.SetGroupVersionKind(gvk)
			empty.Items = []unstructured.Unstructured{}
			return empty, nil
		}
		return nil, fmt.Errorf("failed to list helmreleases: %w", err)
	}
	sort.Slice(list.Items, func(i, j int) bool {
		a, b := list.Items[i], list.Items[j]
		if a.GetNamespace() != b.GetNamespace() {
			return a.GetNamespace() < b.GetNamespace()
		}
		return a.GetName() < b.GetName()
	})
	return list, nil
}

// getHelmRelease reads one HelmRelease; absent CRD reads as not found.
func (c *Client) getHelmRelease(ctx context.Context, namespace, name string) (*unstructured.Unstructured, error) {
	obj := &unstructured.Unstructured{}
	obj.SetGroupVersionKind(helmReleaseGVK())
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, obj); err != nil {
		return nil, fmt.Errorf("failed to get helmrelease: %w", err)
	}
	return obj, nil
}

// helmReleaseOwnedBy reports whether the annotations tie a HelmRelease to
// the rollout directly: a values.<path>.from or chart-version.from write
// opt-in, or the read-only rollout annotation.
func helmReleaseOwnedBy(annotations map[string]string, rolloutName string) bool {
	for k, v := range annotations {
		if v != rolloutName {
			continue
		}
		if k == annotationRollout || k == annotationChartVersionFrom {
			return true
		}
		if strings.HasPrefix(k, annotationValuesPrefix) && strings.HasSuffix(k, annotationFromSuffix) {
			return true
		}
	}
	return false
}

// helmReleasesInInventory returns the HelmReleases named by Kustomization
// inventories as (namespace, name) pairs.
func helmReleasesInInventory(kustomizations *kustomizev1.KustomizationList) []client.ObjectKey {
	var out []client.ObjectKey
	if kustomizations == nil {
		return out
	}
	for _, k := range kustomizations.Items {
		if k.Status.Inventory == nil {
			continue
		}
		for _, e := range k.Status.Inventory.Entries {
			id, err := object.ParseObjMetadata(e.ID)
			if err != nil {
				continue
			}
			if id.GroupKind.Group == helmReleaseGroup && id.GroupKind.Kind == helmReleaseKind {
				out = append(out, client.ObjectKey{Namespace: id.Namespace, Name: id.Name})
			}
		}
	}
	return out
}

// FilterHelmReleasesByRollout narrows a namespace's HelmReleases to the
// rollout's, by three paths:
//
//	(a) an annotation: rollout.kuberik.com/values.<path>.from,
//	    rollout.kuberik.com/chart-version.from or rollout.kuberik.com/rollout
//	    naming the rollout;
//	(b) spec.chartRef pointing at an OCIRepository associated with the rollout
//	    (ociRepositories already filtered, as for FilterKustomizationsByRolloutAnnotation);
//	(c) being listed in the inventory of an associated Kustomization.
//
// missing lists (c) matches that are not in all (another namespace); the
// caller fetches those individually.
func FilterHelmReleasesByRollout(all *unstructured.UnstructuredList, ociRepositories *sourcev1.OCIRepositoryList, kustomizations *kustomizev1.KustomizationList, rolloutName string) (matched []unstructured.Unstructured, missing []client.ObjectKey) {
	ociNames := map[string]bool{}
	if ociRepositories != nil {
		for _, o := range ociRepositories.Items {
			ociNames[o.Namespace+"/"+o.Name] = true
		}
	}
	inInventory := map[client.ObjectKey]bool{}
	for _, key := range helmReleasesInInventory(kustomizations) {
		inInventory[key] = true
	}

	seen := map[client.ObjectKey]bool{}
	if all != nil {
		for _, hr := range all.Items {
			key := client.ObjectKey{Namespace: hr.GetNamespace(), Name: hr.GetName()}
			ok := helmReleaseOwnedBy(hr.GetAnnotations(), rolloutName) || inInventory[key]
			if !ok {
				kind, _, _ := unstructured.NestedString(hr.Object, "spec", "chartRef", "kind")
				name, _, _ := unstructured.NestedString(hr.Object, "spec", "chartRef", "name")
				ns, _, _ := unstructured.NestedString(hr.Object, "spec", "chartRef", "namespace")
				if ns == "" {
					ns = hr.GetNamespace()
				}
				ok = kind == "OCIRepository" && name != "" && ociNames[ns+"/"+name]
			}
			if ok {
				matched = append(matched, hr)
				seen[key] = true
			}
		}
	}
	for key := range inInventory {
		if !seen[key] {
			missing = append(missing, key)
			seen[key] = true
		}
	}
	sort.Slice(missing, func(i, j int) bool {
		if missing[i].Namespace != missing[j].Namespace {
			return missing[i].Namespace < missing[j].Namespace
		}
		return missing[i].Name < missing[j].Name
	})
	return matched, missing
}

// ResolveHelmReleasesForRollout is FilterHelmReleasesByRollout plus the
// individual reads for HelmReleases that an associated Kustomization lists
// but that live outside the listed namespace. The result is slimmed for the
// rollout detail payload (no managedFields; like a Kustomization it keeps its
// inventory, which the pipeline reads) and never nil.
func (c *Client) ResolveHelmReleasesForRollout(ctx context.Context, all *unstructured.UnstructuredList, ociRepositories *sourcev1.OCIRepositoryList, kustomizations *kustomizev1.KustomizationList, rolloutName string) *unstructured.UnstructuredList {
	matched, missing := FilterHelmReleasesByRollout(all, ociRepositories, kustomizations, rolloutName)
	for _, key := range missing {
		hr, err := c.getHelmRelease(ctx, key.Namespace, key.Name)
		if err != nil {
			continue
		}
		matched = append(matched, *hr)
	}
	out := &unstructured.UnstructuredList{Items: make([]unstructured.Unstructured, 0, len(matched))}
	gvk := helmReleaseGVK()
	gvk.Kind += "List"
	out.SetGroupVersionKind(gvk)
	for i := range matched {
		out.Items = append(out.Items, *slimHelmRelease(&matched[i]))
	}
	return out
}

func slimHelmRelease(in *unstructured.Unstructured) *unstructured.Unstructured {
	out := in.DeepCopy()
	unstructured.RemoveNestedField(out.Object, "metadata", "managedFields")
	// spec.values can carry secrets or private config and the UI never reads it; a HelmRelease read from another
	// namespace with the service-account client must not ship it. spec.valuesFrom is references only and stays.
	unstructured.RemoveNestedField(out.Object, "spec", "values")
	anns := out.GetAnnotations()
	if _, ok := anns[lastAppliedConfigAnnotation]; ok {
		delete(anns, lastAppliedConfigAnnotation)
		out.SetAnnotations(anns)
	}
	return out
}

// HelmReleaseSummary is what the dashboard shows in a HelmRelease group's
// header: which chart at which version, the helm release revision, and
// helm-controller's own verdict.
type HelmReleaseSummary struct {
	ChartName    string `json:"chartName"`
	ChartVersion string `json:"chartVersion"`
	AppVersion   string `json:"appVersion"`
	// Revision is helm's release revision (status.history[0].version).
	Revision int64 `json:"revision"`
	// Status is helm's status of that revision: deployed, failed,
	// pending-upgrade, ...
	Status string `json:"status"`
	// LastAction is "install" or "upgrade" (status.lastAttemptedReleaseAction).
	LastAction string `json:"lastAction"`
	// Ready is the Ready condition's status: True, False or Unknown.
	Ready        string `json:"ready"`
	ReadyReason  string `json:"readyReason"`
	ReadyMessage string `json:"readyMessage"`
	// Remediated is true when the Remediated condition is True.
	Remediated bool `json:"remediated"`
}

// SummarizeHelmRelease reads the header facts out of a HelmRelease.
func SummarizeHelmRelease(hr *unstructured.Unstructured) HelmReleaseSummary {
	var s HelmReleaseSummary
	s.ChartName, _, _ = unstructured.NestedString(hr.Object, "spec", "chart", "spec", "chart")
	s.ChartVersion, _, _ = unstructured.NestedString(hr.Object, "spec", "chart", "spec", "version")
	s.LastAction, _, _ = unstructured.NestedString(hr.Object, "status", "lastAttemptedReleaseAction")

	if history, _, _ := unstructured.NestedSlice(hr.Object, "status", "history"); len(history) > 0 {
		if h0, ok := history[0].(map[string]interface{}); ok {
			if v, ok := h0["chartName"].(string); ok && v != "" {
				s.ChartName = v
			}
			if v, ok := h0["chartVersion"].(string); ok && v != "" {
				s.ChartVersion = v
			}
			s.AppVersion, _ = h0["appVersion"].(string)
			s.Status, _ = h0["status"].(string)
			switch v := h0["version"].(type) {
			case int64:
				s.Revision = v
			case float64:
				s.Revision = int64(v)
			}
		}
	}
	if conds, _, _ := unstructured.NestedSlice(hr.Object, "status", "conditions"); len(conds) > 0 {
		for _, c := range conds {
			cm, ok := c.(map[string]interface{})
			if !ok {
				continue
			}
			switch cm["type"] {
			case "Ready":
				s.Ready, _ = cm["status"].(string)
				s.ReadyReason, _ = cm["reason"].(string)
				s.ReadyMessage, _ = cm["message"].(string)
			case "Remediated":
				s.Remediated = cm["status"] == "True"
			}
		}
	}
	return s
}

// helmReleaseInventory reads status.inventory.entries; ok is false when the
// HelmRelease has no inventory (Flux older than 2.8).
func helmReleaseInventory(hr *unstructured.Unstructured) (refs []inventoryRef, ok bool) {
	inv, found, _ := unstructured.NestedMap(hr.Object, "status", "inventory")
	if !found || inv == nil {
		return nil, false
	}
	entries, _, _ := unstructured.NestedSlice(inv, "entries")
	for _, e := range entries {
		em, isMap := e.(map[string]interface{})
		if !isMap {
			continue
		}
		id, _ := em["id"].(string)
		v, _ := em["v"].(string)
		if id != "" {
			refs = append(refs, inventoryRef{ID: id, Version: v})
		}
	}
	return refs, true
}

// HelmReleaseManagedResources is the response of
// GET /api/helmreleases/:namespace/:name/managed-resources.
type HelmReleaseManagedResources struct {
	ManagedResources []ManagedResourceStatus `json:"managedResources"`
	Release          HelmReleaseSummary      `json:"release"`
	// Hint is set, with an empty list, when the HelmRelease has no
	// status.inventory.
	Hint string `json:"hint,omitempty"`
	// HelmRelease is the object itself, without managedFields.
	HelmRelease *unstructured.Unstructured `json:"helmRelease"`
}

// GetHelmReleaseManagedResources lists what a HelmRelease manages, through
// the same inventory path as GetKustomizationManagedResources.
func (c *Client) GetHelmReleaseManagedResources(ctx context.Context, namespace, name string) (*HelmReleaseManagedResources, error) {
	hr, err := c.getHelmRelease(ctx, namespace, name)
	if err != nil {
		return nil, err
	}
	out := &HelmReleaseManagedResources{
		ManagedResources: []ManagedResourceStatus{},
		Release:          SummarizeHelmRelease(hr),
		HelmRelease:      slimHelmRelease(hr),
	}
	refs, ok := helmReleaseInventory(hr)
	if !ok {
		out.Hint = HelmReleaseNoInventoryHint
		return out, nil
	}
	resources, err := c.managedResourcesFromInventory(ctx, refs)
	if err != nil {
		return nil, err
	}
	out.ManagedResources = resources
	return out, nil
}

// expandHelmReleases expands, one level and in place, every HelmRelease
// entry of a Kustomization's managed resources: the entry stays (the
// dashboard reads the HelmRelease from it) and the resources it manages
// follow it, each stamped with HelmRelease "<ns>/<name>". Children that are
// HelmReleases themselves are not expanded again.
func (c *Client) expandHelmReleases(ctx context.Context, resources []ManagedResourceStatus) []ManagedResourceStatus {
	any := false
	for _, r := range resources {
		if isHelmReleaseGVKString(r.GroupVersionKind) && r.Object != nil {
			any = true
			break
		}
	}
	if !any {
		return resources
	}
	out := make([]ManagedResourceStatus, 0, len(resources))
	for _, r := range resources {
		out = append(out, r)
		if !isHelmReleaseGVKString(r.GroupVersionKind) || r.Object == nil {
			continue
		}
		refs, ok := helmReleaseInventory(r.Object)
		if !ok {
			continue
		}
		children, err := c.managedResourcesFromInventory(ctx, refs)
		if err != nil {
			continue
		}
		owner := r.Namespace + "/" + r.Name
		for _, child := range children {
			child.HelmRelease = owner
			out = append(out, child)
		}
	}
	return out
}
