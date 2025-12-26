package kubernetes

import (
	"context"
	"log"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/kuberik/rollout-dashboard/pkg/auth"
)

var (
	// defaultClient is the default Kubernetes client using service account credentials
	defaultClient *Client
	defaultOnce   sync.Once
	defaultErr    error
)

// GetClientFromContext gets a Kubernetes client from the Gin context
// If an OIDC token is present in the context, it uses that token for authentication
// Otherwise, it falls back to the default client (service account credentials)
func GetClientFromContext(c *gin.Context) (*Client, error) {
	// Try to get token from context
	token := auth.GetTokenFromContext(c)

	// If token is present, create a new client with that token
	if token != "" {
		log.Printf("[K8s Client Debug] Creating client with OIDC token (token length: %d, path: %s)", len(token), c.Request.URL.Path)
		return NewClientWithToken(token)
	}

	// Otherwise, use the default client
	log.Printf("[K8s Client Debug] No OIDC token found, using default service account client (path: %s)", c.Request.URL.Path)
	return GetDefaultClient()
}

// GetDefaultClient returns the default Kubernetes client (using service account credentials)
// This is lazily initialized on first use
func GetDefaultClient() (*Client, error) {
	defaultOnce.Do(func() {
		defaultClient, defaultErr = NewClient()
	})
	return defaultClient, defaultErr
}

// GetClientFromGoContext is a helper for non-Gin contexts (e.g., background operations)
// It always uses the default client
func GetClientFromGoContext(ctx context.Context) (*Client, error) {
	return GetDefaultClient()
}
