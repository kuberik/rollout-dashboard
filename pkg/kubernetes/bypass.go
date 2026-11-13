package kubernetes

import (
	"fmt"
	"net/http"
	"sort"
	"strings"

	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
)

// Annotation keys read by rollout-controller.
const (
	AnnotationBypassGates     = "rollout.kuberik.com/bypass-gates"
	AnnotationBypassGatesOnly = "rollout.kuberik.com/bypass-gates-only"
)

// Bypass scopes reported to the caller.
const (
	BypassScopeAll  = "all"
	BypassScopeOnly = "only"
)

// BypassRequest is the body of POST /rollouts/:ns/:name/bypass-gates.
type BypassRequest struct {
	Version string   `json:"version" binding:"required"`
	Rule    *RuleRef `json:"rule,omitempty"`
	Gates   []string `json:"gates,omitempty"`
}

// BypassPlan is what to write: Annotations is a JSON merge patch body for
// metadata.annotations (nil value = delete the key).
type BypassPlan struct {
	Annotations map[string]*string
	Version     string
	Gates       []string
	Scope       string
}

// BypassError carries the HTTP status a resolution failure maps to.
type BypassError struct {
	Status  int
	Message string
}

func (e *BypassError) Error() string { return e.Message }

func bypassErr(status int, format string, a ...any) *BypassError {
	return &BypassError{Status: status, Message: fmt.Sprintf(format, a...)}
}

// ResolveBypass turns a request into the annotations to write. It is pure: the
// caller supplies the gates of the rollout's namespace and the rollout as read.
//
//   - version must be a current release candidate, else 409 (the controller
//     would silently ignore the bypass).
//   - no rule and no gates: bypass every gate; any stale bypass-gates-only is
//     removed so "all" means all.
//   - rule: every gate of this rollout whose GateRule matches (kind, name and,
//     when given, namespace); 422 if none. gates: each must be a RolloutGate of
//     this rollout, else 422. Both may be given; the result is the union.
//   - accumulate: when bypass-gates already equals version, a full bypass stays
//     full and an only-list is unioned with the new names; any other existing
//     version is replaced.
func ResolveBypass(gates []rolloutv1alpha1.RolloutGate, rollout *rolloutv1alpha1.Rollout, req BypassRequest) (*BypassPlan, error) {
	if req.Version == "" {
		return nil, bypassErr(http.StatusBadRequest, "version is required")
	}
	candidate := false
	for _, c := range rollout.Status.Candidates {
		if c.Tag == req.Version {
			candidate = true
			break
		}
	}
	if !candidate {
		return nil, bypassErr(http.StatusConflict, "version %q is not a current release candidate of rollout %s/%s", req.Version, rollout.Namespace, rollout.Name)
	}

	byName := map[string]*rolloutv1alpha1.RolloutGate{}
	for i := range gates {
		g := &gates[i]
		if g.Namespace == rollout.Namespace && g.Spec.RolloutRef != nil && g.Spec.RolloutRef.Name == rollout.Name {
			byName[g.Name] = g
		}
	}
	all := make([]string, 0, len(byName))
	for n := range byName {
		all = append(all, n)
	}
	sort.Strings(all)

	plan := &BypassPlan{Version: req.Version, Annotations: map[string]*string{}}
	ver := req.Version
	plan.Annotations[AnnotationBypassGates] = &ver

	existing := rollout.Annotations[AnnotationBypassGates]
	existingOnly := splitNames(rollout.Annotations[AnnotationBypassGatesOnly])

	if req.Rule == nil && len(req.Gates) == 0 {
		plan.Annotations[AnnotationBypassGatesOnly] = nil
		plan.Gates, plan.Scope = all, BypassScopeAll
		return plan, nil
	}

	picked := map[string]bool{}
	if req.Rule != nil {
		if req.Rule.Kind == "" || req.Rule.Name == "" {
			return nil, bypassErr(http.StatusUnprocessableEntity, "rule needs kind and name")
		}
		matched := false
		for _, n := range all {
			r := GateRule(byName[n])
			if r.Kind == req.Rule.Kind && r.Name == req.Rule.Name && (req.Rule.Namespace == "" || r.Namespace == req.Rule.Namespace) {
				picked[n] = true
				matched = true
			}
		}
		if !matched {
			return nil, bypassErr(http.StatusUnprocessableEntity, "rule %s %q has no gate on rollout %s/%s", req.Rule.Kind, req.Rule.Name, rollout.Namespace, rollout.Name)
		}
	}
	for _, n := range req.Gates {
		if byName[n] == nil {
			return nil, bypassErr(http.StatusUnprocessableEntity, "gate %q is not a RolloutGate of rollout %s/%s", n, rollout.Namespace, rollout.Name)
		}
		picked[n] = true
	}

	if existing == req.Version && len(existingOnly) == 0 {
		// Already a full bypass for this build: stays full, nothing narrows it.
		plan.Gates, plan.Scope = all, BypassScopeAll
		return plan, nil
	}
	if existing == req.Version {
		for _, n := range existingOnly {
			picked[n] = true
		}
	}
	names := make([]string, 0, len(picked))
	for n := range picked {
		names = append(names, n)
	}
	sort.Strings(names)
	joined := strings.Join(names, ",")
	plan.Annotations[AnnotationBypassGatesOnly] = &joined
	plan.Gates, plan.Scope = names, BypassScopeOnly
	return plan, nil
}

func splitNames(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
