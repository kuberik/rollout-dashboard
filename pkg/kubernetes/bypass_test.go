package kubernetes

import (
	"errors"
	"net/http"
	"reflect"
	"testing"

	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func mkGate(ns, name, rollout string, owner *metav1.OwnerReference, labels map[string]string) rolloutv1alpha1.RolloutGate {
	g := rolloutv1alpha1.RolloutGate{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name, Labels: labels}}
	g.Spec.RolloutRef = &corev1.LocalObjectReference{Name: rollout}
	if owner != nil {
		g.OwnerReferences = []metav1.OwnerReference{*owner}
	}
	return g
}

func TestGateRule(t *testing.T) {
	own := func(kind, name string) *metav1.OwnerReference { return &metav1.OwnerReference{Kind: kind, Name: name} }
	cases := []struct {
		name string
		g    rolloutv1alpha1.RolloutGate
		want RuleRef
	}{
		{"cluster schedule owner", mkGate("shop", "bh-checkout", "checkout", own("ClusterRolloutSchedule", "bh"), nil), RuleRef{"ClusterRolloutSchedule", "bh", ""}},
		{"namespaced schedule owner", mkGate("shop", "bh-checkout", "checkout", own("RolloutSchedule", "bh"), nil), RuleRef{"RolloutSchedule", "bh", "shop"}},
		{"schedule labels namespaced", mkGate("shop", "x", "checkout", nil, map[string]string{
			"gate.kuberik.com/schedule-name": "bh", "gate.kuberik.com/schedule-kind": "RolloutSchedule", "gate.kuberik.com/schedule-namespace": "shop"}), RuleRef{"RolloutSchedule", "bh", "shop"}},
		{"schedule labels cluster", mkGate("shop", "x", "checkout", nil, map[string]string{
			"gate.kuberik.com/schedule-name": "bh", "gate.kuberik.com/schedule-kind": "ClusterRolloutSchedule"}), RuleRef{"ClusterRolloutSchedule", "bh", ""}},
		{"schedule label without kind", mkGate("shop", "x", "checkout", nil, map[string]string{"gate.kuberik.com/schedule-name": "bh"}), RuleRef{"ClusterRolloutSchedule", "bh", ""}},
		{"dependency owner", mkGate("shop", "dependency-db", "checkout", own("RolloutDependency", "db"), nil), RuleRef{"RolloutDependency", "db", "shop"}},
		{"dependency label", mkGate("shop", "dependency-db", "checkout", nil, map[string]string{"gate.kuberik.com/dependency-name": "db"}), RuleRef{"RolloutDependency", "db", "shop"}},
		{"approval owner", mkGate("shop", "a", "checkout", own("ClusterApprovalPolicy", "prod"), nil), RuleRef{"ClusterApprovalPolicy", "prod", ""}},
		{"approval labels", mkGate("shop", "a", "checkout", nil, map[string]string{
			"gate.kuberik.com/approval-policy-name": "p", "gate.kuberik.com/approval-policy-kind": "ApprovalPolicy", "gate.kuberik.com/approval-policy-namespace": "shop"}), RuleRef{"ApprovalPolicy", "p", "shop"}},
		{"environment owner", mkGate("shop", "ghd-x", "checkout", own("Environment", "prod"), nil), RuleRef{"Environment", "prod", "shop"}},
		{"owner beats label", mkGate("shop", "x", "checkout", own("RolloutSchedule", "own"), map[string]string{"gate.kuberik.com/schedule-name": "label"}), RuleRef{"RolloutSchedule", "own", "shop"}},
		{"unowned", mkGate("shop", "kill-switch", "checkout", nil, nil), RuleRef{"RolloutGate", "kill-switch", ""}},
		{"foreign owner", mkGate("shop", "kill-switch", "checkout", own("Deployment", "d"), nil), RuleRef{"RolloutGate", "kill-switch", ""}},
	}
	for _, tc := range cases {
		if got := GateRule(&tc.g); got != tc.want {
			t.Errorf("%s: got %+v want %+v", tc.name, got, tc.want)
		}
	}
}

func bypassFixture() ([]rolloutv1alpha1.RolloutGate, *rolloutv1alpha1.Rollout) {
	sched := &metav1.OwnerReference{Kind: "ClusterRolloutSchedule", Name: "business-hours"}
	gates := []rolloutv1alpha1.RolloutGate{
		mkGate("shop", "business-hours-checkout", "checkout", sched, nil),
		mkGate("shop", "bh-label-checkout", "checkout", nil, map[string]string{"gate.kuberik.com/schedule-name": "business-hours", "gate.kuberik.com/schedule-kind": "ClusterRolloutSchedule"}),
		mkGate("shop", "dependency-db", "checkout", &metav1.OwnerReference{Kind: "RolloutDependency", Name: "db"}, nil),
		mkGate("shop", "approval-prod", "checkout", &metav1.OwnerReference{Kind: "ApprovalPolicy", Name: "prod"}, nil),
		mkGate("shop", "kill-switch", "checkout", nil, nil),
		mkGate("shop", "business-hours-other", "other", sched, nil),
		mkGate("elsewhere", "business-hours-checkout", "checkout", sched, nil),
	}
	r := &rolloutv1alpha1.Rollout{ObjectMeta: metav1.ObjectMeta{Namespace: "shop", Name: "checkout"}}
	r.Status.Candidates = []rolloutv1alpha1.ReleaseCandidate{{Tag: "1.4.2"}, {Tag: "1.4.1"}}
	return gates, r
}

func sp(s string) *string { return &s }

func wantStatus(t *testing.T, err error, status int) {
	t.Helper()
	var be *BypassError
	if !errors.As(err, &be) || be.Status != status {
		t.Fatalf("want status %d, got %v", status, err)
	}
}

func TestResolveBypass_Rule(t *testing.T) {
	gates, r := bypassFixture()
	p, err := ResolveBypass(gates, r, BypassRequest{Version: "1.4.2", Rule: &RuleRef{Kind: "ClusterRolloutSchedule", Name: "business-hours"}})
	if err != nil {
		t.Fatal(err)
	}
	// Owner form and label form of the same schedule both resolve; other
	// rollouts' and other namespaces' gates do not.
	if want := []string{"bh-label-checkout", "business-hours-checkout"}; !reflect.DeepEqual(p.Gates, want) {
		t.Fatalf("gates %v", p.Gates)
	}
	if p.Scope != "only" || *p.Annotations[AnnotationBypassGates] != "1.4.2" || *p.Annotations[AnnotationBypassGatesOnly] != "bh-label-checkout,business-hours-checkout" {
		t.Fatalf("plan %+v", p)
	}
}

func TestResolveBypass_DependencyApprovalUnowned(t *testing.T) {
	gates, r := bypassFixture()
	for _, tc := range []struct {
		rule RuleRef
		want string
	}{
		{RuleRef{Kind: "RolloutDependency", Name: "db"}, "dependency-db"},
		{RuleRef{Kind: "ApprovalPolicy", Name: "prod", Namespace: "shop"}, "approval-prod"},
		{RuleRef{Kind: "RolloutGate", Name: "kill-switch"}, "kill-switch"},
	} {
		rule := tc.rule
		p, err := ResolveBypass(gates, r, BypassRequest{Version: "1.4.2", Rule: &rule})
		if err != nil || len(p.Gates) != 1 || p.Gates[0] != tc.want {
			t.Errorf("%+v: %v %+v", tc.rule, err, p)
		}
	}
}

func TestResolveBypass_Errors(t *testing.T) {
	gates, r := bypassFixture()
	_, err := ResolveBypass(gates, r, BypassRequest{Version: "1.4.2", Rule: &RuleRef{Kind: "RolloutSchedule", Name: "nope"}})
	wantStatus(t, err, http.StatusUnprocessableEntity)
	_, err = ResolveBypass(gates, r, BypassRequest{Version: "1.4.2", Rule: &RuleRef{Kind: "ClusterRolloutSchedule", Name: "business-hours", Namespace: "x"}})
	wantStatus(t, err, http.StatusUnprocessableEntity)
	_, err = ResolveBypass(gates, r, BypassRequest{Version: "1.4.2", Gates: []string{"business-hours-other"}})
	wantStatus(t, err, http.StatusUnprocessableEntity)
	_, err = ResolveBypass(gates, r, BypassRequest{Version: "1.4.2", Gates: []string{"ghost"}})
	wantStatus(t, err, http.StatusUnprocessableEntity)
	_, err = ResolveBypass(gates, r, BypassRequest{Version: "9.9.9"})
	wantStatus(t, err, http.StatusConflict)
	_, err = ResolveBypass(gates, r, BypassRequest{Version: "9.9.9", Gates: []string{"kill-switch"}})
	wantStatus(t, err, http.StatusConflict)
}

func TestResolveBypass_FullAndStaleOnly(t *testing.T) {
	gates, r := bypassFixture()
	r.Annotations = map[string]string{AnnotationBypassGates: "1.4.1", AnnotationBypassGatesOnly: "kill-switch"}
	p, err := ResolveBypass(gates, r, BypassRequest{Version: "1.4.2"})
	if err != nil {
		t.Fatal(err)
	}
	if v, ok := p.Annotations[AnnotationBypassGatesOnly]; !ok || v != nil {
		t.Fatalf("stale only-list must be deleted (nil), got %v present=%v", v, ok)
	}
	if p.Scope != "all" || len(p.Gates) != 5 {
		t.Fatalf("%+v", p)
	}
}

func TestResolveBypass_Accumulate(t *testing.T) {
	gates, r := bypassFixture()
	r.Annotations = map[string]string{AnnotationBypassGates: "1.4.2", AnnotationBypassGatesOnly: "kill-switch"}
	p, err := ResolveBypass(gates, r, BypassRequest{Version: "1.4.2", Gates: []string{"dependency-db"}})
	if err != nil || *p.Annotations[AnnotationBypassGatesOnly] != "dependency-db,kill-switch" || p.Scope != "only" {
		t.Fatalf("%v %+v", err, p)
	}
	// Different version replaces rather than unions.
	r.Annotations[AnnotationBypassGates] = "1.4.1"
	p, _ = ResolveBypass(gates, r, BypassRequest{Version: "1.4.2", Gates: []string{"dependency-db"}})
	if *p.Annotations[AnnotationBypassGatesOnly] != "dependency-db" {
		t.Fatalf("%+v", p)
	}
	// Full bypass for the same build stays full.
	r.Annotations = map[string]string{AnnotationBypassGates: "1.4.2"}
	p, _ = ResolveBypass(gates, r, BypassRequest{Version: "1.4.2", Gates: []string{"dependency-db"}})
	if _, touched := p.Annotations[AnnotationBypassGatesOnly]; touched || p.Scope != "all" {
		t.Fatalf("full must stay full: %+v", p)
	}
}
