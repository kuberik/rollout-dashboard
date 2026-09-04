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

	names := make([]string, len(spokeURLs))
	var wg sync.WaitGroup
	for i, su := range spokeURLs {
		wg.Add(1)
		go func(idx int, spokeURL string) {
			defer wg.Done()
			fctx, cancel := context.WithTimeout(ctx, 12*time.Second)
			defer cancel()
			names[idx] = fetchSpokeClusterName(fctx, spokeURL, token)
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
