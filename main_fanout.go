package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net"
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
//
// Stale is the field the UI reads to tell "no data from this cluster" (false,
// the cluster's items are absent) from "the items shown for this cluster are
// its LAST KNOWN state, not current" (true: the spoke stopped answering, the
// hub is still serving its cached payload, LastSeen is when that payload was
// last fetched successfully).
//
// Reason says WHY, as a typed value the UI branches on (never the Error text):
// "slow" is a reachable cluster whose answer did not arrive inside the wait,
// so the cached payload was served; "unreachable" is a real fetch error or an
// open breaker. Absent (older hubs) reads as unreachable.
type ClusterError struct {
	URL      string     `json:"url"`
	Name     string     `json:"name"`
	Error    string     `json:"error"`
	Stale    bool       `json:"stale,omitempty"`
	LastSeen *time.Time `json:"lastSeen,omitempty"`
	Reason   string     `json:"reason,omitempty"`
	// Kind says what kind of read failure this was, typed so no screen prints
	// the raw Error text: "timeout" (no answer in time), "unreachable" (could
	// not connect), "rejected" (the cluster answered with an HTTP error;
	// Status carries the code) or "bad_answer" (it answered with something
	// that is not a dashboard response, e.g. a login page). Absent on older
	// hubs. Error stays for compatibility.
	Kind   string `json:"kind,omitempty"`
	Status int    `json:"status,omitempty"`
	// Detail says what was wrong with a bad_answer: "not_json" (the body is
	// not JSON, e.g. a login page) or "wrong_shape" (JSON, but not an object
	// of lists). Absent for other kinds.
	Detail string `json:"detail,omitempty"`
}

// ClusterError.Detail values.
const (
	clusterDetailNotJSON    = "not_json"
	clusterDetailWrongShape = "wrong_shape"
)

// clusterErrorDetail is the typed detail of a bad_answer, else "".
func clusterErrorDetail(err error) string {
	var de *spokeDecodeError
	if !errors.As(err, &de) {
		return ""
	}
	var ute *json.UnmarshalTypeError
	if errors.As(de.err, &ute) {
		return clusterDetailWrongShape
	}
	return clusterDetailNotJSON
}

// ClusterError.Kind values.
const (
	clusterKindTimeout     = "timeout"
	clusterKindUnreachable = "unreachable"
	clusterKindRejected    = "rejected"
	clusterKindBadAnswer   = "bad_answer"
)

// spokeStatusError is a spoke's non-200 answer. Message text is unchanged
// ("HTTP 403") so the legacy error field reads as before.
type spokeStatusError struct{ status int }

func (e *spokeStatusError) Error() string { return fmt.Sprintf("HTTP %d", e.status) }

// spokeDecodeError is a 200 whose body is not the expected JSON.
type spokeDecodeError struct{ err error }

func (e *spokeDecodeError) Error() string { return "decode: " + e.err.Error() }
func (e *spokeDecodeError) Unwrap() error { return e.err }

// clusterErrorKind classifies a spoke failure into ClusterError.Kind and, for
// rejected, the HTTP status. Looks through the breaker's wrapper to the real
// last error. Unknown errors read as unreachable.
func clusterErrorKind(err error) (string, int) {
	var se *spokeStatusError
	var de *spokeDecodeError
	var ne net.Error
	switch {
	case errors.Is(err, errSpokeStaleTimeout), errors.Is(err, context.DeadlineExceeded):
		return clusterKindTimeout, 0
	case errors.As(err, &se):
		return clusterKindRejected, se.status
	case errors.As(err, &de):
		return clusterKindBadAnswer, 0
	case errors.As(err, &ne) && ne.Timeout():
		return clusterKindTimeout, 0
	}
	return clusterKindUnreachable, 0
}

// ClusterError.Reason values.
const (
	clusterReasonSlow        = "slow"
	clusterReasonUnreachable = "unreachable"
)

// clusterErrorReason classifies a spoke failure. Only the stale-wait timeout
// (errSpokeStaleTimeout, set by the cache itself) is "slow"; anything else
// the fetch layer reported, including an open breaker, is "unreachable".
func clusterErrorReason(err error) string {
	if errors.Is(err, errSpokeStaleTimeout) {
		return clusterReasonSlow
	}
	return clusterReasonUnreachable
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

// tierAliases maps the nine environment names the environment-controller
// accepts onto their canonical tier. Aliases of one tier are the same
// environment. Keep in sync with environment-controller internal/wave/tier.go.
var tierAliases = map[string]string{
	"dev": "dev", "development": "dev",
	"test": "test", "qa": "test",
	"staging": "staging", "stage": "staging", "preprod": "staging",
	"prod": "prod", "production": "prod",
}

// canonicalTier returns the canonical tier of a known environment name, and
// the name unchanged when it is not one of the nine.
func canonicalTier(name string) string {
	if t, ok := tierAliases[name]; ok {
		return t
	}
	return name
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
			if canonicalTier(info.Environment) != canonicalTier(env.Spec.Environment) || info.EnvironmentURL == "" {
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

// sourceAnnotations is the pair every item (a list item or a single rollout)
// carries so the frontend knows which dashboard and cluster it came from.
func sourceAnnotations(sourceURL, sourceName string) map[string]string {
	return map[string]string{sourceDashboardAnnotation: sourceURL, sourceClusterAnnotation: sourceName}
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
		for k, v := range sourceAnnotations(sourceURL, sourceName) {
			annotations[k] = v
		}
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
	return fetchSpokePath(ctx, spokeURL, rolloutsFanout.path, token)
}

// fetchSpokePath is fetchSpoke for any fanned-in list path (fanoutSpec.path).
// The breaker is per spoke, not per path: reachability is a property of the
// host, so a timeout on one path refuses every path to that host.
func fetchSpokePath(ctx context.Context, spokeURL, path, token string) (map[string]json.RawMessage, error) {
	if ok, brErr := breakers.allow(spokeURL); !ok {
		return nil, brErr
	}
	data, err := doFetchSpoke(ctx, spokeURL, path, token)
	recordSpokeOutcome(spokeURL, err)
	if err != nil {
		return nil, err
	}
	return data, nil
}

func doFetchSpoke(ctx context.Context, spokeURL, path, token string) (map[string]json.RawMessage, error) {
	reqURL := spokeURL + path
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
		return nil, &spokeStatusError{status: resp.StatusCode}
	}
	var result map[string]json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, &spokeDecodeError{err: err}
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
		// The host answered (HTTP 401, SSO HTML, decode failure). That
		// is reachability, so close the breaker. Leaving it alone used
		// to leak probing=true after a half-open probe got a non-
		// transport error, and allow() then refused the spoke forever
		// with a negative "circuit open for -XhYm" (SRE-753).
		breakers.success(spokeURL)
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
		return "", &spokeStatusError{status: resp.StatusCode}
	}
	var info ClusterInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return "", &spokeDecodeError{err: err}
	}
	return info.Name, nil
}

// mergedKeys are the response keys that fan-out merges across clusters. Each is a
// Kubernetes list object whose items get stamped with the source dashboard URL and
// cluster name, so a merged item stays attributable to the cluster it came from.
// rolloutDependencies is here for the same reason rollouts is: a consumer, its
// provider and their dependency always live in one namespace on one cluster, and
// flattening two clusters' dependencies into an unattributed list makes them
// indistinguishable. releaseSources/releaseSlices (release-controller's
// catalogue) are stamped the same way: the dashboard keys a source's merged
// catalogue by (cluster, namespace, source), so two clusters' same-named
// sources must stay separate.
var mergedKeys = []string{"rollouts", "environments", "kustomizations", "kruiseRollouts", "rolloutDependencies", "releaseSources", "releaseSlices"}

// fanoutSpec describes one hub fan-in list: the path every spoke is asked
// for, the SWR cache its payloads live in, and the response keys that are
// Kubernetes-style lists ({items: [...]}) to annotate and merge.
//
// Each path gets its OWN cache: the cache key is identity|url, so two paths
// sharing one cache would overwrite each other's payloads for the same spoke.
// cache is a func so tests that swap the package-level cache var
// (swapFanoutState) are seen here too.
type fanoutSpec struct {
	path       string
	cache      func() *swrCache[map[string]json.RawMessage]
	mergedKeys []string
}

// rolloutsFanout is GET /api/rollouts' fan-in.
var rolloutsFanout = fanoutSpec{
	path:       "/api/rollouts",
	cache:      func() *swrCache[map[string]json.RawMessage] { return spokeDataCache },
	mergedKeys: mergedKeys,
}

// fanOutRollouts fans out GET /api/rollouts to all discovered spoke dashboards
// and merges the results with localData. localData values must be json.RawMessage.
// Returns merged data, cluster list, and per-cluster errors; use
// fanOutRolloutsWithPartials when the spokes' partialReads are needed too.
func fanOutRollouts(
	ctx context.Context,
	localData map[string]json.RawMessage,
	localURL string,
	token string,
) (map[string]json.RawMessage, []ClusterInfo, []ClusterError) {
	merged, clusters, clusterErrors, _ := fanOutRolloutsWithPartials(ctx, localData, localURL, token)
	return merged, clusters, clusterErrors
}

// fanOutRolloutsWithPartials is fanOutRollouts plus every answering spoke's own
// partialReads entries, qualified "<cluster>/<key>".
func fanOutRolloutsWithPartials(
	ctx context.Context,
	localData map[string]json.RawMessage,
	localURL string,
	token string,
) (map[string]json.RawMessage, []ClusterInfo, []ClusterError, []string) {
	return fanOut(ctx, rolloutsFanout, localData, localData["environments"], localURL, token)
}

// clusterNameForURL is the name local items are stamped with
// (sourceClusterAnnotation): CLUSTER_NAME, else derived from localURL.
// localClusterName (main_registry.go) is the same for a request.
func clusterNameForURL(localURL string) string {
	if name := os.Getenv("CLUSTER_NAME"); name != "" {
		return name
	}
	return ClusterNameFromURL(localURL)
}

// fanOut fans spec.path out to every spoke discovered from envsJSON (the
// caller's visibility-trimmed local Environments) and merges spec.mergedKeys
// into localData. Spoke discovery is separate from localData because not
// every fanned-in list carries environments itself (/api/health-checks does
// not).
//
// The fourth return is every answering spoke's own "partialReads" entries,
// qualified as "<cluster>/<entry>", so a spoke's failed read reaches the
// hub's caller instead of being merged as a silently-short list. Callers
// whose contract does not carry spoke partial reads drop it.
func fanOut(
	ctx context.Context,
	spec fanoutSpec,
	localData map[string]json.RawMessage,
	envsJSON json.RawMessage,
	localURL string,
	token string,
) (map[string]json.RawMessage, []ClusterInfo, []ClusterError, []string) {
	// Annotate local items before merging.
	localName := clusterNameForURL(localURL)
	for _, k := range spec.mergedKeys {
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
	envs := parseEnvironments(envsJSON)
	selfURLs := append([]string{localURL}, localDashboardURLsFromEnvironments(envs)...)

	// Discover spokes — base URLs from environmentUrl that aren't self.
	spokeURLs := extractSpokeURLs(envs, selfURLs)
	if len(spokeURLs) == 0 {
		return localData, nil, nil, nil
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
		meta  swrMeta
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

			data, meta, err := spec.cache().loadMeta(ctx, identity+"|"+spokeURL,
				func(fctx context.Context) (map[string]json.RawMessage, error) {
					return fetchSpokePath(fctx, spokeURL, spec.path, token)
				})
			name := <-nameCh

			results[idx] = result{
				spoke: spokeResult{url: spokeURL, data: data, err: err},
				name:  name,
				meta:  meta,
			}
		}(i, su)
	}
	wg.Wait()

	merged := localData
	var clusters []ClusterInfo
	var clusterErrors []ClusterError
	var spokePartialReads []string
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
			kind, status := clusterErrorKind(r.spoke.err)
			clusterErrors = append(clusterErrors, ClusterError{
				URL:    r.spoke.url,
				Name:   r.name,
				Error:  r.spoke.err.Error(),
				Reason: clusterErrorReason(r.spoke.err),
				Kind:   kind,
				Status: status,
				Detail: clusterErrorDetail(r.spoke.err),
			})
			continue
		}
		if seenNames[r.name] {
			continue
		}
		seenNames[r.name] = true
		clusters = append(clusters, ClusterInfo{URL: r.spoke.url, Name: r.name})
		if r.meta.StaleErr != nil {
			// Serve the last-known data (better than a hole) but say so.
			seen := r.meta.LastOK
			kind, status := clusterErrorKind(r.meta.StaleErr)
			clusterErrors = append(clusterErrors, ClusterError{
				URL:      r.spoke.url,
				Name:     r.name,
				Error:    r.meta.StaleErr.Error(),
				Stale:    true,
				LastSeen: &seen,
				Reason:   clusterErrorReason(r.meta.StaleErr),
				Kind:     kind,
				Status:   status,
				Detail:   clusterErrorDetail(r.meta.StaleErr),
			})
		}
		// Annotate and merge each key.
		for _, k := range spec.mergedKeys {
			if v, ok := r.spoke.data[k]; ok && len(v) > 0 {
				annotated := annotateItemsWithSource(v, r.spoke.url, r.name)
				merged[k] = mergeItemLists(merged[k], annotated)
			}
		}
		if raw, ok := r.spoke.data["partialReads"]; ok && len(raw) > 0 {
			var entries []string
			if err := json.Unmarshal(raw, &entries); err == nil {
				for _, e := range entries {
					spokePartialReads = append(spokePartialReads, r.name+"/"+e)
				}
			}
		}
	}
	// Warm the name→url registry so the proxy can resolve ?cluster=<name> without
	// re-discovering (list calls happen on every page via the Navbar).
	registry.put(clusters)
	return merged, clusters, clusterErrors, spokePartialReads
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
