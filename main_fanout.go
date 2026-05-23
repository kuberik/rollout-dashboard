package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const sourceDashboardAnnotation = "rollout-dashboard.kuberik.com/source-dashboard"

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
// If the hostname starts with "kuberik.", returns the next segment.
// Falls back to the full hostname.
func ClusterNameFromURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	host := u.Hostname()
	if strings.HasPrefix(host, "kuberik.") {
		rest := strings.TrimPrefix(host, "kuberik.")
		parts := strings.SplitN(rest, ".", 2)
		if len(parts) > 0 && parts[0] != "" {
			return parts[0]
		}
	}
	return host
}

// extractSpokeURLs finds unique base URLs from environment environmentUrl values that differ from localURL.
func extractSpokeURLs(environmentsJSON json.RawMessage, localURL string) []string {
	if environmentsJSON == nil {
		return nil
	}
	var envList struct {
		Items []struct {
			Status struct {
				EnvironmentInfos []struct {
					EnvironmentURL string `json:"environmentUrl"`
				} `json:"environmentInfos"`
			} `json:"status"`
		} `json:"items"`
	}
	if err := json.Unmarshal(environmentsJSON, &envList); err != nil {
		return nil
	}
	seen := make(map[string]bool)
	localBase := dashboardBaseURL(localURL)
	var result []string
	for _, env := range envList.Items {
		for _, info := range env.Status.EnvironmentInfos {
			if info.EnvironmentURL == "" {
				continue
			}
			base := dashboardBaseURL(info.EnvironmentURL)
			if base == "" || seen[base] {
				continue
			}
			seen[base] = true
			if base != localBase {
				result = append(result, base)
			}
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
	c := &http.Client{Timeout: 10 * time.Second}
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
	c := &http.Client{Timeout: 5 * time.Second}
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

// proxyToSpoke forwards a GET request to a remote dashboard and streams the response back.
func proxyToSpoke(ctx context.Context, spokeURL, path, token string) (json.RawMessage, int, error) {
	reqURL := spokeURL + path
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	c := &http.Client{Timeout: 10 * time.Second}
	resp, err := c.Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, err
	}
	defer resp.Body.Close()
	var raw json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, resp.StatusCode, fmt.Errorf("decode spoke response: %w", err)
	}
	return raw, resp.StatusCode, nil
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

	// Discover spokes from local environments.
	spokeURLs := extractSpokeURLs(localData["environments"], localURL)
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

	for _, r := range results {
		if r.spoke.err != nil {
			clusterErrors = append(clusterErrors, ClusterError{
				URL:   r.spoke.url,
				Name:  r.name,
				Error: r.spoke.err.Error(),
			})
			continue
		}
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
