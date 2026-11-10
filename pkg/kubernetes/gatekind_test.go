package kubernetes

import (
	"encoding/json"
	"reflect"
	"testing"

	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func gateWith(labels map[string]string, owners ...string) *rolloutv1alpha1.RolloutGate {
	av := []string{}
	g := &rolloutv1alpha1.RolloutGate{ObjectMeta: metav1.ObjectMeta{Namespace: "ns", Name: "g", Labels: labels}}
	g.Spec.AllowedVersions = &av
	for _, k := range owners {
		g.OwnerReferences = append(g.OwnerReferences, metav1.OwnerReference{Kind: k, Name: "o"})
	}
	return g
}

func TestGateKind(t *testing.T) {
	cases := []struct {
		name string
		gate *rolloutv1alpha1.RolloutGate
		want string
	}{
		{"nil", nil, GateKindUnknown},
		{"ownerless unlabelled is approval", gateWith(nil), GateKindApproval},
		{"ownerless kill-switch with no allowedVersions is unknown", func() *rolloutv1alpha1.RolloutGate {
			g := gateWith(nil)
			g.Spec.AllowedVersions = nil
			return g
		}(), GateKindUnknown},
		{"unrelated labels still approval", gateWith(map[string]string{"app": "x"}), GateKindApproval},
		{"RolloutSchedule owner", gateWith(map[string]string{"gate.kuberik.com/schedule-name": "s"}, "RolloutSchedule"), GateKindSchedule},
		{"ClusterRolloutSchedule owner", gateWith(nil, "ClusterRolloutSchedule"), GateKindSchedule},
		{"schedule label without owner", gateWith(map[string]string{"gate.kuberik.com/schedule-kind": "RolloutSchedule"}), GateKindSchedule},
		{"RolloutDependency owner", gateWith(map[string]string{"gate.kuberik.com/dependency-name": "d"}, "RolloutDependency"), GateKindDependency},
		{"dependency label without owner", gateWith(map[string]string{"gate.kuberik.com/dependency-name": "d"}), GateKindDependency},
		{"Environment owner is promotion", gateWith(nil, "Environment"), GateKindPromotion},
		{"owner beats label", gateWith(map[string]string{"gate.kuberik.com/schedule-name": "s"}, "Environment"), GateKindPromotion},
		{"unrecognised owner is unknown", gateWith(nil, "Deployment"), GateKindUnknown},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := GateKind(tc.gate); got != tc.want {
				t.Fatalf("GateKind = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestRolloutListWithGateKinds_InjectsKindOnEverySummary(t *testing.T) {
	approval := gateWith(nil)
	approval.Name = "manual"
	sched := gateWith(nil, "RolloutSchedule")
	sched.Name = "sched"
	idx := NewGateKindIndex([]rolloutv1alpha1.RolloutGate{*approval, *sched})
	list := &rolloutv1alpha1.RolloutList{Items: []rolloutv1alpha1.Rollout{{
		ObjectMeta: metav1.ObjectMeta{Namespace: "ns", Name: "app"},
		Status: rolloutv1alpha1.RolloutStatus{Gates: []rolloutv1alpha1.RolloutGateStatusSummary{
			{Name: "manual"}, {Name: "sched"}, {Name: "vanished"},
		}},
	}}}
	b, err := json.Marshal(RolloutListWithGateKinds{RolloutList: list, Kinds: idx})
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		Items []struct {
			Status struct {
				Gates []struct{ Name, Kind string } `json:"gates"`
			} `json:"status"`
		} `json:"items"`
	}
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"manual": "approval", "sched": "schedule", "vanished": "unknown"}
	for _, g := range out.Items[0].Status.Gates {
		if g.Kind != want[g.Name] {
			t.Errorf("gate %s kind = %q, want %q", g.Name, g.Kind, want[g.Name])
		}
	}
	if len(out.Items[0].Status.Gates) != 3 {
		t.Fatalf("gates = %d", len(out.Items[0].Status.Gates))
	}
}

// The typed encoder must be the plain encoding plus kind, nothing else.
func TestRolloutListWithGateKinds_OnlyAddsKind(t *testing.T) {
	l, idx := benchList(5)
	plain, _ := json.Marshal(l)
	withKinds, err := json.Marshal(RolloutListWithGateKinds{RolloutList: l, Kinds: idx})
	if err != nil {
		t.Fatal(err)
	}
	var a, b map[string]interface{}
	_ = json.Unmarshal(plain, &a)
	_ = json.Unmarshal(withKinds, &b)
	for _, it := range b["items"].([]interface{}) {
		for _, g := range it.(map[string]interface{})["status"].(map[string]interface{})["gates"].([]interface{}) {
			m := g.(map[string]interface{})
			if m["kind"] != "approval" {
				t.Fatalf("kind = %v", m["kind"])
			}
			delete(m, "kind")
		}
	}
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("encoding differs beyond kind:\n%s\n%s", plain, withKinds)
	}
}
