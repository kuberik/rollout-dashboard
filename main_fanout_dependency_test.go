package main

import (
	"encoding/json"
	"testing"
)

// Two clusters can hold RolloutDependency objects with the SAME name in
// DIFFERENT namespaces (hello-frontend-needs-api exists in hello-dep-dev and
// hello-dep-staging on the spoke, and hello-dep-prod on the hub). After merging
// they must still be attributable to the cluster they came from, or the
// Dependencies tab cannot tell one environment's gate from another's.
func TestRolloutDependencyMergeKeepsClusterAttribution(t *testing.T) {
	hub := json.RawMessage(`{"items":[
		{"metadata":{"name":"hello-frontend-needs-api","namespace":"hello-dep-prod"},
		 "spec":{"contract":"api","providerRef":{"name":"hello-api-app","namespace":"hello-dep-prod"}}}
	]}`)
	spoke := json.RawMessage(`{"items":[
		{"metadata":{"name":"hello-frontend-needs-api","namespace":"hello-dep-dev"},
		 "spec":{"contract":"api","providerRef":{"name":"hello-api-app","namespace":"hello-dep-dev"}}},
		{"metadata":{"name":"hello-frontend-needs-api","namespace":"hello-dep-staging"},
		 "spec":{"contract":"api","providerRef":{"name":"hello-api-app","namespace":"hello-dep-staging"}}}
	]}`)

	merged := mergeItemLists(
		annotateItemsWithSource(hub, "https://kuberik.example", "prod"),
		annotateItemsWithSource(spoke, "https://kuberik-spoke.example", "dev"),
	)

	var list struct {
		Items []struct {
			Metadata struct {
				Namespace   string            `json:"namespace"`
				Annotations map[string]string `json:"annotations"`
			} `json:"metadata"`
		} `json:"items"`
	}
	if err := json.Unmarshal(merged, &list); err != nil {
		t.Fatalf("unmarshal merged list: %v", err)
	}
	if len(list.Items) != 3 {
		t.Fatalf("merged %d items, want 3", len(list.Items))
	}

	want := map[string]string{
		"hello-dep-prod":    "prod",
		"hello-dep-dev":     "dev",
		"hello-dep-staging": "dev",
	}
	for _, item := range list.Items {
		got := item.Metadata.Annotations[sourceClusterAnnotation]
		if got != want[item.Metadata.Namespace] {
			t.Errorf("namespace %s: source-cluster = %q, want %q",
				item.Metadata.Namespace, got, want[item.Metadata.Namespace])
		}
		if item.Metadata.Annotations[sourceDashboardAnnotation] == "" {
			t.Errorf("namespace %s: source-dashboard annotation missing", item.Metadata.Namespace)
		}
	}
}

// A spoke that does not have the RolloutDependency CRD returns null for the key.
// Merging must degrade to the reachable cluster's data rather than losing it or
// producing a malformed list.
func TestRolloutDependencyMergeToleratesClusterWithoutCRD(t *testing.T) {
	hub := annotateItemsWithSource(
		json.RawMessage(`{"items":[{"metadata":{"name":"a","namespace":"hello-dep-prod"}}]}`),
		"https://kuberik.example", "prod")

	for name, spoke := range map[string]json.RawMessage{
		"nil key":     nil,
		"empty":       json.RawMessage(``),
		"empty items": json.RawMessage(`{"items":[]}`),
	} {
		t.Run(name, func(t *testing.T) {
			var list struct {
				Items []json.RawMessage `json:"items"`
			}
			if err := json.Unmarshal(mergeItemLists(hub, spoke), &list); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if len(list.Items) != 1 {
				t.Fatalf("got %d items, want the hub's 1", len(list.Items))
			}
		})
	}
}

// rolloutDependencies must be in the merged-key set, otherwise the hub would
// serve only its own dependencies and silently drop every spoke's.
func TestRolloutDependenciesIsAMergedKey(t *testing.T) {
	for _, k := range mergedKeys {
		if k == "rolloutDependencies" {
			return
		}
	}
	t.Fatalf("rolloutDependencies missing from mergedKeys: %v", mergedKeys)
}
