package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
)

// getK8sClient is a helper function to get Kubernetes client from context
// It returns an error response if the client cannot be obtained
func getK8sClient(c *gin.Context) (*kubernetes.Client, bool) {
	k8sClient, err := kubernetes.GetClientFromContext(c)
	if err != nil {
		log.Printf("Failed to get Kubernetes client: %v", err)
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
