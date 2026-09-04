package kubernetes

import (
	"context"
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

// Client lifecycle — the read/write split
//
// Design (PERF-2026-09-04, slice 2): reads (every LIST/GET behind the JSON
// routes) go through ONE long-lived client per cluster, built once at startup
// under the dashboard's own service-account identity — GetReadClient below,
// currently the same singleton as GetDefaultClient, and the thing an informer
// cache (once wired) sits behind. Writes (any mutation: pin, clear pin,
// change-version/force-deploy, bypass-gates, retry, mark-successful,
// unblock-failed, reconcile, continue) and SelfSubjectAccessReviews keep using
// the per-request user identity (the OIDC bearer token) exactly as before —
// GetWriteClient below. Never use GetReadClient's result to perform a mutating
// call, and never downgrade a write to the shared service-account identity by
// reaching for GetReadClient/GetDefaultClient in a write handler.
//
// A shared read client bypasses the viewing user's own RBAC (it authenticates
// as the dashboard's service account, not as them). Every namespaced object
// read through it and returned to an authenticated request MUST be checked
// against that user's own right to `list rollouts` in the object's namespace
// before it reaches the response body — see visibility.go. Service-account
// mode (no OIDC token on the request) is exempt: that caller already is the
// trusted identity.

// GetReadClient returns the shared, process-lifetime client used for every
// read (LIST/GET) behind the JSON routes. Backed by the informer cache built
// by InitReadCache (cache.go) once it has completed its startup sync;
// ErrCacheWarming is returned (never a block) if that sync is still in
// flight, and this falls back to the plain (uncached) default client if
// InitReadCache was never called at all (e.g. in tests, or a binary that
// doesn't wire it up) — same behavior as before slice 2. The per-request
// token, if any, is intentionally ignored — see the visibility-filter
// requirement above for how per-user RBAC is still enforced on data read
// through this client.
func GetReadClient(c *gin.Context) (*Client, error) {
	if readCacheClient == nil {
		return GetDefaultClient()
	}
	if !readCacheReady.Load() {
		return nil, ErrCacheWarming
	}
	return readCacheClient, nil
}

// GetReadClientForGoContext is GetReadClient for non-Gin callers (background
// operations that have no per-request user identity to consider anyway).
func GetReadClientForGoContext(ctx context.Context) (*Client, error) {
	if readCacheClient == nil {
		return GetDefaultClient()
	}
	if !readCacheReady.Load() {
		return nil, ErrCacheWarming
	}
	return readCacheClient, nil
}

// GetWriteClient returns a client authorized as the actual signed-in operator
// for a mutating call or a SelfSubjectAccessReview. When an OIDC token is
// present on the request it is used verbatim (never silently downgraded to
// the service account); otherwise this falls back to the shared default
// client, matching today's service-account-only behavior. Construction is
// cheap — see NewClientWithToken — it reuses the shared Scheme/RESTMapper
// instead of redoing API discovery per request.
func GetWriteClient(c *gin.Context) (*Client, error) {
	token := auth.GetTokenFromContext(c)
	if token != "" {
		return NewClientWithToken(token)
	}
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
