package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/kuberik/rollout-dashboard/pkg/auth"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
)

// clusterRegistry caches the spoke cluster name→base-URL mapping so the proxy can
// resolve a ?cluster=<name> without re-running discovery on every request. It is
// populated opportunistically by fanOutRollouts (list calls) and refreshed
// on-demand by the proxy on a cache miss.
type clusterRegistry struct {
	mu        sync.RWMutex
	nameToURL map[string]string
	expiresAt time.Time
}

const clusterRegistryTTL = 45 * time.Second

var registry = &clusterRegistry{nameToURL: map[string]string{}}

// put replaces the cached spoke mapping with a freshly discovered set.
func (r *clusterRegistry) put(clusters []ClusterInfo) {
	m := make(map[string]string, len(clusters))
	for _, ci := range clusters {
		if ci.Name != "" && ci.URL != "" {
			m[ci.Name] = dashboardBaseURL(ci.URL)
		}
	}
	r.mu.Lock()
	r.nameToURL = m
	r.expiresAt = time.Now().Add(clusterRegistryTTL)
	r.mu.Unlock()
}

// lookup returns (baseURL, found, fresh).
func (r *clusterRegistry) lookup(name string) (string, bool, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	url, ok := r.nameToURL[name]
	return url, ok, time.Now().Before(r.expiresAt)
}

// localClusterName is this dashboard's own cluster name (CLUSTER_NAME env, else
// derived from its URL).
func localClusterName(c *gin.Context) string {
	if n := os.Getenv("CLUSTER_NAME"); n != "" {
		return n
	}
	return ClusterNameFromURL(localDashboardURL(c))
}

// discoverClusters returns the spoke clusters ({name,url}) reachable from this
// hub, derived from local Environment objects — the same discovery
// fanOutRollouts uses, but name-only (no rollout fetch) since resolution only
// needs the mapping.
func discoverClusters(ctx context.Context, envsJSON json.RawMessage, localURL, token string) []ClusterInfo {
	envs := parseEnvironments(envsJSON)
	selfURLs := append([]string{localURL}, localDashboardURLsFromEnvironments(envs)...)
	spokeURLs := extractSpokeURLs(envs, selfURLs)
	if len(spokeURLs) == 0 {
		return nil
	}

	// PERF-2026-09-10: resolved through the shared name cache, so this is
	// normally memory-only. Previously every call here made a live
	// /api/cluster request per spoke with a 5s client timeout, which is
	// what made GET /api/clusters take 5.6s — and it runs on every page via
	// the Navbar — whenever one spoke was unroutable.
	names := make([]string, len(spokeURLs))
	var wg sync.WaitGroup
	for i, su := range spokeURLs {
		wg.Add(1)
		go func(idx int, spokeURL string) {
			defer wg.Done()
			names[idx] = cachedSpokeClusterName(ctx, spokeURL, token)
		}(i, su)
	}
	wg.Wait()

	clusters := make([]ClusterInfo, 0, len(spokeURLs))
	seen := make(map[string]bool)
	for i, su := range spokeURLs {
		n := names[i]
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		clusters = append(clusters, ClusterInfo{URL: su, Name: n})
	}
	return clusters
}

// resolveClusterURL maps a cluster name to a spoke base URL. isLocal=true means
// the name is this cluster and no proxy is needed. Refreshes the registry via
// on-demand discovery on a cache miss (e.g. a fresh deep-link before any list
// call warmed the cache).
func resolveClusterURL(c *gin.Context, name string) (baseURL string, isLocal bool, err error) {
	if name == "" || name == localClusterName(c) {
		return "", true, nil
	}
	if u, ok, fresh := registry.lookup(name); ok && fresh {
		return u, false, nil
	}

	k8sClient, err := kubernetes.GetReadClient(c)
	if err != nil {
		return "", false, err
	}
	envs, err := k8sClient.GetEnvironmentsAllNamespaces(c.Request.Context())
	if err != nil {
		return "", false, err
	}
	clusters := discoverClusters(
		c.Request.Context(),
		marshalToRaw(envs),
		localDashboardURL(c),
		auth.GetTokenFromContext(c),
	)
	registry.put(clusters)

	if u, ok, _ := registry.lookup(name); ok {
		return u, false, nil
	}
	return "", false, fmt.Errorf("unknown cluster %q", name)
}

// discoverClustersNonBlocking returns the spokes whose names are already
// known — from the name cache, else the URL-derived fallback — without ever
// touching the network, and warms the cache in the background for next time.
//
// PERF-2026-09-10: this is what GET /api/events/stream uses. That handler
// used to call discoverClusters synchronously before writing its first SSE
// byte, so opening the event stream cost a live /api/cluster round trip per
// spoke — up to 5s of dead air on every connect AND every reconnect, which
// is what made the stream feel slow to open even though events themselves
// were fine once flowing.
//
// Using the URL-derived name when the cache is cold is safe here in a way
// it would not be for the proxy's resolveClusterURL: the name is used to
// label a spoke's connection state and to tag events that arrive untagged,
// and a spoke tags its own events itself (see RunMultiStream's contract).
// A first connect on a cold cache may therefore briefly label a spoke by
// its hostname-derived name; the background warm corrects it for every
// subsequent connect.
func discoverClustersNonBlocking(ctx context.Context, envsJSON json.RawMessage, localURL, token string) []ClusterInfo {
	envs := parseEnvironments(envsJSON)
	selfURLs := append([]string{localURL}, localDashboardURLsFromEnvironments(envs)...)
	spokeURLs := extractSpokeURLs(envs, selfURLs)
	if len(spokeURLs) == 0 {
		return nil
	}

	clusters := make([]ClusterInfo, 0, len(spokeURLs))
	seen := make(map[string]bool)
	for _, su := range spokeURLs {
		name, cached := spokeNameCache.get(su)
		if !cached || name == "" {
			name = ClusterNameFromURL(su)
			// Warm it for the next connect. Detached from ctx on purpose:
			// this request is about to start streaming and may outlive or
			// undercut the fetch either way.
			fanoutBackgroundWG.Add(1)
			go func() {
				defer fanoutBackgroundWG.Done()
				cachedSpokeClusterName(context.Background(), su, token)
			}()
		}
		if seen[name] {
			continue
		}
		seen[name] = true
		clusters = append(clusters, ClusterInfo{URL: su, Name: name})
	}
	return clusters
}
