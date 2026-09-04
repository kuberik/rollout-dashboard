package kubernetes

import (
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

// NewTestClient builds a *Client backed by a controller-runtime fake client
// preloaded with objs, sharing the same Scheme every real client in this
// package builds from (buildScheme, in client.go). For tests only —
// production code always goes through NewClient/NewClientWithToken or the
// informer-cache-backed client InitReadCache builds; this has no clientset,
// so anything reading through c.clientset (pod logs, GetEventsForRollout's
// typed Events LIST) is out of scope for tests built on top of this.
//
// The fake client's own List order is not guaranteed stable across calls —
// its backing store is itself a Go map (client-go's testing.ObjectTracker) —
// which is exactly why this exists: it reproduces the same class of
// nondeterminism InitReadCache's real informer cache has (PERF-2026-09-04
// §D), so a test built on it actually exercises whether the code sorts its
// own output rather than happening to pass because the fixture data was
// already in order.
func NewTestClient(objs ...client.Object) (*Client, error) {
	scheme, err := buildScheme()
	if err != nil {
		return nil, err
	}
	cl := fake.NewClientBuilder().WithScheme(scheme).WithObjects(objs...).Build()
	return &Client{client: cl}, nil
}
