package kubernetes

import (
	"encoding/json"
	"reflect"
	"strings"
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
			if m["displayName"] != "Business hours" {
				t.Fatalf("displayName = %v", m["displayName"])
			}
			delete(m, "kind")
			delete(m, "displayName")
		}
	}
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("encoding differs beyond kind:\n%s\n%s", plain, withKinds)
	}
}

// jsonFieldNames returns every JSON key a struct type encodes, flattening
// anonymous (inline / untagged embedded) structs the way encoding/json does.
func jsonFieldNames(t reflect.Type, into map[string]bool) {
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		tag := f.Tag.Get("json")
		name := strings.Split(tag, ",")[0]
		if tag == "-" {
			continue
		}
		if f.Anonymous && name == "" && f.Type.Kind() == reflect.Struct {
			jsonFieldNames(f.Type, into)
			continue
		}
		if name == "" {
			name = f.Name
		}
		into[name] = true
	}
}

// The gate-kind encoder mirrors the Rollout field layout by hand. A field added
// upstream would otherwise be dropped from API responses silently.
func TestRolloutWithKindsJSON_MirrorsEveryUpstreamField(t *testing.T) {
	check := func(label string, upstream, mirror reflect.Type) {
		want, got := map[string]bool{}, map[string]bool{}
		jsonFieldNames(upstream, want)
		jsonFieldNames(mirror, got)
		for name := range want {
			if !got[name] {
				t.Errorf("%s: upstream json field %q is not covered by the gate-kind mirror", label, name)
			}
		}
	}
	check("Rollout", reflect.TypeOf(rolloutv1alpha1.Rollout{}), reflect.TypeOf(rolloutWithKindsJSON{}))
	check("RolloutStatus", reflect.TypeOf(rolloutv1alpha1.RolloutStatus{}), reflect.TypeOf(rolloutStatusWithKinds{}))
	check("RolloutGateStatusSummary", reflect.TypeOf(rolloutv1alpha1.RolloutGateStatusSummary{}), reflect.TypeOf(gateSummaryWithKind{}))
	extra := map[string]bool{}
	jsonFieldNames(reflect.TypeOf(gateSummaryWithKind{}), extra)
	for _, k := range []string{"kind", "displayName"} {
		if !extra[k] {
			t.Errorf("gate summary mirror lacks the added %q field", k)
		}
	}
	check("RolloutList", reflect.TypeOf(rolloutv1alpha1.RolloutList{}), reflect.TypeOf(rolloutListJSON{}))
}

func TestNewGateKindIndex_DisplayNameFromPrettyNameAnnotation(t *testing.T) {
	named := gateWith(nil, "RolloutSchedule")
	named.Name = "named"
	named.Annotations = map[string]string{"gate.kuberik.com/pretty-name": "Business hours"}
	bare := gateWith(nil, "RolloutSchedule")
	bare.Name = "bare"
	idx := NewGateKindIndex([]rolloutv1alpha1.RolloutGate{*named, *bare})
	if got := idx.Lookup("ns", "named").DisplayName; got != "Business hours" {
		t.Errorf("named displayName = %q", got)
	}
	if got := idx.Lookup("ns", "bare").DisplayName; got != "" {
		t.Errorf("bare displayName = %q, want empty (never invented)", got)
	}
	l := &rolloutv1alpha1.RolloutList{Items: []rolloutv1alpha1.Rollout{{
		ObjectMeta: metav1.ObjectMeta{Namespace: "ns", Name: "app"},
		Status:     rolloutv1alpha1.RolloutStatus{Gates: []rolloutv1alpha1.RolloutGateStatusSummary{{Name: "bare"}}},
	}}}
	b, _ := json.Marshal(RolloutListWithGateKinds{RolloutList: l, Kinds: idx})
	if strings.Contains(string(b), "displayName") {
		t.Fatalf("displayName must be omitted without an annotation: %s", b)
	}
}
