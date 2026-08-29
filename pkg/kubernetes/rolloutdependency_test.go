package kubernetes

import (
	"context"
	"strings"
	"testing"

	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	k8sptr "k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func dep(namespace string, spec rolloutv1alpha1.RolloutDependencySpec) rolloutv1alpha1.RolloutDependency {
	return rolloutv1alpha1.RolloutDependency{
		ObjectMeta: metav1.ObjectMeta{Name: "hello-frontend-needs-api", Namespace: namespace},
		Spec:       spec,
	}
}

func providerRef(name string, namespace *string) rolloutv1alpha1.ProviderRolloutReference {
	return rolloutv1alpha1.ProviderRolloutReference{Name: name, Namespace: namespace}
}

func consumerRef() corev1.LocalObjectReference {
	return corev1.LocalObjectReference{Name: "hello-frontend-app"}
}

func specOf(t *testing.T, dependency rolloutv1alpha1.RolloutDependency) (contract, providerNamespace string) {
	t.Helper()
	if dependency.Spec.Contract != nil {
		contract = *dependency.Spec.Contract
	}
	if dependency.Spec.ProviderRef.Namespace != nil {
		providerNamespace = *dependency.Spec.ProviderRef.Namespace
	}
	return
}

// The dashboard resolves the two optional spec fields server-side so the frontend
// reads one populated field per concept. The rules come from the API's own
// ContractName() / ProviderNamespace(); these cases pin the resulting JSON contract.
func TestResolveRolloutDependencyDefaults(t *testing.T) {
	list := &rolloutv1alpha1.RolloutDependencyList{Items: []rolloutv1alpha1.RolloutDependency{
		// Neither optional field set: contract falls back to the provider name,
		// provider namespace to the dependency's own namespace.
		dep("hello-dep-dev", rolloutv1alpha1.RolloutDependencySpec{
			RolloutRef:  consumerRef(),
			ProviderRef: providerRef("hello-api-app", nil),
		}),
		// Both set explicitly: left exactly as authored.
		dep("hello-dep-staging", rolloutv1alpha1.RolloutDependencySpec{
			RolloutRef:  consumerRef(),
			ProviderRef: providerRef("hello-api-app", k8sptr.To("shared-platform")),
			Contract:    k8sptr.To("api"),
		}),
		// Empty string is not "set" — ContractName()/ProviderNamespace() treat it as
		// absent, and so must the resolved output.
		dep("hello-dep-prod", rolloutv1alpha1.RolloutDependencySpec{
			RolloutRef:  consumerRef(),
			ProviderRef: providerRef("hello-api-app", k8sptr.To("")),
			Contract:    k8sptr.To(""),
		}),
	}}

	resolveRolloutDependencyDefaults(list)

	want := []struct{ contract, providerNamespace string }{
		{"hello-api-app", "hello-dep-dev"},
		{"api", "shared-platform"},
		{"hello-api-app", "hello-dep-prod"},
	}
	for i, w := range want {
		contract, providerNamespace := specOf(t, list.Items[i])
		if contract != w.contract {
			t.Errorf("item %d: contract = %q, want %q", i, contract, w.contract)
		}
		if providerNamespace != w.providerNamespace {
			t.Errorf("item %d: providerRef.namespace = %q, want %q", i, providerNamespace, w.providerNamespace)
		}
	}
}

// A malformed object must not panic or invent a provider — a dependency with no
// providerRef.name has no contract to fall back to.
func TestResolveRolloutDependencyDefaultsToleratesMissingFields(t *testing.T) {
	list := &rolloutv1alpha1.RolloutDependencyList{Items: []rolloutv1alpha1.RolloutDependency{
		dep("hello-dep-dev", rolloutv1alpha1.RolloutDependencySpec{}),
	}}

	resolveRolloutDependencyDefaults(list)
	resolveRolloutDependencyDefaults(nil)

	if contract, _ := specOf(t, list.Items[0]); contract != "" {
		t.Errorf("contract = %q, want empty when providerRef.name is absent", contract)
	}
}

// Resolution runs on every list, including a re-listed one; it must not flip an
// already-resolved value.
func TestResolveRolloutDependencyDefaultsIsIdempotent(t *testing.T) {
	list := &rolloutv1alpha1.RolloutDependencyList{Items: []rolloutv1alpha1.RolloutDependency{
		dep("hello-dep-dev", rolloutv1alpha1.RolloutDependencySpec{
			RolloutRef:  consumerRef(),
			ProviderRef: providerRef("hello-api-app", nil),
		}),
	}}

	resolveRolloutDependencyDefaults(list)
	contract1, ns1 := specOf(t, list.Items[0])
	resolveRolloutDependencyDefaults(list)
	contract2, ns2 := specOf(t, list.Items[0])

	if contract1 != contract2 || ns1 != ns2 {
		t.Errorf("second pass changed the result: (%q,%q) then (%q,%q)", contract1, ns1, contract2, ns2)
	}
}

// The frontend types declare spec.contract and spec.providerRef.namespace as
// non-optional. That only holds if resolution actually emits them, so assert the
// serialised shape, not just the Go fields.
func TestResolvedDependencySerialisesBothFields(t *testing.T) {
	list := &rolloutv1alpha1.RolloutDependencyList{Items: []rolloutv1alpha1.RolloutDependency{
		dep("hello-dep-dev", rolloutv1alpha1.RolloutDependencySpec{
			RolloutRef:  consumerRef(),
			ProviderRef: providerRef("hello-api-app", nil),
		}),
	}}
	resolveRolloutDependencyDefaults(list)

	if list.Items[0].Spec.Contract == nil {
		t.Fatal("spec.contract is nil and would be omitted from JSON")
	}
	if list.Items[0].Spec.ProviderRef.Namespace == nil {
		t.Fatal("spec.providerRef.namespace is nil and would be omitted from JSON")
	}
}

// A cluster that has not installed the RolloutDependency CRD must produce an
// error the caller can log and skip, never a panic and never a silent empty list
// that would render as "this rollout has no dependencies". The /api/rollouts
// handler relies on this to fail soft per cluster.
func TestGetRolloutDependenciesErrorsWhenKindIsUnknown(t *testing.T) {
	scheme := runtime.NewScheme()
	if err := corev1.AddToScheme(scheme); err != nil {
		t.Fatalf("build scheme: %v", err)
	}
	// Deliberately NOT registering rolloutv1alpha1 — this is what a cluster
	// without the CRD looks like to the client.
	c := &Client{client: fake.NewClientBuilder().WithScheme(scheme).Build()}

	for name, list := range map[string]func() error{
		"all namespaces": func() error {
			_, err := c.GetRolloutDependenciesAllNamespaces(context.Background())
			return err
		},
		"single namespace": func() error {
			_, err := c.GetRolloutDependencies(context.Background(), "hello-dep-dev")
			return err
		},
	} {
		t.Run(name, func(t *testing.T) {
			err := list()
			if err == nil {
				t.Fatal("got nil error, want a failure the caller can fail soft on")
			}
			if !strings.Contains(err.Error(), "rollout dependencies") {
				t.Errorf("error %q does not name the resource it failed on", err)
			}
		})
	}
}
