package kubernetes

import (
	"sort"

	corev1 "k8s.io/api/core/v1"
)

// PERF-2026-09-04 §D (list-order determinism): every LIST this dashboard
// serves has been read from the controller-runtime informer cache since
// slice 2 (see cache.go's doc comment). An informer's Store is a Go map, so
// walking it — which is what client.List does to fill in a List's Items — is
// a map walk, and Go deliberately randomizes map iteration order. That
// means two back-to-back identical requests can return the same objects in
// a different order even though nothing in the cluster changed between
// them. The frontend renders response order directly and its own sorts have
// ties, so this surfaced as cards reshuffling on every reload and on every
// live poll.
//
// The fix belongs at the source — sort each List's Items immediately after
// the cache read returns, before the result goes anywhere else (a filter, a
// fan-out merge, a JSON response) — rather than in every handler or in the
// frontend. SortByNamespaceName below is the shared (namespace, name)
// helper used by nearly every typed list in client.go. Events and managed
// resources get their own comparators (see GetEventsForRollout and
// GetKustomizationManagedResources in client.go) because "most recent
// first" is the actual product intent there, not alphabetical — those two
// just needed a tie-breaker added to stay a true total order.

// nsNamed is satisfied by *T for every kuberik/Flux/OpenKruise API type
// SortByNamespaceName is called with here: each one embeds metav1.ObjectMeta
// by value, and ObjectMeta's GetNamespace/GetName have pointer receivers, so
// the promoted method lives on *T, not T. That's why the constraint below is
// `*T` plus the two methods rather than just requiring T to satisfy an
// interface directly — see SortByNamespaceName's doc comment for how this
// plays out at the call site.
type nsNamed[T any] interface {
	*T
	GetNamespace() string
	GetName() string
}

// SortByNamespaceName sorts items in place by (namespace, name), ascending,
// using a stable sort so equal keys (there are none in practice — namespace
// scoping and the apiserver both guarantee unique names) never move
// relative to each other between calls.
//
// T is inferred from the slice argument at the call site (e.g.
// SortByNamespaceName(rollouts.Items) infers T = rolloutv1alpha1.Rollout);
// PT is then inferred as *T. Safe for cluster-scoped types too
// (ClusterRolloutSchedule): GetNamespace() always returns "" for those,
// which just collapses the sort to name-only order.
func SortByNamespaceName[T any, PT nsNamed[T]](items []T) {
	sort.SliceStable(items, func(i, j int) bool {
		pi, pj := PT(&items[i]), PT(&items[j])
		if ni, nj := pi.GetNamespace(), pj.GetNamespace(); ni != nj {
			return ni < nj
		}
		return pi.GetName() < pj.GetName()
	})
}

// sortEventsByTimestampThenName orders events most-recent-first (matching
// GetEventsForRollout's existing "recent activity" intent — this is not a
// change of that ordering), tie-broken by the event's own Name.
// corev1.Event.Name carries a per-event unique suffix (either a UID-derived
// name or a `.<sequence>` suffix depending on the apiserver's event
// aggregation), so this is a genuine total order: two events landing in the
// same LastTimestamp instant no longer swap places between otherwise
// identical calls.
func sortEventsByTimestampThenName(events []corev1.Event) {
	sort.SliceStable(events, func(i, j int) bool {
		ti, tj := events[i].LastTimestamp.Time, events[j].LastTimestamp.Time
		if !ti.Equal(tj) {
			return ti.After(tj)
		}
		return events[i].Name < events[j].Name
	})
}
