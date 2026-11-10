package kubernetes

import (
	"encoding/json"
	"fmt"
	"testing"

	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func benchList(n int) (*rolloutv1alpha1.RolloutList, GateKindIndex) {
	l := &rolloutv1alpha1.RolloutList{}
	idx := GateKindIndex{}
	for i := 0; i < n; i++ {
		ns := fmt.Sprintf("ns-%d", i%20)
		r := rolloutv1alpha1.Rollout{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: fmt.Sprintf("app-%d", i), Labels: map[string]string{"a": "b"}}}
		for g := 0; g < 4; g++ {
			name := fmt.Sprintf("gate-%d-%d", i, g)
			r.Status.Gates = append(r.Status.Gates, rolloutv1alpha1.RolloutGateStatusSummary{Name: name, AllowedVersions: []string{"v1", "v2"}, Message: "Gate is passing"})
			idx[ns+"/"+name] = GateKindApproval
		}
		l.Items = append(l.Items, r)
	}
	return l, idx
}

func BenchmarkRolloutList_Plain(b *testing.B) {
	l, _ := benchList(300)
	for i := 0; i < b.N; i++ {
		_, _ = json.Marshal(l)
	}
}

func BenchmarkRolloutList_WithGateKinds(b *testing.B) {
	l, idx := benchList(300)
	w := RolloutListWithGateKinds{RolloutList: l, Kinds: idx}
	for i := 0; i < b.N; i++ {
		_, _ = json.Marshal(w)
	}
}
