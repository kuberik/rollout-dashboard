package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
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

// annotateItemsWithSource adds the sourceDashboardAnnotation to every item's metadata.annotations.
func annotateItemsWithSource(listJSON json.RawMessage, sourceURL string) json.RawMessage {
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

// fetchSpoke calls /api/rollouts on a remote dashboard and returns the raw JSON fields.
func fetchSpoke(ctx context.Context, spokeURL, token string) (map[string]json.RawMessage, error) {
	reqURL := spokeURL + "/api/rollouts"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set(fanoutHeader, "1")
	c := &http.Client{Transport: fanoutTransport, Timeout: 10 * time.Second}
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
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

// fetchSpokeClusterName calls /api/cluster on a spoke and returns the cluster name.
// Returns ClusterNameFromURL(spokeURL) on failure.
func fetchSpokeClusterName(ctx context.Context, spokeURL, token string) string {
	reqURL := spokeURL + "/api/cluster"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return ClusterNameFromURL(spokeURL)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set(fanoutHeader, "1")
	c := &http.Client{Transport: fanoutTransport, Timeout: 5 * time.Second}
	resp, err := c.Do(req)
	if err != nil {
		return ClusterNameFromURL(spokeURL)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ClusterNameFromURL(spokeURL)
	}
	var info ClusterInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return ClusterNameFromURL(spokeURL)
	}
	if info.Name != "" {
		return info.Name
	}
	return ClusterNameFromURL(spokeURL)
}

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
	mergedKeys := []string{"rollouts", "environments", "kustomizations", "kruiseRollouts"}
	for _, k := range mergedKeys {
		if v, ok := localData[k]; ok && len(v) > 0 {
			localData[k] = annotateItemsWithSource(v, localURL)
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

	// Fan out in parallel: for each spoke, fetch rollouts + cluster name simultaneously.
	type result struct {
		spoke spokeResult
		name  string
	}
	results := make([]result, len(spokeURLs))
	var wg sync.WaitGroup
	for i, su := range spokeURLs {
		wg.Add(1)
		go func(idx int, spokeURL string) {
			defer wg.Done()
			fetchCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
			defer cancel()

			// Fetch cluster name and rollouts in parallel.
			nameCh := make(chan string, 1)
			go func() {
				nameCh <- fetchSpokeClusterName(fetchCtx, spokeURL, token)
			}()

			data, err := fetchSpoke(fetchCtx, spokeURL, token)
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
				annotated := annotateItemsWithSource(v, r.spoke.url)
				merged[k] = mergeItemLists(merged[k], annotated)
			}
		}
	}
	return merged, clusters, clusterErrors
}
