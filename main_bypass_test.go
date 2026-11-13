package main

import (
	"context"
	"errors"
	"net/http"
	"testing"

	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/interceptor"
)

func bypassGate(name string, owner *metav1.OwnerReference) *rolloutv1alpha1.RolloutGate {
	g := &rolloutv1alpha1.RolloutGate{ObjectMeta: metav1.ObjectMeta{Namespace: approvalNS, Name: name}}
	g.Spec.RolloutRef = &corev1.LocalObjectReference{Name: "checkout"}
	if owner != nil {
		g.OwnerReferences = []metav1.OwnerReference{*owner}
	}
	return g
}

func bypassObjs() []client.Object {
	return []client.Object{
		approvalRollout(),
		bypassGate("business-hours-checkout", &metav1.OwnerReference{APIVersion: "kuberik.com/v1alpha1", Kind: "ClusterRolloutSchedule", Name: "business-hours", UID: "u1"}),
		bypassGate("kill-switch", nil),
	}
}

type bypassResp struct {
	Rollout struct {
		Metadata struct {
			Annotations map[string]string `json:"annotations"`
		} `json:"metadata"`
	} `json:"rollout"`
	Version string   `json:"version"`
	Gates   []string `json:"gates"`
	Scope   string   `json:"scope"`
}

func TestBypassGates_RuleThenFullThenAccumulate(t *testing.T) {
	fc, _ := kubernetes.NewTestClient(bypassObjs()...)
	env := newApprovalEnv(t, fc, "oidc:luka")
	path := "/api/rollouts/" + approvalNS + "/checkout/bypass-gates"

	w := env.do(http.MethodPost, path, `{"version":"v1.42.0","rule":{"kind":"ClusterRolloutSchedule","name":"business-hours"}}`)
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	var r bypassResp
	decode(t, w, &r)
	a := r.Rollout.Metadata.Annotations
	if r.Scope != "only" || r.Version != "v1.42.0" || len(r.Gates) != 1 || r.Gates[0] != "business-hours-checkout" ||
		a["rollout.kuberik.com/bypass-gates"] != "v1.42.0" || a["rollout.kuberik.com/bypass-gates-only"] != "business-hours-checkout" {
		t.Fatalf("%+v", r)
	}

	// Accumulate a second rule for the same build.
	w = env.do(http.MethodPost, path, `{"version":"v1.42.0","gates":["kill-switch"]}`)
	decode(t, w, &r)
	if w.Code != 200 || r.Rollout.Metadata.Annotations["rollout.kuberik.com/bypass-gates-only"] != "business-hours-checkout,kill-switch" {
		t.Fatalf("%d %+v", w.Code, r)
	}

	// A plain full bypass for another build removes the stale only-list.
	w = env.do(http.MethodPost, path, `{"version":"v1.41.0"}`)
	r = bypassResp{}
	decode(t, w, &r)
	a = r.Rollout.Metadata.Annotations
	if w.Code != 200 || r.Scope != "all" || a["rollout.kuberik.com/bypass-gates"] != "v1.41.0" {
		t.Fatalf("%d %+v", w.Code, r)
	}
	if _, ok := a["rollout.kuberik.com/bypass-gates-only"]; ok {
		t.Fatalf("stale only-list survived: %v", a)
	}
}

func TestBypassGates_ErrorCodes(t *testing.T) {
	fc, _ := kubernetes.NewTestClient(bypassObjs()...)
	env := newApprovalEnv(t, fc, "oidc:luka")
	path := "/api/rollouts/" + approvalNS + "/checkout/bypass-gates"
	for body, want := range map[string]int{
		`{"version":"v9"}`: 409,
		`{"version":"v1.42.0","rule":{"kind":"RolloutSchedule","name":"nope"}}`: 422,
		`{"version":"v1.42.0","gates":["ghost"]}`:                               422,
		`{}`: 400,
	} {
		if w := env.do(http.MethodPost, path, body); w.Code != want {
			t.Errorf("%s: got %d want %d (%s)", body, w.Code, want, w.Body)
		}
	}
	if w := env.do(http.MethodPost, "/api/rollouts/"+approvalNS+"/missing/bypass-gates", `{"version":"v1.42.0"}`); w.Code != 404 {
		t.Errorf("missing rollout: %d", w.Code)
	}
}

// A resourceVersion conflict (the controller wrote status between our read and
// our patch) is retried against the live object, not reported as a 409
// "not a candidate".
func TestBypassGates_RetriesOnConflict(t *testing.T) {
	patches := 0
	fc, _ := kubernetes.NewTestClientWithInterceptor(interceptor.Funcs{
		Patch: func(ctx context.Context, c client.WithWatch, obj client.Object, p client.Patch, opts ...client.PatchOption) error {
			patches++
			if patches == 1 {
				return apierrors.NewConflict(schema.GroupResource{Group: "kuberik.com", Resource: "rollouts"}, obj.GetName(), errors.New("the object has been modified"))
			}
			return c.Patch(ctx, obj, p, opts...)
		},
	}, bypassObjs()...)
	env := newApprovalEnv(t, fc, "oidc:luka")
	w := env.do(http.MethodPost, "/api/rollouts/"+approvalNS+"/checkout/bypass-gates", `{"version":"v1.42.0","gates":["kill-switch"]}`)
	if w.Code != 200 || patches != 2 {
		t.Fatalf("code %d patches %d body %s", w.Code, patches, w.Body)
	}
}
