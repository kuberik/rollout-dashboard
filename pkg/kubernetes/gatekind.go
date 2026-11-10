package kubernetes

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// Gate kinds carried as "kind" on every gate summary (rollout.status.gates[])
// in the rollouts API. The set is a frontend contract; the field is always
// present, "unknown" when nothing below matches.
const (
	GateKindApproval         = "approval"
	GateKindSchedule         = "schedule"
	GateKindCheck            = "check"
	GateKindDependency       = "dependency"
	GateKindPromotion        = "promotion"
	GateKindGitHubDeployment = "github-deployment"
	GateKindUnknown          = "unknown"
)

// Marker names, copied from the controllers that stamp them.
const (
	// rollout-controller internal/controller/rolloutschedule_helpers.go:322-324.
	gateLabelScheduleName = "gate.kuberik.com/schedule-name"
	gateLabelScheduleKind = "gate.kuberik.com/schedule-kind"
	// rollout-controller internal/controller/rolloutdependency_helpers.go:30.
	gateLabelDependencyName = "gate.kuberik.com/dependency-name"
)

// GateKind classifies a RolloutGate. Signals, strongest first:
//
//  1. ownerReferences kind: RolloutSchedule / ClusterRolloutSchedule ->
//     schedule (rollout-controller); RolloutDependency -> dependency
//     (rollout-controller); Environment (environments.kuberik.com) ->
//     promotion (environment-controller's "ghd-" gate, "previous environment
//     tier / previous wave"). Any other owner -> unknown.
//  2. labels: gate.kuberik.com/schedule-name|schedule-kind -> schedule,
//     gate.kuberik.com/dependency-name -> dependency.
//  3. No owner and none of those labels -> approval.
//
// There is NO explicit approval marker anywhere in the controllers (grepped
// rollout-, environment-, deploy-, datadog-, prometheus-controller), so
// "approval" is defined by absence: a hand-authored, ownerless, unlabelled gate
// (the allowedVersions grant that the dashboard's Approve button edits).
// Consequently a hand-authored ownerless gate of another purpose also reads as
// approval; that is the accepted trade-off, not a guess about an owner.
//
// "check" and "github-deployment" are reserved in the contract but no
// controller creates a gate that can be recognised as either today (the "ghd-"
// gates are owned by Environment and are promotion gates by function), so they
// are never returned until a real marker exists. Never guess.
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
	if len(gate.OwnerReferences) == 0 {
		return GateKindApproval
	}
	return GateKindUnknown
}

// GateKindIndex maps "namespace/name" of a RolloutGate to its kind.
type GateKindIndex map[string]string

// Lookup returns the kind of the gate named in a rollout summary, "unknown"
// when the gate is not in the index.
func (i GateKindIndex) Lookup(namespace, name string) string {
	if k, ok := i[namespace+"/"+name]; ok {
		return k
	}
	return GateKindUnknown
}

// NewGateKindIndex indexes gates by namespace/name.
func NewGateKindIndex(gates []rolloutv1alpha1.RolloutGate) GateKindIndex {
	idx := make(GateKindIndex, len(gates))
	for i := range gates {
		idx[gates[i].Namespace+"/"+gates[i].Name] = GateKind(&gates[i])
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
	raw, err := json.Marshal(l.RolloutList)
	if err != nil {
		return nil, err
	}
	return injectGateKinds(raw, l.Kinds, true)
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
	raw, err := json.Marshal(r.Rollout)
	if err != nil {
		return nil, err
	}
	return injectGateKinds(raw, r.Kinds, false)
}

func injectGateKinds(raw []byte, kinds GateKindIndex, list bool) ([]byte, error) {
	top := map[string]json.RawMessage{}
	if err := json.Unmarshal(raw, &top); err != nil {
		return nil, fmt.Errorf("gate kinds: %w", err)
	}
	if !list {
		patched, err := patchRollout(raw, kinds)
		if err != nil {
			return nil, err
		}
		return patched, nil
	}
	var items []json.RawMessage
	if len(top["items"]) == 0 || json.Unmarshal(top["items"], &items) != nil {
		return raw, nil
	}
	for i := range items {
		p, err := patchRollout(items[i], kinds)
		if err != nil {
			return nil, err
		}
		items[i] = p
	}
	b, err := json.Marshal(items)
	if err != nil {
		return nil, err
	}
	top["items"] = b
	return json.Marshal(top)
}

func patchRollout(raw []byte, kinds GateKindIndex) ([]byte, error) {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil, err
	}
	var meta struct {
		Namespace string `json:"namespace"`
	}
	_ = json.Unmarshal(obj["metadata"], &meta)
	var status map[string]json.RawMessage
	if json.Unmarshal(obj["status"], &status) != nil || len(status["gates"]) == 0 {
		return raw, nil
	}
	var gates []map[string]json.RawMessage
	if json.Unmarshal(status["gates"], &gates) != nil {
		return raw, nil
	}
	for _, g := range gates {
		var name string
		_ = json.Unmarshal(g["name"], &name)
		k, _ := json.Marshal(kinds.Lookup(meta.Namespace, name))
		g["kind"] = k
	}
	gb, err := json.Marshal(gates)
	if err != nil {
		return nil, err
	}
	status["gates"] = gb
	sb, err := json.Marshal(status)
	if err != nil {
		return nil, err
	}
	obj["status"] = sb
	return json.Marshal(obj)
}
