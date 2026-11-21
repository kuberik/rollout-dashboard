package kubernetes

import (
	"context"
	"testing"

	kustomizev1 "github.com/fluxcd/kustomize-controller/api/v1"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func helmRelease(ns, name string, annotations map[string]string, spec, status map[string]interface{}) *unstructured.Unstructured {
	u := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "helm.toolkit.fluxcd.io/v2",
		"kind":       "HelmRelease",
		"metadata":   map[string]interface{}{"namespace": ns, "name": name},
	}}
	if annotations != nil {
		u.SetAnnotations(annotations)
	}
	if spec != nil {
		u.Object["spec"] = spec
	}
	if status != nil {
		u.Object["status"] = status
	}
	return u
}

func inventory(ids ...string) map[string]interface{} {
	entries := make([]interface{}, 0, len(ids))
	for _, id := range ids {
		v := "v1"
		if id[len(id)-len("HelmRelease"):] == "HelmRelease" {
			v = "v2"
		}
		entries = append(entries, map[string]interface{}{"id": id, "v": v})
	}
	return map[string]interface{}{"entries": entries}
}

func helmNames(items []unstructured.Unstructured) []string {
	out := make([]string, 0, len(items))
	for _, i := range items {
		out = append(out, i.GetName())
	}
	return out
}

func TestFilterHelmReleasesByRollout_Annotations(t *testing.T) {
	list := &unstructured.UnstructuredList{Items: []unstructured.Unstructured{
		*helmRelease("shop", "values", map[string]string{"rollout.kuberik.com/values.image.tag.from": "shop"}, nil, nil),
		*helmRelease("shop", "chartver", map[string]string{"rollout.kuberik.com/chart-version.from": "shop"}, nil, nil),
		*helmRelease("shop", "readonly", map[string]string{"rollout.kuberik.com/rollout": "shop"}, nil, nil),
		*helmRelease("shop", "other", map[string]string{"rollout.kuberik.com/values.image.tag.from": "billing"}, nil, nil),
		*helmRelease("shop", "plain", nil, nil, nil),
	}}
	got, missing := FilterHelmReleasesByRollout(list, nil, nil, "shop")
	if len(missing) != 0 {
		t.Fatalf("unexpected missing: %v", missing)
	}
	want := map[string]bool{"values": true, "chartver": true, "readonly": true}
	if len(got) != len(want) {
		t.Fatalf("got %v", helmNames(got))
	}
	for _, n := range helmNames(got) {
		if !want[n] {
			t.Fatalf("unexpected %q in %v", n, helmNames(got))
		}
	}
}

func TestFilterHelmReleasesByRollout_ChartRef(t *testing.T) {
	oci := &sourcev1.OCIRepositoryList{Items: []sourcev1.OCIRepository{
		{ObjectMeta: metav1.ObjectMeta{Namespace: "shop", Name: "shop-chart"}},
	}}
	list := &unstructured.UnstructuredList{Items: []unstructured.Unstructured{
		*helmRelease("shop", "viaref", nil, map[string]interface{}{"chartRef": map[string]interface{}{"kind": "OCIRepository", "name": "shop-chart"}}, nil),
		*helmRelease("shop", "otherref", nil, map[string]interface{}{"chartRef": map[string]interface{}{"kind": "OCIRepository", "name": "unrelated"}}, nil),
		*helmRelease("shop", "wrongkind", nil, map[string]interface{}{"chartRef": map[string]interface{}{"kind": "HelmChart", "name": "shop-chart"}}, nil),
	}}
	got, _ := FilterHelmReleasesByRollout(list, oci, nil, "shop")
	if len(got) != 1 || got[0].GetName() != "viaref" {
		t.Fatalf("got %v", helmNames(got))
	}
}

func TestFilterHelmReleasesByRollout_KustomizationInventory(t *testing.T) {
	k := &kustomizev1.KustomizationList{Items: []kustomizev1.Kustomization{{
		ObjectMeta: metav1.ObjectMeta{Namespace: "shop", Name: "apps"},
		Status: kustomizev1.KustomizationStatus{Inventory: &kustomizev1.ResourceInventory{Entries: []kustomizev1.ResourceRef{
			{ID: "shop_cart_helm.toolkit.fluxcd.io_HelmRelease", Version: "v2"},
			{ID: "platform_ingress_helm.toolkit.fluxcd.io_HelmRelease", Version: "v2"},
			{ID: "shop_web_apps_Deployment", Version: "v1"},
		}}},
	}}}
	list := &unstructured.UnstructuredList{Items: []unstructured.Unstructured{
		*helmRelease("shop", "cart", nil, nil, nil),
		*helmRelease("shop", "unrelated", nil, nil, nil),
	}}
	got, missing := FilterHelmReleasesByRollout(list, nil, k, "shop")
	if len(got) != 1 || got[0].GetName() != "cart" {
		t.Fatalf("got %v", helmNames(got))
	}
	if len(missing) != 1 || missing[0].Namespace != "platform" || missing[0].Name != "ingress" {
		t.Fatalf("missing = %v", missing)
	}
}

func TestListHelmReleases_CRDNotServedIsEmpty(t *testing.T) {
	// The fake scheme does not know HelmRelease and nothing is stored: the
	// list is empty and no error, the same answer a cluster without the CRD
	// gives (NoKindMatch).
	c, err := NewTestClient()
	if err != nil {
		t.Fatal(err)
	}
	list, err := c.ListHelmReleases(context.Background(), "shop")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if list == nil || len(list.Items) != 0 {
		t.Fatalf("expected empty list, got %+v", list)
	}
}

func TestGetHelmReleaseManagedResources_Inventory(t *testing.T) {
	hr := helmRelease("shop", "cart", nil,
		map[string]interface{}{"chart": map[string]interface{}{"spec": map[string]interface{}{"chart": "cart", "version": "1.2.0"}}},
		map[string]interface{}{
			"inventory":                  inventory("shop_cart_apps_Deployment", "shop_cart__Service", "shop_gone_apps_Deployment"),
			"lastAttemptedReleaseAction": "upgrade",
			"history": []interface{}{map[string]interface{}{
				"chartName": "cart", "chartVersion": "1.2.0", "appVersion": "2.0.1", "version": int64(7), "status": "deployed",
			}},
			"conditions": []interface{}{
				map[string]interface{}{"type": "Ready", "status": "True", "reason": "UpgradeSucceeded", "message": "Helm upgrade succeeded"},
			},
		})
	dep := &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Namespace: "shop", Name: "cart"}}
	c, err := NewTestClient(hr, dep)
	if err != nil {
		t.Fatal(err)
	}
	res, err := c.GetHelmReleaseManagedResources(context.Background(), "shop", "cart")
	if err != nil {
		t.Fatalf("GetHelmReleaseManagedResources: %v", err)
	}
	if res.Hint != "" {
		t.Fatalf("unexpected hint %q", res.Hint)
	}
	got := map[string]string{}
	for _, r := range res.ManagedResources {
		got[r.GroupVersionKind+" "+r.Name] = r.Status
	}
	if len(res.ManagedResources) != 3 {
		t.Fatalf("expected 3 entries, got %v", got)
	}
	if got["apps/v1/Deployment gone"] != "NotFound" {
		t.Fatalf("missing deployment should read NotFound, got %v", got)
	}
	if _, ok := got["apps/v1/Deployment cart"]; !ok {
		t.Fatalf("deployment not resolved: %v", got)
	}
	s := res.Release
	if s.ChartName != "cart" || s.ChartVersion != "1.2.0" || s.AppVersion != "2.0.1" || s.Revision != 7 ||
		s.Status != "deployed" || s.LastAction != "upgrade" || s.Ready != "True" || s.ReadyReason != "UpgradeSucceeded" || s.Remediated {
		t.Fatalf("summary = %+v", s)
	}
	if res.HelmRelease == nil {
		t.Fatalf("helmRelease object missing")
	}
	if _, found, _ := unstructured.NestedSlice(res.HelmRelease.Object, "metadata", "managedFields"); found {
		t.Fatalf("managedFields must be stripped from the embedded object")
	}
}

func TestGetHelmReleaseManagedResources_NoInventoryGivesHint(t *testing.T) {
	// Flux older than 2.8: helm-controller writes no status.inventory.
	hr := helmRelease("shop", "old", nil, nil, map[string]interface{}{
		"conditions": []interface{}{map[string]interface{}{"type": "Ready", "status": "True"}},
	})
	c, err := NewTestClient(hr)
	if err != nil {
		t.Fatal(err)
	}
	res, err := c.GetHelmReleaseManagedResources(context.Background(), "shop", "old")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.ManagedResources) != 0 {
		t.Fatalf("expected empty list, got %d", len(res.ManagedResources))
	}
	if res.Hint != HelmReleaseNoInventoryHint {
		t.Fatalf("hint = %q", res.Hint)
	}
	if res.Release.Ready != "True" {
		t.Fatalf("summary still expected: %+v", res.Release)
	}
}

func TestGetKustomizationManagedResources_ExpandsHelmRelease(t *testing.T) {
	hr := helmRelease("shop", "cart", nil, nil, map[string]interface{}{
		"inventory": inventory("shop_cart_apps_Deployment"),
	})
	dep := &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Namespace: "shop", Name: "cart"}}
	k := &kustomizev1.Kustomization{
		ObjectMeta: metav1.ObjectMeta{Namespace: "shop", Name: "apps"},
		Status: kustomizev1.KustomizationStatus{Inventory: &kustomizev1.ResourceInventory{Entries: []kustomizev1.ResourceRef{
			{ID: "shop_cart_helm.toolkit.fluxcd.io_HelmRelease", Version: "v2"},
		}}},
	}
	c, err := NewTestClient(hr, dep, k)
	if err != nil {
		t.Fatal(err)
	}
	res, err := c.GetKustomizationManagedResources(context.Background(), "shop", "apps")
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 2 {
		t.Fatalf("expected the HelmRelease plus its Deployment, got %d: %+v", len(res), res)
	}
	if !isHelmReleaseGVKString(res[0].GroupVersionKind) || res[0].HelmRelease != "" {
		t.Fatalf("first entry should be the bare HelmRelease: %+v", res[0])
	}
	if res[1].GroupVersionKind != "apps/v1/Deployment" || res[1].Name != "cart" || res[1].HelmRelease != "shop/cart" {
		t.Fatalf("second entry should be the expanded Deployment tagged shop/cart: %+v", res[1])
	}
}

func TestSlimHelmRelease_StripsValuesKeepsValuesFrom(t *testing.T) {
	hr := helmRelease("other", "hr", nil, map[string]interface{}{
		"values":     map[string]interface{}{"password": "hunter2"},
		"valuesFrom": []interface{}{map[string]interface{}{"kind": "Secret", "name": "creds"}},
		"chart":      map[string]interface{}{"spec": map[string]interface{}{"chart": "x"}},
	}, nil)
	out := slimHelmRelease(hr)
	if _, found, _ := unstructured.NestedFieldNoCopy(out.Object, "spec", "values"); found {
		t.Fatalf("spec.values must be stripped, got %v", out.Object["spec"])
	}
	if _, found, _ := unstructured.NestedFieldNoCopy(out.Object, "spec", "valuesFrom"); !found {
		t.Fatal("spec.valuesFrom (references only) should be kept")
	}
	if _, found, _ := unstructured.NestedFieldNoCopy(hr.Object, "spec", "values"); !found {
		t.Fatal("the input must not be mutated")
	}
}
