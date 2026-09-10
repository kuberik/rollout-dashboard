package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// fanoutTransport is the shared transport for hub→spoke HTTP calls.
// Honors INSECURE_SKIP_TLS_VERIFY=true (dev only — for self-signed certs across kind clusters).
var fanoutTransport = func() http.RoundTripper {
	tr := &http.Transport{}
	if os.Getenv("INSECURE_SKIP_TLS_VERIFY") == "true" {
		tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	return tr
}()

const sourceDashboardAnnotation = "rollout-dashboard.kuberik.com/source-dashboard"

// sourceClusterAnnotation records the cluster NAME an item came from (vs. the URL
// in sourceDashboardAnnotation), so the frontend can build name-based routes.
const sourceClusterAnnotation = "rollout-dashboard.kuberik.com/source-cluster"

// fanoutHeader marks a request as already being a fan-out leg — the receiver
// must NOT fan out again, otherwise hub↔spoke topologies create an infinite
// loop that bottoms out only on per-request timeouts (and meanwhile duplicates
// every item N times before bailing).
const fanoutHeader = "X-Kuberik-Fanout"

// ClusterInfo describes a discovered kuberik dashboard instance.
type ClusterInfo struct {
	URL  string `json:"url"`
	Name string `json:"name"`
}

// ClusterError describes a dashboard instance that could not be reached.
type ClusterError struct {
	URL   string `json:"url"`
	Name  string `json:"name"`
	Error string `json:"error"`
}

// dashboardBaseURL extracts scheme+host from a URL string.
func dashboardBaseURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

// ClusterNameFromURL derives a short cluster name from a dashboard URL.
// If the hostname is "kuberik.<name>.<rest>" and <name> is non-numeric, returns <name>.
// Otherwise returns the full hostname — IP-based URLs (e.g. nip.io, sslip.io)
// have no meaningful short form so we keep the full host instead of producing
// nonsense like "192" from "kuberik.192.168.1.102.nip.io".
func ClusterNameFromURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	host := u.Hostname()
	if strings.HasPrefix(host, "kuberik.") {
		rest := strings.TrimPrefix(host, "kuberik.")
		parts := strings.SplitN(rest, ".", 2)
		if len(parts) > 0 && parts[0] != "" && !isNumeric(parts[0]) {
			return parts[0]
		}
	}
	return host
}

func isNumeric(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// parsedEnvironments is the minimal projection of an EnvironmentList needed by fan-out.
type parsedEnvironments struct {
	Items []struct {
		Spec struct {
			Environment string `json:"environment"`
		} `json:"spec"`
		Status struct {
			EnvironmentInfos []struct {
				Environment    string `json:"environment"`
				EnvironmentURL string `json:"environmentUrl"`
			} `json:"environmentInfos"`
		} `json:"status"`
	} `json:"items"`
}

func parseEnvironments(environmentsJSON json.RawMessage) *parsedEnvironments {
	if environmentsJSON == nil {
		return nil
	}
	var envList parsedEnvironments
	if err := json.Unmarshal(environmentsJSON, &envList); err != nil {
		return nil
	}
	return &envList
}

// localDashboardURLsFromEnvironments returns base URLs that correspond to THIS
// dashboard, derived from local Environment objects. The entry in
// status.environmentInfos where info.environment == spec.environment is the
// environment that lives on this cluster, so its environmentUrl points to us.
// Robust zero-config self-identification — works behind reverse proxies that
// don't forward Host headers.
func localDashboardURLsFromEnvironments(envs *parsedEnvironments) []string {
	if envs == nil {
		return nil
	}
	seen := make(map[string]bool)
	var result []string
	for _, env := range envs.Items {
		for _, info := range env.Status.EnvironmentInfos {
			if info.Environment != env.Spec.Environment || info.EnvironmentURL == "" {
				continue
			}
			base := dashboardBaseURL(info.EnvironmentURL)
			if base == "" || seen[base] {
				continue
			}
			seen[base] = true
			result = append(result, base)
		}
	}
	return result
}

// extractSpokeURLs finds unique base URLs from environment environmentUrl values
// that are NOT in the provided set of self URLs.
func extractSpokeURLs(envs *parsedEnvironments, selfURLs []string) []string {
	if envs == nil {
		return nil
	}
	selfSet := make(map[string]bool)
	for _, u := range selfURLs {
		if b := dashboardBaseURL(u); b != "" {
			selfSet[b] = true
		}
	}
	seen := make(map[string]bool)
	var result []string
	for _, env := range envs.Items {
		for _, info := range env.Status.EnvironmentInfos {
			if info.EnvironmentURL == "" {
				continue
			}
			base := dashboardBaseURL(info.EnvironmentURL)
			if base == "" || seen[base] || selfSet[base] {
				continue
			}
			seen[base] = true
			result = append(result, base)
		}
	}
	return result
}

// annotateItemsWithSource stamps every item with the source dashboard URL and
// cluster name so the frontend knows which cluster each merged item came from.
func annotateItemsWithSource(listJSON json.RawMessage, sourceURL, sourceName string) json.RawMessage {
	if listJSON == nil {
		return nil
	}
	var list struct {
		Items []map[string]interface{} `json:"items"`
	}
	if err := json.Unmarshal(listJSON, &list); err != nil {
		return listJSON
	}
	for i := range list.Items {
		item := list.Items[i]
		metadata, _ := item["metadata"].(map[string]interface{})
		if metadata == nil {
			metadata = make(map[string]interface{})
			item["metadata"] = metadata
		}
		annotations, _ := metadata["annotations"].(map[string]interface{})
		if annotations == nil {
			annotations = make(map[string]interface{})
			metadata["annotations"] = annotations
		}
		annotations[sourceDashboardAnnotation] = sourceURL
		annotations[sourceClusterAnnotation] = sourceName
	}
	result, err := json.Marshal(list)
	if err != nil {
		return listJSON
	}
	return result
}

// mergeItemLists concatenates two JSON-encoded Kubernetes list objects ({items: [...]}).
func mergeItemLists(a, b json.RawMessage) json.RawMessage {
	if len(a) == 0 {
		return b
	}
	if len(b) == 0 {
		return a
	}
	var la, lb struct {
		Items []json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(a, &la); err != nil {
		return a
	}
	if err := json.Unmarshal(b, &lb); err != nil {
		return a
	}
	merged := append(la.Items, lb.Items...)
	if merged == nil {
		merged = []json.RawMessage{}
	}
	result, err := json.Marshal(map[string]interface{}{"items": merged})
	if err != nil {
		return a
	}
	return result
}

type spokeResult struct {
	url  string
	data map[string]json.RawMessage
	err  error
}

// spokeFetchTimeout bounds one hub→spoke /api/rollouts call.
//
// PERF-2026-09-10: was 10s. Ten seconds is not a timeout for a dashboard's
// blocking render path, it is an outage — and it was reached on every single
// request while one spoke was unroutable from inside the cluster. With the
// breaker in front (main_fanout_breaker.go) an unreachable spoke now costs
// this once per cooldown rather than once per request, and a spoke that
// genuinely needs more than 2s to answer is one the SWR cache should be
// refreshing in the background anyway, not one a user should wait for.
const spokeFetchTimeout = 2 * time.Second

// spokeNameTimeout bounds one hub→spoke /api/cluster call. Same reasoning;
// this one only fetches a short string.
const spokeNameTimeout = 2 * time.Second

// fetchSpoke calls /api/rollouts on a remote dashboard and returns the raw JSON fields.
// Gated by the per-spoke circuit breaker: a spoke that has been failing is
// refused instantly instead of costing another spokeFetchTimeout.
func fetchSpoke(ctx context.Context, spokeURL, token string) (map[string]json.RawMessage, error) {
	if ok, brErr := breakers.allow(spokeURL); !ok {
		return nil, brErr
	}
	data, err := doFetchSpoke(ctx, spokeURL, token)
	recordSpokeOutcome(spokeURL, err)
	if err != nil {
		return nil, err
	}
	return data, nil
}

func doFetchSpoke(ctx context.Context, spokeURL, token string) (map[string]json.RawMessage, error) {
	reqURL := spokeURL + "/api/rollouts"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set(fanoutHeader, "1")
	c := &http.Client{Transport: fanoutTransport, Timeout: spokeFetchTimeout}
	resp, err := c.Do(req)
	if err != nil {
		return nil, &spokeTransportError{err: err}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var result map[string]json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	return result, nil
}

// fetchSpokeClusterNameErr calls /api/cluster on a spoke and returns its
// cluster name, reporting WHY it could not be read rather than quietly
// substituting the URL-derived fallback. The caching layer needs that
// distinction: caching a fallback name as if it were the real answer would
// pin a spoke's label to its hostname for a full spokeNameTTL after one
// transient blip. cachedSpokeClusterName applies the fallback instead.
func fetchSpokeClusterNameErr(ctx context.Context, spokeURL, token string) (string, error) {
	// Reachability is shared state: if /api/rollouts just timed out against
	// this host, /api/cluster is not going to answer either, and paying a
	// second timeout to find that out is exactly the cost this breaker
	// exists to remove.
	if ok, brErr := breakers.allow(spokeURL); !ok {
		return "", brErr
	}
	name, err := doFetchSpokeClusterName(ctx, spokeURL, token)
	recordSpokeOutcome(spokeURL, err)
	if err != nil {
		return "", err
	}
	return name, nil
}

// recordSpokeOutcome feeds one call's result to the breaker.
//
// Only TRANSPORT failures count against a spoke — a timeout, a refused
// connection, a DNS miss. An HTTP response of any status, or a body that
// fails to decode, means the host answered: it is alive, and the problem is
// this caller's (an unauthenticated leg gets the SSO login page back, which
// is a 200 full of HTML that decodes to nothing). Counting those would let
// one tokenless request open a process-wide breaker and cut every
// authenticated user off from a perfectly healthy spoke — the breaker is
// shared precisely because reachability is not per-user, so it must only
// ever record things that are not per-user either.
func recordSpokeOutcome(spokeURL string, err error) {
	var terr *spokeTransportError
	switch {
	case err == nil:
		breakers.success(spokeURL)
	case errors.As(err, &terr):
		breakers.failure(spokeURL, err)
	default:
		// Reached the host; leave the breaker alone.
	}
}

func doFetchSpokeClusterName(ctx context.Context, spokeURL, token string) (string, error) {
	reqURL := spokeURL + "/api/cluster"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return "", err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set(fanoutHeader, "1")
	c := &http.Client{Transport: fanoutTransport, Timeout: spokeNameTimeout}
	resp, err := c.Do(req)
	if err != nil {
		return "", &spokeTransportError{err: err}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var info ClusterInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return "", fmt.Errorf("decode: %w", err)
	}
	return info.Name, nil
}

// mergedKeys are the response keys that fan-out merges across clusters. Each is a
// Kubernetes list object whose items get stamped with the source dashboard URL and
// cluster name, so a merged item stays attributable to the cluster it came from.
// rolloutDependencies is here for the same reason rollouts is: a consumer, its
// provider and their dependency always live in one namespace on one cluster, and
// flattening two clusters' dependencies into an unattributed list makes them
// indistinguishable.
var mergedKeys = []string{"rollouts", "environments", "kustomizations", "kruiseRollouts", "rolloutDependencies"}

// fanOutRollouts fans out GET /api/rollouts to all discovered spoke dashboards
// and merges the results with localData. localData values must be json.RawMessage.
// Returns merged data, cluster list, and per-cluster errors.
func fanOutRollouts(
	ctx context.Context,
	localData map[string]json.RawMessage,
	localURL string,
	token string,
) (map[string]json.RawMessage, []ClusterInfo, []ClusterError) {
	// Annotate local rollouts before merging.
	localName := os.Getenv("CLUSTER_NAME")
	if localName == "" {
		localName = ClusterNameFromURL(localURL)
	}
	for _, k := range mergedKeys {
		if v, ok := localData[k]; ok && len(v) > 0 {
			localData[k] = annotateItemsWithSource(v, localURL, localName)
		}
	}

	// Build the set of self URLs from three sources:
	// 1. The localURL (env var DASHBOARD_URL, or reconstructed from request)
	// 2. Auto-detected from local environments — for each local Environment,
	//    the entry matching spec.environment is the env that lives on this
	//    cluster, so its environmentUrl points back to us. Zero-config, robust
	//    even behind reverse proxies that don't forward Host headers.
	envs := parseEnvironments(localData["environments"])
	selfURLs := append([]string{localURL}, localDashboardURLsFromEnvironments(envs)...)

	// Discover spokes — base URLs from environmentUrl that aren't self.
	spokeURLs := extractSpokeURLs(envs, selfURLs)
	if len(spokeURLs) == 0 {
		return localData, nil, nil
	}

	// Fan out in parallel: for each spoke, resolve rollouts + cluster name
	// simultaneously.
	//
	// PERF-2026-09-10: both go through the stale-while-revalidate caches in
	// main_fanout_cache.go rather than straight to HTTP, so this loop is
	// normally pure memory reads. A spoke only costs this request anything
	// when nothing is cached for it yet, and then only spokeColdGrace — see
	// that file for the freshness contract and for why the payload cache is
	// keyed per identity while the name cache is not.
	type result struct {
		spoke spokeResult
		name  string
	}
	results := make([]result, len(spokeURLs))
	identity := identityKey(token)
	var wg sync.WaitGroup
	for i, su := range spokeURLs {
		wg.Add(1)
		go func(idx int, spokeURL string) {
			defer wg.Done()

			nameCh := make(chan string, 1)
			go func() {
				nameCh <- cachedSpokeClusterName(ctx, spokeURL, token)
			}()

			data, err := spokeDataCache.load(ctx, identity+"|"+spokeURL,
				func(fctx context.Context) (map[string]json.RawMessage, error) {
					return fetchSpoke(fctx, spokeURL, token)
				})
			name := <-nameCh

			results[idx] = result{
				spoke: spokeResult{url: spokeURL, data: data, err: err},
				name:  name,
			}
		}(i, su)
	}
	wg.Wait()

	merged := localData
	var clusters []ClusterInfo
	var clusterErrors []ClusterError
	seenNames := make(map[string]bool)

	for _, r := range results {
		// A cold-start miss is not a failure — the fetch is still running
		// and will populate the cache within a second or two, so the next
		// request (the frontend's own safety-net poll at worst) shows this
		// cluster. Reporting it as a clusterError would put a red banner in
		// front of the user for a spoke that is perfectly healthy and
		// merely slower than the grace window. Real failures — a refused
		// connection, an open breaker, an HTTP error — still report below.
		if errors.Is(r.spoke.err, errSpokeColdTimeout) {
			continue
		}
		if r.spoke.err != nil {
			clusterErrors = append(clusterErrors, ClusterError{
				URL:   r.spoke.url,
				Name:  r.name,
				Error: r.spoke.err.Error(),
			})
			continue
		}
		if seenNames[r.name] {
			continue
		}
		seenNames[r.name] = true
		clusters = append(clusters, ClusterInfo{URL: r.spoke.url, Name: r.name})
		// Annotate and merge each key.
		for _, k := range mergedKeys {
			if v, ok := r.spoke.data[k]; ok && len(v) > 0 {
				annotated := annotateItemsWithSource(v, r.spoke.url, r.name)
				merged[k] = mergeItemLists(merged[k], annotated)
			}
		}
	}
	// Warm the name→url registry so the proxy can resolve ?cluster=<name> without
	// re-discovering (list calls happen on every page via the Navbar).
	registry.put(clusters)
	return merged, clusters, clusterErrors
}

// cachedSpokeClusterName resolves a spoke's cluster name through the shared
// name cache, falling back to the URL-derived name — the same fallback
// fetchSpokeClusterName has always used when a spoke could not be asked.
// Names are stable and not user-specific, so this cache is keyed by URL
// alone and shared across every caller.
func cachedSpokeClusterName(ctx context.Context, spokeURL, token string) string {
	name, err := spokeNameCache.load(ctx, spokeURL, func(fctx context.Context) (string, error) {
		return fetchSpokeClusterNameErr(fctx, spokeURL, token)
	})
	if err != nil || name == "" {
		return ClusterNameFromURL(spokeURL)
	}
	return name
}
