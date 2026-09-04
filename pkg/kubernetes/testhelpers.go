package kubernetes

import (
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime"
	k8sfake "k8s.io/client-go/kubernetes/fake"
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

// NewTestClientWithPods is NewTestClient plus a client-go fake clientset
// (k8s.io/client-go/kubernetes/fake) preloaded with pods, wired in as
// c.clientset — DERIVED-2026-09-04. BuildDeploymentChildren's Pods LIST goes
// through GetClientset() rather than the controller-runtime client (see that
// function's doc comment for why: Pods are deliberately not part of
// InitReadCache's informer cache), which is exactly what NewTestClient's own
// doc comment says is out of scope for it. Client.clientset is typed as the
// kubernetes.Interface a *kubernetes.Clientset implements rather than that
// concrete type specifically so a fake clientset can stand in here.
//
// Returns the fake Clientset itself (not just *Client) so a test can attach
// its own Fake.PrependReactor to count LIST calls — used to verify
// derived-data computation happens once per coalesced batch rather than once
// per subscriber (eventhub_derived_test.go).
func NewTestClientWithPods(objs []client.Object, pods ...corev1.Pod) (*Client, *k8sfake.Clientset, error) {
	c, err := NewTestClient(objs...)
	if err != nil {
		return nil, nil, err
	}
	podRuntimeObjs := make([]runtime.Object, 0, len(pods))
	for i := range pods {
		podRuntimeObjs = append(podRuntimeObjs, &pods[i])
	}
	fakeClientset := k8sfake.NewSimpleClientset(podRuntimeObjs...)
	c.clientset = fakeClientset
	return c, fakeClientset, nil
}
