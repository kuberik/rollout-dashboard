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
	// others' failures.
	for obj := range cachedByObject() {
		if _, err := c.GetInformer(ctx, obj); err != nil {
			log.Printf("[read-cache] failed to start informer for %T (resync/list failures for this type will be visible on read, not here): %v", obj, err)
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
