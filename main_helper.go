package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
)

// getK8sReadClient is the handler-side helper for the shared, long-lived read
// client (see pkg/kubernetes/context.go for the read/write split). Use this
// for every LIST/GET route. It never carries the caller's own RBAC — pair it
// with requireRolloutVisibility (main_visibility.go) for any namespaced,
// per-user-authenticated response.
//
// Returns a 503 (not a 500) while the informer cache is still doing its
// startup sync (kubernetes.ErrCacheWarming, see pkg/kubernetes/cache.go) —
// that's an expected, bounded, self-clearing state right after a fresh pod
// starts serving, not an error.
func getK8sReadClient(c *gin.Context) (*kubernetes.Client, bool) {
	k8sClient, err := kubernetes.GetReadClient(c)
	if err != nil {
		if errors.Is(err, kubernetes.ErrCacheWarming) {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "Kubernetes read cache is still warming up",
				"details": err.Error(),
			})
			return nil, false
		}
		log.Printf("Failed to get Kubernetes read client: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to initialize Kubernetes client",
			"details": err.Error(),
		})
		return nil, false
	}
	return k8sClient, true
}

// getK8sWriteClient is the handler-side helper for a per-request client
// authorized as the actual signed-in operator (their OIDC bearer token). Use
// this for every mutating route and every SelfSubjectAccessReview — never
// downgrade these to getK8sReadClient's shared service-account identity.
func getK8sWriteClient(c *gin.Context) (*kubernetes.Client, bool) {
	k8sClient, err := kubernetes.GetWriteClient(c)
	if err != nil {
		log.Printf("Failed to get Kubernetes write client: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to initialize Kubernetes client",
			"details": err.Error(),
		})
		return nil, false
	}
	return k8sClient, true
}

// localDashboardURL returns the external base URL of this dashboard.
// Prefers the DASHBOARD_URL env var (typically set from the kuberik-cluster-info ConfigMap)
// so that self-exclusion during multi-cluster fan-out works behind reverse proxies that
// don't forward Host headers. Falls back to reconstructing from request headers.
func localDashboardURL(c *gin.Context) string {
	if envURL := os.Getenv("DASHBOARD_URL"); envURL != "" {
		return envURL
	}
	scheme := "https"
	if proto := c.GetHeader("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	} else if c.Request.TLS == nil {
		scheme = "http"
	}
	host := c.GetHeader("X-Forwarded-Host")
	if host == "" {
		host = c.Request.Host
	}
	return scheme + "://" + host
}

// marshalToRaw JSON-encodes v and returns the result as json.RawMessage.
// Returns nil if v is nil or marshaling fails.
func marshalToRaw(v interface{}) json.RawMessage {
	if v == nil {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return b
}

// redirectToHubMiddleware sends a 302 to hubURL+path for every non-/api request,
// keeping the spoke as a pure API backend while the hub owns the user-facing UI.
// Self-redirect (hubURL points back to this instance) is skipped to avoid loops.
func redirectToHubMiddleware(hubURL string) gin.HandlerFunc {
	hubBase := strings.TrimRight(hubURL, "/")
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		if strings.HasPrefix(path, "/api/") || path == "/api" {
			c.Next()
			return
		}
		// Guard against a misconfigured HUB_URL pointing at ourselves.
		if selfBase := localDashboardURL(c); hubBase == strings.TrimRight(selfBase, "/") {
			c.Next()
			return
		}
		c.Redirect(http.StatusFound, hubBase+c.Request.URL.RequestURI())
		c.Abort()
	}
}
