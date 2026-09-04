package kubernetes

import (
	"context"
	"fmt"
	"log"
	"sync/atomic"
	"time"

	kustomizev1 "github.com/fluxcd/kustomize-controller/api/v1"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	envv1alpha1 "github.com/kuberik/environment-controller/api/v1alpha1"
	openkruisev1alpha1 "github.com/kuberik/openkruise-controller/api/v1alpha1"
	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	kruiserolloutv1beta1 "github.com/openkruise/kruise-rollout-api/rollouts/v1beta1"
	toolscache "k8s.io/client-go/tools/cache"

	"k8s.io/client-go/kubernetes"
	"sigs.k8s.io/controller-runtime/pkg/cache"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// Informer cache for reads — hub-local resources only.
//
// PERF-2026-09-04 §C.1: every LIST/GET this dashboard's handlers issue for the
// types below used to be a live apiserver round trip on every request (§B.2:
// +5 apiserver LISTs for 5 identical /api/rollouts calls). This file wires an
// informer cache behind the shared read client (GetReadClient in context.go)
// so repeat reads between watch events are in-memory.
//
// Deliberately hub-local only. rollout-dashboard's multi-cluster fan-out
// (main_fanout.go) reaches spokes over plain HTTP to each spoke's own
// /api/rollouts — never a second controller-runtime client watching a remote
// apiserver directly. Extending this cache to a spoke would mean this process
// opening an inbound watch against a cluster it doesn't own, which is exactly
// the shape this product's pull-based design forbids. A spoke dashboard gets
// its own cache for its own hub-local reads, the same way this file gives one
// to whichever single cluster this process is deployed into.
//
// cachedByObject lists the exact resource types the dashboard's read handlers
// fetch (cross-checked against pkg/kubernetes/client.go's Get*/List methods
// and every handler in main.go): Rollout, RolloutDependency, RolloutGate,
// RolloutSchedule, ClusterRolloutSchedule, HealthCheck (all kuberik.com),
// RolloutTest (openkruise-controller), Environment (environment-controller),
// KruiseRollout (rollouts.kruise.io), Kustomization and OCIRepository (Flux).
// Arbitrary/unstructured reads (GetKustomizationManagedResources' per-inventory
// GETs, which cover whatever GVKs happen to be in a Kustomization's inventory)
// are intentionally NOT cached here — client.CacheOptions.Unstructured
// defaults to false, so those stay live lookups, unchanged from before.
func cachedByObject() map[client.Object]cache.ByObject {
	return map[client.Object]cache.ByObject{
		&rolloutv1alpha1.Rollout{}:                {},
		&rolloutv1alpha1.RolloutDependency{}:      {},
		&rolloutv1alpha1.RolloutGate{}:            {},
		&rolloutv1alpha1.RolloutSchedule{}:        {},
		&rolloutv1alpha1.ClusterRolloutSchedule{}: {},
		&rolloutv1alpha1.HealthCheck{}:            {},
		&openkruisev1alpha1.RolloutTest{}:         {},
		&envv1alpha1.Environment{}:                {},
		&kruiserolloutv1beta1.Rollout{}:           {},
		&kustomizev1.Kustomization{}:              {},
		&sourcev1.OCIRepository{}:                 {},
	}
}

// kindOf names the object type for ChangeEvent.Kind. A plain type switch over
// the same set cachedByObject() lists — kept in sync with it by inspection,
// same as the doc comment above cachedByObject already promises to be kept in
// sync with the handlers in main.go.
func kindOf(obj client.Object) string {
	switch obj.(type) {
	case *rolloutv1alpha1.Rollout:
		return "Rollout"
	case *rolloutv1alpha1.RolloutDependency:
		return "RolloutDependency"
	case *rolloutv1alpha1.RolloutGate:
		return "RolloutGate"
	case *rolloutv1alpha1.RolloutSchedule:
		return "RolloutSchedule"
	case *rolloutv1alpha1.ClusterRolloutSchedule:
		return "ClusterRolloutSchedule"
	case *rolloutv1alpha1.HealthCheck:
		return "HealthCheck"
	case *openkruisev1alpha1.RolloutTest:
		return "RolloutTest"
	case *envv1alpha1.Environment:
		return "Environment"
	case *kruiserolloutv1beta1.Rollout:
		return "KruiseRollout"
	case *kustomizev1.Kustomization:
		return "Kustomization"
	case *sourcev1.OCIRepository:
		return "OCIRepository"
	default:
		return fmt.Sprintf("%T", obj)
	}
}

// publishChange converts one raw informer callback value into a ChangeEvent
// and publishes it to hub. obj is normally the typed object itself
// (client.Object); a delete callback firing after a watch resync/relist can
// instead hand back a toolscache.DeletedFinalStateUnknown wrapping the last
// known object, which is unwrapped here so deletes still carry a real
// name/namespace instead of being silently dropped.
func publishChange(hub *EventHub, changeType, kind string, obj interface{}) {
	if d, ok := obj.(toolscache.DeletedFinalStateUnknown); ok {
		obj = d.Obj
	}
	co, ok := obj.(client.Object)
	if !ok || co == nil {
		return
	}
	hub.Publish(ChangeEvent{
		Type:            changeType,
		Kind:            kind,
		Namespace:       co.GetNamespace(),
		Name:            co.GetName(),
		ResourceVersion: co.GetResourceVersion(),
		Ts:              time.Now().UnixMilli(),
	})
}

// ErrCacheWarming is returned by GetReadClient while InitReadCache's initial
// sync is still in flight. Handler code (main_helper.go's getK8sReadClient)
// turns this into a 503 instead of blocking the request on the sync —
// warm-up for a fresh pod is bounded (InitReadCache's syncTimeout) and ought
// to be visible as a clean, fast outage response, not request latency.
var ErrCacheWarming = fmt.Errorf("kubernetes read cache is still warming up")

var (
	readCacheClient *Client
	readCacheReady  atomic.Bool
)

// SetReadClientForTest overrides GetReadClient's result for the duration of a
// test, bypassing InitReadCache (and therefore any real apiserver/kubeconfig)
// entirely. Returns a restore func that puts back whatever GetReadClient
// would have returned before the override — call it via `defer`.
//
// Exists for handler-level tests (main_list_order_test.go) that need
// getK8sReadClient (main_helper.go) to hand back a client backed by a fake
// controller-runtime client loaded with fixture objects, so the test
// exercises the real production handler in main.go rather than a
// reimplementation of it.
func SetReadClientForTest(c *Client) func() {
	prevClient, prevReady := readCacheClient, readCacheReady.Load()
	readCacheClient = c
	readCacheReady.Store(true)
	return func() {
		readCacheClient = prevClient
		readCacheReady.Store(prevReady)
	}
}

// InitReadCache builds the informer cache and its cache-backed read client,
// starts the cache, eagerly registers an informer for every type in
// cachedByObject (GetInformer — without this, informers are created lazily on
// first Get/List, which would defeat "wait for sync at startup"), and blocks
// this goroutine (not the caller — call this via `go InitReadCache(...)`)
// until WaitForCacheSync returns or syncTimeout elapses, whichever is first.
//
// A single informer that never syncs (e.g. a CRD not installed on this
// cluster — RolloutDependency is optional today, see client.go's existing
// non-fatal handling for it) does not block the others or leave the read
// path permanently 503: after the timeout, readCacheReady is set regardless,
// and any type that never synced falls through to the cache library's own
// per-call error for that one type, exactly like an uncached client would
// return for a missing CRD.
func InitReadCache(ctx context.Context, syncTimeout time.Duration) {
	cfg, err := baseRestConfig()
	if err != nil {
		log.Printf("[read-cache] failed to build rest config, reads stay uncached: %v", err)
		return
	}
	scheme, mapper, err := sharedSchemeAndMapper()
	if err != nil {
		log.Printf("[read-cache] failed to build shared scheme/mapper, reads stay uncached: %v", err)
		return
	}

	c, err := cache.New(cfg, cache.Options{
		Scheme:   scheme,
		Mapper:   mapper,
		ByObject: cachedByObject(),
		// managedFields are the largest part of most objects and nothing in
		// the dashboard reads them; dropping them at the informer shrinks the
		// cache and every list response built from it (PERF C.9).
		DefaultTransform: cache.TransformStripManagedFields(),
	})
	if err != nil {
		log.Printf("[read-cache] failed to build informer cache, reads stay uncached: %v", err)
		return
	}

	// Runs for the process lifetime — there is currently no shutdown path that
	// needs to cancel it (the pod exits, the OS reclaims everything).
	go func() {
		if err := c.Start(context.Background()); err != nil {
			log.Printf("[read-cache] informer cache stopped: %v", err)
		}
	}()

	// Eagerly create an informer per type so WaitForCacheSync below actually
	// waits on something — GetInformer registers+starts, it does not block for
	// sync itself. Logged per-type (not fatal) so one bad CRD doesn't hide the
	// others' failures. Also registers the add/update/delete handler that
	// feeds Hub (eventhub.go) — PERF-2026-09-04 §C.6: the informer cache
	// already knows the instant anything changes, so this is the one place
	// that turns a watch event into a ChangeEvent for /api/events/stream.
	for obj := range cachedByObject() {
		informer, err := c.GetInformer(ctx, obj)
		if err != nil {
			log.Printf("[read-cache] failed to start informer for %T (resync/list failures for this type will be visible on read, not here): %v", obj, err)
			continue
		}
		kind := kindOf(obj)
		if _, err := informer.AddEventHandler(toolscache.ResourceEventHandlerFuncs{
			AddFunc: func(o interface{}) { publishChange(Hub, "add", kind, o) },
			UpdateFunc: func(_, newObj interface{}) {
				publishChange(Hub, "update", kind, newObj)
			},
			DeleteFunc: func(o interface{}) { publishChange(Hub, "delete", kind, o) },
		}); err != nil {
			log.Printf("[read-cache] failed to register change-stream handler for %s: %v", kind, err)
		}
	}

	cl, err := client.New(cfg, client.Options{
		Scheme: scheme,
		Mapper: mapper,
		Cache:  &client.CacheOptions{Reader: c},
	})
	if err != nil {
		log.Printf("[read-cache] failed to build cache-backed client, reads stay uncached: %v", err)
		return
	}
	clientset, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		log.Printf("[read-cache] failed to build clientset for cache-backed client, reads stay uncached: %v", err)
		return
	}
	readCacheClient = &Client{client: cl, config: cfg, clientset: clientset}

	syncCtx, cancel := context.WithTimeout(ctx, syncTimeout)
	defer cancel()
	if c.WaitForCacheSync(syncCtx) {
		log.Printf("[read-cache] informer cache synced for all %d configured types", len(cachedByObject()))
	} else {
		log.Printf("[read-cache] initial sync did not complete within %s — serving reads now anyway; any type still unsynced (e.g. a missing CRD) will error per-call exactly as an uncached client would", syncTimeout)
	}
	readCacheReady.Store(true)
}
