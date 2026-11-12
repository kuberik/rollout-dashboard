package kubernetes

import (
	"context"
	"encoding/json"
	"log"

	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// Gate kinds carried as "kind" on every gate summary (rollout.status.gates[])
// in the rollouts API. The set is a frontend contract; the field is always
// present, "unknown" when nothing below matches.
const (
	GateKindApproval   = "approval"
	GateKindSchedule   = "schedule"
	GateKindDependency = "dependency"
	GateKindPromotion  = "promotion"
	GateKindUnknown    = "unknown"
)

// Marker names, copied from the controllers that stamp them.
const (
	// rollout-controller internal/controller/rolloutschedule_helpers.go:322-324.
	gateLabelScheduleName = "gate.kuberik.com/schedule-name"
	gateLabelScheduleKind = "gate.kuberik.com/schedule-kind"
	// rollout-controller internal/controller/rolloutdependency_helpers.go:30.
	gateLabelDependencyName = "gate.kuberik.com/dependency-name"
	// rollout-controller ApprovalPolicy / ClusterApprovalPolicy gates
	// (docs: APPROVALS-API.md section 8.2).
	gateLabelApprovalPolicyName = "gate.kuberik.com/approval-policy-name"
)

// GateKind classifies a RolloutGate. Signals, strongest first:
//
//  1. ownerReferences kind: RolloutSchedule / ClusterRolloutSchedule ->
//     schedule (rollout-controller); RolloutDependency -> dependency
//     (rollout-controller); ApprovalPolicy / ClusterApprovalPolicy -> approval
//     (rollout-controller); Environment (environments.kuberik.com) ->
//     promotion (environment-controller's "ghd-" gate, "previous environment
//     tier / previous wave"). Any other owner -> unknown.
//  2. labels: gate.kuberik.com/schedule-name|schedule-kind -> schedule,
//     gate.kuberik.com/dependency-name -> dependency,
//     gate.kuberik.com/approval-policy-name -> approval.
//  3. LEGACY shape rule: no owner, no schedule/dependency label, and spec.allowedVersions set
//     (non-nil, possibly empty: the field the Approve action edits) ->
//     approval. Anything else ownerless (kill-switch gates, custom-controller
//     gates with no allowedVersions) -> unknown.
//
// Approval gates are now marked explicitly: owned by an ApprovalPolicy /
// ClusterApprovalPolicy, or labelled gate.kuberik.com/approval-policy-name.
// The shape rule (ownerless, unlabelled, allowedVersions set) is kept only so
// ungraduated gates, created by hand before policies existed, keep working
// during migration. It is removed in the cleanup PR one minor release after
// the approvals API ships (APPROVALS-API.md section 9, step 5 / PR 10), after
// which such a gate reads as "unknown".
//
// The contract has no "check" or "github-deployment": no controller creates a
// gate recognisable as either (the "ghd-" gates are Environment-owned
// promotion gates). Add a kind only when a controller marker exists.
func GateKind(gate *rolloutv1alpha1.RolloutGate) string {
	if gate == nil {
		return GateKindUnknown
	}
	for _, o := range gate.OwnerReferences {
		switch o.Kind {
		case "RolloutSchedule", "ClusterRolloutSchedule":
			return GateKindSchedule
		case "RolloutDependency":
			return GateKindDependency
		case "ApprovalPolicy", "ClusterApprovalPolicy":
			return GateKindApproval
		case "Environment":
			return GateKindPromotion
		}
	}
	if gate.Labels[gateLabelScheduleName] != "" || gate.Labels[gateLabelScheduleKind] != "" {
		return GateKindSchedule
	}
	if gate.Labels[gateLabelDependencyName] != "" {
		return GateKindDependency
	}
	if gate.Labels[gateLabelApprovalPolicyName] != "" {
		return GateKindApproval
	}
	// Legacy shape rule; remove in the cleanup PR (see GateKind doc).
	if len(gate.OwnerReferences) == 0 && gate.Spec.AllowedVersions != nil {
		return GateKindApproval
	}
	return GateKindUnknown
}

// gateAnnotationPrettyName is the display-name annotation the controllers
// stamp on gates (rollout-controller rolloutschedule_helpers.go:384, 434 and
// rolloutdependency_controller.go:287; environment-controller
// githubenvironment_controller.go:1326) and the
// frontend reads (view-models/gate-name.ts PRETTY_NAME_KEY).
const gateAnnotationPrettyName = "gate.kuberik.com/pretty-name"

// GateInfo is what a gate summary is enriched with: its kind and, when the
// RolloutGate carries a pretty-name annotation, its display name (empty means
// "omit the field", never an invented name).
type GateInfo struct {
	Kind        string
	DisplayName string
}

// GateKindIndex maps "namespace/name" of a RolloutGate to its GateInfo.
type GateKindIndex map[string]GateInfo

// Lookup returns the kind of the gate named in a rollout summary, "unknown"
// when the gate is not in the index.
func (i GateKindIndex) Lookup(namespace, name string) GateInfo {
	if k, ok := i[namespace+"/"+name]; ok {
		return k
	}
	return GateInfo{Kind: GateKindUnknown}
}

// NewGateKindIndex indexes gates by namespace/name.
func NewGateKindIndex(gates []rolloutv1alpha1.RolloutGate) GateKindIndex {
	idx := make(GateKindIndex, len(gates))
	for i := range gates {
		idx[gates[i].Namespace+"/"+gates[i].Name] = GateInfo{Kind: GateKind(&gates[i]), DisplayName: gates[i].Annotations[gateAnnotationPrettyName]}
	}
	return idx
}

// GateKindIndex builds the index from the informer cache (one cached LIST, no
// apiserver call). On error it returns an empty index so every summary still
// carries "unknown" rather than the request failing.
func (c *Client) GateKindIndex(ctx context.Context) GateKindIndex {
	gates := &rolloutv1alpha1.RolloutGateList{}
	if err := c.client.List(ctx, gates, client.InNamespace("")); err != nil {
		log.Printf("gate kinds: list rollout gates: %v", err)
		return GateKindIndex{}
	}
	return NewGateKindIndex(gates.Items)
}

// The wrappers below encode in ONE typed pass: a shadow struct embeds the real
// type and overrides only status.gates (the shallower field wins in
// encoding/json), so no re-marshal / generic-map round trip is needed.

type gateSummaryWithKind struct {
	rolloutv1alpha1.RolloutGateStatusSummary
	Kind        string `json:"kind"`
	DisplayName string `json:"displayName,omitempty"`
}

type rolloutStatusWithKinds struct {
	rolloutv1alpha1.RolloutStatus
	Gates []gateSummaryWithKind `json:"gates,omitempty"`
}

type rolloutWithKindsJSON struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`
	Spec              rolloutv1alpha1.RolloutSpec `json:"spec,omitempty"`
	Status            rolloutStatusWithKinds      `json:"status,omitempty"`
}

func toKindJSON(r *rolloutv1alpha1.Rollout, kinds GateKindIndex) rolloutWithKindsJSON {
	out := rolloutWithKindsJSON{TypeMeta: r.TypeMeta, ObjectMeta: r.ObjectMeta, Spec: r.Spec}
	out.Status.RolloutStatus = r.Status
	if len(r.Status.Gates) > 0 {
		out.Status.Gates = make([]gateSummaryWithKind, len(r.Status.Gates))
		for i, g := range r.Status.Gates {
			info := kinds.Lookup(r.Namespace, g.Name)
			out.Status.Gates[i] = gateSummaryWithKind{RolloutGateStatusSummary: g, Kind: info.Kind, DisplayName: info.DisplayName}
		}
	}
	return out
}

type rolloutListJSON struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []rolloutWithKindsJSON `json:"items"`
}

// RolloutListWithGateKinds marshals like the wrapped RolloutList but adds
// "kind" to every status.gates[] entry.
type RolloutListWithGateKinds struct {
	*rolloutv1alpha1.RolloutList
	Kinds GateKindIndex
}

func (l RolloutListWithGateKinds) MarshalJSON() ([]byte, error) {
	if l.RolloutList == nil {
		return []byte("null"), nil
	}
	out := rolloutListJSON{TypeMeta: l.TypeMeta, ListMeta: l.ListMeta, Items: make([]rolloutWithKindsJSON, len(l.Items))}
	for i := range l.Items {
		out.Items[i] = toKindJSON(&l.Items[i], l.Kinds)
	}
	return json.Marshal(out)
}

// RolloutWithGateKinds is the single-rollout counterpart.
type RolloutWithGateKinds struct {
	*rolloutv1alpha1.Rollout
	Kinds GateKindIndex
}

func (r RolloutWithGateKinds) MarshalJSON() ([]byte, error) {
	if r.Rollout == nil {
		return []byte("null"), nil
	}
	return json.Marshal(toKindJSON(r.Rollout, r.Kinds))
}
