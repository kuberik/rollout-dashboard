package kubernetes

import (
	"math/rand"
	"testing"
	"time"

	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// shuffle returns a new slice with items in a randomized order, seeded so a
// failing case is reproducible from the printed seed rather than only
// failing intermittently in CI.
func shuffle[T any](t *testing.T, items []T) []T {
	t.Helper()
	seed := time.Now().UnixNano()
	t.Logf("shuffle seed: %d", seed)
	rnd := rand.New(rand.NewSource(seed))
	out := make([]T, len(items))
	copy(out, items)
	rnd.Shuffle(len(out), func(i, j int) { out[i], out[j] = out[j], out[i] })
	return out
}

func rolloutWith(namespace, name string) rolloutv1alpha1.Rollout {
	return rolloutv1alpha1.Rollout{ObjectMeta: metav1.ObjectMeta{Namespace: namespace, Name: name}}
}

// This is the defect from PERF-2026-09-04 §D, reproduced directly on the
// helper: a LIST result read off a map (the informer cache's Store, or — as
// here — anything else backed by map iteration) can come back in a
// different order every time even though the underlying set of objects is
// unchanged. SortByNamespaceName must collapse any input order to the same
// (namespace, name) order.
func TestSortByNamespaceName_NamespacedType(t *testing.T) {
	want := []rolloutv1alpha1.Rollout{
		rolloutWith("dev", "api"),
		rolloutWith("dev", "web"),
		rolloutWith("prod", "api"),
		rolloutWith("prod", "web"),
		rolloutWith("staging", "api"),
	}

	for run := 0; run < 20; run++ {
		items := shuffle(t, want)
		SortByNamespaceName(items)
		for i := range want {
			if items[i].Namespace != want[i].Namespace || items[i].Name != want[i].Name {
				t.Fatalf("run %d: item %d = %s/%s, want %s/%s (full: %v)",
					run, i, items[i].Namespace, items[i].Name, want[i].Namespace, want[i].Name, items)
			}
		}
	}
}

// ClusterRolloutSchedule is cluster-scoped — GetNamespace() always returns ""
// for it — so the sort must still produce a stable, deterministic order,
// collapsing to name-only.
func TestSortByNamespaceName_ClusterScopedType(t *testing.T) {
	want := []rolloutv1alpha1.ClusterRolloutSchedule{
		{ObjectMeta: metav1.ObjectMeta{Name: "business-hours"}},
		{ObjectMeta: metav1.ObjectMeta{Name: "maintenance-window"}},
		{ObjectMeta: metav1.ObjectMeta{Name: "weekend-freeze"}},
	}

	for run := 0; run < 20; run++ {
		items := shuffle(t, want)
		SortByNamespaceName(items)
		for i := range want {
			if items[i].Name != want[i].Name {
				t.Fatalf("run %d: item %d = %s, want %s", run, i, items[i].Name, want[i].Name)
			}
		}
	}
}

// SortByNamespaceName must not reorder equal keys relative to each other —
// callers (e.g. GetKustomizationsByRolloutAnnotation, which sorts the raw
// LIST before filtering) rely on filtering after the sort preserving that
// order for anything the (namespace, name) key alone doesn't distinguish.
// Two rollouts never share a name in the same namespace, so this is checked
// via a field the sort key ignores.
func TestSortByNamespaceName_StableOnEqualKeys(t *testing.T) {
	type tagged struct {
		metav1.ObjectMeta
		Tag string
	}
	items := []tagged{
		{ObjectMeta: metav1.ObjectMeta{Namespace: "ns", Name: "a"}, Tag: "first"},
		{ObjectMeta: metav1.ObjectMeta{Namespace: "ns", Name: "a"}, Tag: "second"},
	}
	SortByNamespaceName(items)
	if items[0].Tag != "first" || items[1].Tag != "second" {
		t.Fatalf("stable sort reordered equal-key items: %+v", items)
	}
}

func eventAt(name string, ts time.Time) corev1.Event {
	return corev1.Event{
		ObjectMeta:    metav1.ObjectMeta{Name: name},
		LastTimestamp: metav1.NewTime(ts),
	}
}

// GetEventsForRollout's "recent activity" ordering is most-recent-first; two
// events landing in the exact same instant (common — several objects
// touched in one reconcile) must still land in a fixed order rather than
// whatever order sort.Slice's pivot choice produced for that call.
func TestSortEventsByTimestampThenName(t *testing.T) {
	base := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	want := []corev1.Event{
		eventAt("z-event", base.Add(time.Minute)), // newest first
		eventAt("a-event", base),                  // tie on base ts, name asc
		eventAt("b-event", base),
		eventAt("y-event", base.Add(-time.Hour)), // oldest last
	}

	for run := 0; run < 20; run++ {
		events := shuffle(t, want)
		sortEventsByTimestampThenName(events)
		for i := range want {
			if events[i].Name != want[i].Name {
				t.Fatalf("run %d: event %d = %s, want %s (full: %v)", run, i, events[i].Name, want[i].Name, names(events))
			}
		}
	}
}

func names(events []corev1.Event) []string {
	out := make([]string, len(events))
	for i, e := range events {
		out[i] = e.Name
	}
	return out
}
