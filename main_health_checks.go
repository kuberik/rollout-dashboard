package main

import (
	"encoding/json"
	"log"
	"net/http"

	envv1alpha1 "github.com/kuberik/environment-controller/api/v1alpha1"
	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	"github.com/kuberik/rollout-dashboard/pkg/auth"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"

	"github.com/gin-gonic/gin"
)

// healthChecksFanout is GET /api/health-checks' hub fan-in: its own spoke
// path and SWR cache, one merged list.
var healthChecksFanout = fanoutSpec{
	path:       "/api/health-checks",
	cache:      func() *swrCache[map[string]json.RawMessage] { return spokeHealthCheckCache },
	mergedKeys: []string{"rolloutHealthChecks"},
}

// handleFleetHealthChecks serves GET /api/health-checks: for every Rollout
// the caller may see that has a healthCheckSelector, exactly the HealthChecks
// GET /api/rollouts/:ns/:name/health-checks returns for it, across the hub
// and every spoke. Home reads this once instead of calling the per-rollout
// endpoint for each rollout.
//
// Response (hub):
//
//	{ "rolloutHealthChecks": { "items": [ { "metadata": {namespace, name,
//	    annotations: {source-dashboard, source-cluster}}, "healthChecks": [...] } ] },
//	  "clusters": [...], "clusterErrors": [...], "partialReads": ["<cluster>/<namespace>", ...] }
//
// clusters, clusterErrors and partialReads are omitted when empty. A rollout
// whose HealthCheck read failed in some namespace has NO item (unknown, not
// "no checks"); the namespace is named in partialReads instead. A fan-out leg
// (fanoutHeader) returns local data only, with unqualified namespaces in
// partialReads; the hub qualifies them with the spoke's cluster name.
//
// Kept off GET /api/rollouts on purpose: HealthCheck status is the noisiest
// kind, and folding it in would churn the rollouts ETag for every page.
func handleFleetHealthChecks(c *gin.Context) {
	k8sClient, ok := getK8sReadClient(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	isLeg := c.GetHeader(fanoutHeader) != ""

	rollouts, err := k8sClient.GetRolloutsAllNamespaces(ctx)
	if err != nil {
		log.Printf("Error fetching rollouts for health checks: %v", err)
		writeUpstreamError(c, "Failed to fetch health checks", err)
		return
	}

	// Environments only drive spoke discovery, so a leg never reads them,
	// and a failure only costs the fan-out (the local answer still stands),
	// as in visibleGitHubSources.
	var envs *envv1alpha1.EnvironmentList
	if !isLeg {
		envs, err = k8sClient.GetEnvironmentsAllNamespaces(ctx)
		if err != nil {
			log.Printf("Error fetching environments for health-check spoke discovery: %v", err)
			envs = nil
		}
	}

	// Per-user visibility, the same trim /api/rollouts applies: the read
	// client sees every namespace, the caller sees the ones they may list
	// rollouts in.
	nsSet := map[string]struct{}{}
	for _, r := range rollouts.Items {
		nsSet[r.Namespace] = struct{}{}
	}
	if envs != nil {
		for _, e := range envs.Items {
			nsSet[e.Namespace] = struct{}{}
		}
	}
	namespaces := make([]string, 0, len(nsSet))
	for ns := range nsSet {
		namespaces = append(namespaces, ns)
	}
	allowedNS, err := kubernetes.AllowedNamespaces(c, namespaces)
	if err != nil {
		log.Printf("Error checking namespace visibility: %v", err)
		writeUpstreamError(c, "Failed to check namespace visibility", err)
		return
	}
	rollouts.Items = kubernetes.FilterByNamespace(rollouts.Items, func(r rolloutv1alpha1.Rollout) string { return r.Namespace }, allowedNS)
	if envs != nil {
		envs.Items = kubernetes.FilterByNamespace(envs.Items, func(e envv1alpha1.Environment) string { return e.Namespace }, allowedNS)
	}

	items, failedNamespaces := k8sClient.RolloutHealthChecksFor(ctx, rollouts.Items)
	list := gin.H{"items": items}

	if isLeg {
		leg := gin.H{"rolloutHealthChecks": list}
		if len(failedNamespaces) > 0 {
			leg["partialReads"] = failedNamespaces
		}
		c.JSON(http.StatusOK, leg)
		return
	}

	localURL := localDashboardURL(c)
	token := auth.GetTokenFromContext(c)
	localData := map[string]json.RawMessage{"rolloutHealthChecks": marshalToRaw(list)}
	var envsJSON json.RawMessage
	if envs != nil {
		envsJSON = marshalToRaw(envs)
	}
	merged, clusters, clusterErrors, spokePartialReads := fanOut(ctx, healthChecksFanout, localData, envsJSON, localURL, token)

	var partialReads []string
	localName := clusterNameForURL(localURL)
	for _, ns := range failedNamespaces {
		partialReads = append(partialReads, localName+"/"+ns)
	}
	partialReads = append(partialReads, spokePartialReads...)

	response := gin.H{"rolloutHealthChecks": merged["rolloutHealthChecks"]}
	if len(clusters) > 0 {
		response["clusters"] = clusters
	}
	if len(clusterErrors) > 0 {
		response["clusterErrors"] = clusterErrors
	}
	if len(partialReads) > 0 {
		response["partialReads"] = partialReads
	}
	writeJSONWithETag(c, http.StatusOK, response)
}
