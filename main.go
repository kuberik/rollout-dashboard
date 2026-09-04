package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"bytes"

	"sync"

	"github.com/docker/cli/cli/config"
	"github.com/docker/cli/cli/config/configfile"
	kustomizev1 "github.com/fluxcd/kustomize-controller/api/v1"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	"github.com/gin-contrib/gzip"
	"github.com/gin-contrib/sse"
	"github.com/gin-contrib/static"
	"github.com/gin-gonic/gin"
	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/crane"
	"github.com/google/go-github/v88/github"
	envv1alpha1 "github.com/kuberik/environment-controller/api/v1alpha1"
	openkruisev1alpha1 "github.com/kuberik/openkruise-controller/api/v1alpha1"
	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	"github.com/kuberik/rollout-dashboard/pkg/auth"
	"github.com/kuberik/rollout-dashboard/pkg/githubapp"
	"github.com/kuberik/rollout-dashboard/pkg/githubcache"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
	"github.com/kuberik/rollout-dashboard/pkg/logs"
	"github.com/kuberik/rollout-dashboard/pkg/oci"
	kruiserolloutv1beta1 "github.com/openkruise/kruise-rollout-api/rollouts/v1beta1"
	"golang.org/x/sync/errgroup"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// dockerConfigKeychain implements authn.Keychain interface for Docker config JSON
type dockerConfigKeychain struct {
	config *configfile.ConfigFile
}

func (k *dockerConfigKeychain) Resolve(resource authn.Resource) (authn.Authenticator, error) {
	// Find the registry in our config
	for registry, auth := range k.config.AuthConfigs {
		if resource.RegistryStr() == registry {
			return authn.FromConfig(authn.AuthConfig{
				Username: auth.Username,
				Password: auth.Password,
			}), nil
		}
	}
	// Return anonymous authenticator if no match found
	return authn.Anonymous, nil
}

func main() {
	// Build the shared read-side informer cache in the background (PERF-2026-09-04
	// slice 2) — non-blocking so the server below starts accepting connections
	// immediately; read routes 503 (kubernetes.ErrCacheWarming) until the initial
	// sync completes or this timeout elapses, whichever is first. See
	// pkg/kubernetes/cache.go for the exact resource set and the missing-CRD
	// degradation story.
	go kubernetes.InitReadCache(context.Background(), 15*time.Second)

	r := gin.Default()

	// Compress JSON responses. Excludes the SSE pod-logs stream and the
	// change-events stream (PERF-2026-09-04 §C.6, /api/events/stream) — gzip
	// buffers/wraps the ResponseWriter, which would break either handler's
	// per-message sse.Encode+Flush streaming.
	r.Use(gzip.Gzip(gzip.DefaultCompression, gzip.WithExcludedPathsRegexs([]string{`/pods/logs$`, `/events/stream$`})))

	// Apply token extraction middleware to all routes
	r.Use(auth.ExtractTokenMiddleware())

	// If HUB_URL is set, this instance is a spoke — redirect all non-/api requests
	// to the hub so there's one canonical entry point for the UI. /api requests
	// are still served locally so the hub can proxy to us.
	if hubURL := os.Getenv("HUB_URL"); hubURL != "" {
		r.Use(redirectToHubMiddleware(hubURL))
	}

	// API routes under /api prefix
	api := r.Group("/api")
	// Spoke proxy middleware: any request carrying ?dashboard=<url> that points to
	// a remote dashboard is transparently forwarded there. Local-only endpoints
	// (no ?dashboard param) fall through unchanged. Covers all current and future
	// rollout endpoints without per-handler proxy plumbing.
	api.Use(SpokeProxyMiddleware())
	{
		api.GET("/health", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"status": "ok",
			})
		})

		// --- GitHub App user-authorization (act on behalf of the viewing user) ---
		// The dashboard fetches commit data as the logged-in user, not as the app
		// installation, so users only ever see history they can see on GitHub.
		// The user token lives in an httpOnly cookie; the backend stays stateless.

		// GET /api/auth/github/login — start the user-authorization flow.
		api.GET("/auth/github/login", func(c *gin.Context) {
			if !githubapp.Configured() {
				c.JSON(http.StatusServiceUnavailable, gin.H{"error": "GitHub integration not configured"})
				return
			}
			state := randomToken()
			returnTo := sanitizeReturnPath(c.Query("return_to"))
			// Short-lived, httpOnly cookies for CSRF state + post-login redirect target.
			c.SetCookie(githubStateCookie, state, 600, "/", "", true, true)
			c.SetCookie(githubReturnCookie, returnTo, 600, "/", "", true, true)
			redirectURI := localDashboardURL(c) + "/api/auth/github/callback"
			c.Redirect(http.StatusFound, githubapp.AuthorizeURL(redirectURI, state))
		})

		// GET /api/auth/github/callback — exchange the code, store the user token.
		api.GET("/auth/github/callback", func(c *gin.Context) {
			returnTo := sanitizeReturnPath(readCookie(c, githubReturnCookie))
			// Clear the transient cookies regardless of outcome.
			c.SetCookie(githubStateCookie, "", -1, "/", "", true, true)
			c.SetCookie(githubReturnCookie, "", -1, "/", "", true, true)

			wantState := readCookie(c, githubStateCookie)
			gotState := c.Query("state")
			if wantState == "" || gotState == "" || !secureCompare(wantState, gotState) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid oauth state"})
				return
			}
			code := c.Query("code")
			if code == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "missing authorization code"})
				return
			}
			redirectURI := localDashboardURL(c) + "/api/auth/github/callback"
			token, err := githubapp.ExchangeCode(c.Request.Context(), code, redirectURI)
			if err != nil {
				log.Printf("GitHub code exchange failed: %v", err)
				c.JSON(http.StatusBadGateway, gin.H{"error": "GitHub authorization failed", "details": err.Error()})
				return
			}
			// Non-expiring user token (app has token expiry disabled). httpOnly so
			// client JS can't read it; ~1yr maxAge as a client-side hint only.
			c.SetCookie(githubTokenCookie, token, 365*24*3600, "/", "", true, true)
			c.Redirect(http.StatusFound, returnTo)
		})

		// GET /api/auth/github/status — is the current user connected to GitHub?
		api.GET("/auth/github/status", func(c *gin.Context) {
			if !githubapp.Configured() {
				c.JSON(http.StatusOK, gin.H{"configured": false, "connected": false})
				return
			}
			token := readCookie(c, githubTokenCookie)
			if token == "" {
				c.JSON(http.StatusOK, gin.H{"configured": true, "connected": false})
				return
			}
			user, err := githubapp.CurrentUser(c.Request.Context(), token)
			if err != nil {
				// Token invalid/revoked — drop it so the UI prompts to reconnect.
				c.SetCookie(githubTokenCookie, "", -1, "/", "", true, true)
				c.JSON(http.StatusOK, gin.H{"configured": true, "connected": false})
				return
			}
			c.JSON(http.StatusOK, gin.H{
				"configured": true,
				"connected":  true,
				"login":      user.Login,
				"avatarUrl":  user.AvatarURL,
			})
		})

		// POST /api/auth/github/logout — disconnect (clear the user token).
		api.POST("/auth/github/logout", func(c *gin.Context) {
			c.SetCookie(githubTokenCookie, "", -1, "/", "", true, true)
			c.JSON(http.StatusOK, gin.H{"connected": false})
		})

		// GET /api/cluster — returns the name and URL of this dashboard instance.
		// Name and URL come from CLUSTER_NAME / DASHBOARD_URL env vars (typically
		// populated via the optional kuberik-cluster-info ConfigMap). Both fall back
		// to URL parsing of the incoming request.
		api.GET("/cluster", func(c *gin.Context) {
			localURL := localDashboardURL(c)
			name := os.Getenv("CLUSTER_NAME")
			if name == "" {
				name = ClusterNameFromURL(localURL)
			}
			c.JSON(http.StatusOK, ClusterInfo{URL: localURL, Name: name})
		})

		// GET /api/clusters — the local cluster plus all discovered spokes, as
		// {name,url} pairs. Powers the frontend cluster switcher and warms the
		// name→url registry used by the proxy.
		api.GET("/clusters", func(c *gin.Context) {
			k8sClient, ok := getK8sReadClient(c)
			if !ok {
				return
			}
			localURL := localDashboardURL(c)
			localName := os.Getenv("CLUSTER_NAME")
			if localName == "" {
				localName = ClusterNameFromURL(localURL)
			}
			clusters := []ClusterInfo{{URL: localURL, Name: localName}}

			// Discovering spokes is best-effort — a single-cluster dashboard just
			// returns itself.
			if envs, err := k8sClient.GetEnvironmentsAllNamespaces(c.Request.Context()); err == nil {
				spokes := discoverClusters(c.Request.Context(), marshalToRaw(envs), localURL, auth.GetTokenFromContext(c))
				registry.put(spokes)
				clusters = append(clusters, spokes...)
			}
			c.JSON(http.StatusOK, gin.H{"clusters": clusters})
		})

		api.GET("/rollouts", func(c *gin.Context) {
			k8sClient, ok := getK8sReadClient(c)
			if !ok {
				return
			}

			namespace := c.DefaultQuery("namespace", "all")
			allNamespaces := namespace == "all" || namespace == "*" || namespace == ""

			var (
				rollouts            *rolloutv1alpha1.RolloutList
				kustomizations      *kustomizev1.KustomizationList
				environments        *envv1alpha1.EnvironmentList
				kruiseRollouts      *kruiserolloutv1beta1.RolloutList
				rolloutDependencies *rolloutv1alpha1.RolloutDependencyList
				rolloutsErr         error
			)

			// Fan out the 5 cluster LISTs in parallel. Only rollouts is fatal —
			// the rest log on failure and return partial data (matches prior behavior).
			//
			// ImagePolicies, ImageRepositories, and OCIRepositories used to be
			// fetched here too (8 LISTs total), but RolloutsListResponse in
			// frontend/src/lib/api/rollouts.ts never declares those fields — the
			// frontend silently dropped them. Dropped from this handler entirely;
			// nothing else in this closure reads them.
			g, gctx := errgroup.WithContext(c.Request.Context())
			g.Go(func() error {
				var err error
				if allNamespaces {
					rollouts, err = k8sClient.GetRolloutsAllNamespaces(gctx)
				} else {
					rollouts, err = k8sClient.GetRollouts(gctx, namespace)
				}
				if err != nil {
					rolloutsErr = err
				}
				return nil
			})
			g.Go(func() error {
				var err error
				if allNamespaces {
					kustomizations, err = k8sClient.GetKustomizationsAllNamespaces(gctx)
				} else {
					kustomizations, err = k8sClient.GetKustomizations(gctx, namespace)
				}
				if err != nil {
					log.Printf("Error fetching kustomizations: %v", err)
				}
				return nil
			})
			g.Go(func() error {
				var err error
				if allNamespaces {
					environments, err = k8sClient.GetEnvironmentsAllNamespaces(gctx)
				} else {
					environments, err = k8sClient.GetEnvironments(gctx, namespace)
				}
				if err != nil {
					log.Printf("Error fetching environments: %v", err)
				}
				return nil
			})
			g.Go(func() error {
				var err error
				if allNamespaces {
					kruiseRollouts, err = k8sClient.GetKruiseRolloutsAllNamespaces(gctx)
				} else {
					kruiseRollouts, err = k8sClient.GetKruiseRollouts(gctx, namespace)
				}
				if err != nil {
					log.Printf("Error fetching kruise rollouts: %v", err)
				}
				return nil
			})
			g.Go(func() error {
				var err error
				if allNamespaces {
					rolloutDependencies, err = k8sClient.GetRolloutDependenciesAllNamespaces(gctx)
				} else {
					rolloutDependencies, err = k8sClient.GetRolloutDependencies(gctx, namespace)
				}
				if err != nil {
					// Non-fatal by design: a cluster that has not installed the
					// RolloutDependency CRD fails here with a RESTMapper "no matches
					// for kind" error, and must still be able to serve its rollouts.
					log.Printf("Error fetching rollout dependencies: %v", err)
					rolloutDependencies = nil
				}
				return nil
			})
			_ = g.Wait()

			if rolloutsErr != nil {
				log.Printf("Error fetching rollouts: %v", rolloutsErr)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch rollouts",
					"details": rolloutsErr.Error(),
				})
				return
			}

			// Per-user visibility: everything above was read through the shared
			// read client (the dashboard's own service-account identity), which
			// sees every namespace. Trim the results down to the namespaces the
			// signed-in operator may themselves `list rollouts` in — a no-op when
			// the request carries no OIDC token (service-account mode, or this
			// being the leg of a fan-out call the hub already gated). See
			// pkg/kubernetes/context.go and visibility.go for the RBAC boundary.
			{
				nsSet := map[string]struct{}{}
				for _, r := range rollouts.Items {
					nsSet[r.Namespace] = struct{}{}
				}
				if kustomizations != nil {
					for _, k := range kustomizations.Items {
						nsSet[k.Namespace] = struct{}{}
					}
				}
				if environments != nil {
					for _, e := range environments.Items {
						nsSet[e.Namespace] = struct{}{}
					}
				}
				if kruiseRollouts != nil {
					for _, kr := range kruiseRollouts.Items {
						nsSet[kr.Namespace] = struct{}{}
					}
				}
				if rolloutDependencies != nil {
					for _, d := range rolloutDependencies.Items {
						nsSet[d.Namespace] = struct{}{}
					}
				}
				namespaces := make([]string, 0, len(nsSet))
				for ns := range nsSet {
					namespaces = append(namespaces, ns)
				}

				allowedNS, err := kubernetes.AllowedNamespaces(c, namespaces)
				if err != nil {
					log.Printf("Error checking namespace visibility: %v", err)
					c.JSON(http.StatusInternalServerError, gin.H{
						"error":   "Failed to check namespace visibility",
						"details": err.Error(),
					})
					return
				}

				rollouts.Items = kubernetes.FilterByNamespace(rollouts.Items, func(r rolloutv1alpha1.Rollout) string { return r.Namespace }, allowedNS)
				if kustomizations != nil {
					kustomizations.Items = kubernetes.FilterByNamespace(kustomizations.Items, func(k kustomizev1.Kustomization) string { return k.Namespace }, allowedNS)
				}
				if environments != nil {
					environments.Items = kubernetes.FilterByNamespace(environments.Items, func(e envv1alpha1.Environment) string { return e.Namespace }, allowedNS)
				}
				if kruiseRollouts != nil {
					kruiseRollouts.Items = kubernetes.FilterByNamespace(kruiseRollouts.Items, func(kr kruiserolloutv1beta1.Rollout) string { return kr.Namespace }, allowedNS)
				}
				if rolloutDependencies != nil {
					rolloutDependencies.Items = kubernetes.FilterByNamespace(rolloutDependencies.Items, func(d rolloutv1alpha1.RolloutDependency) string { return d.Namespace }, allowedNS)
				}
			}

			// If we're already serving a fan-out leg (header set by the calling hub),
			// return local data only — fanning out again would create a cycle.
			if c.GetHeader(fanoutHeader) != "" {
				c.JSON(http.StatusOK, gin.H{
					"rollouts":            rollouts,
					"kustomizations":      kustomizations,
					"environments":        environments,
					"kruiseRollouts":      kruiseRollouts,
					"rolloutDependencies": rolloutDependencies,
				})
				return
			}

			// Fan out to discovered spoke dashboards and merge results.
			localData := map[string]json.RawMessage{
				"rollouts":            marshalToRaw(rollouts),
				"environments":        marshalToRaw(environments),
				"kustomizations":      marshalToRaw(kustomizations),
				"kruiseRollouts":      marshalToRaw(kruiseRollouts),
				"rolloutDependencies": marshalToRaw(rolloutDependencies),
			}
			localURL := localDashboardURL(c)
			token := auth.GetTokenFromContext(c)
			merged, clusters, clusterErrors := fanOutRollouts(c.Request.Context(), localData, localURL, token)

			response := gin.H{
				"rollouts":            merged["rollouts"],
				"kustomizations":      merged["kustomizations"],
				"environments":        merged["environments"],
				"kruiseRollouts":      merged["kruiseRollouts"],
				"rolloutDependencies": merged["rolloutDependencies"],
			}
			if len(clusters) > 0 {
				response["clusters"] = clusters
			}
			if len(clusterErrors) > 0 {
				response["clusterErrors"] = clusterErrors
			}
			writeJSONWithETag(c, http.StatusOK, response)
		})

		api.GET("/rollouts/:namespace/:name", func(c *gin.Context) {
			k8sClient, ok := getK8sReadClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			if !requireRolloutVisibility(c, namespace) {
				return
			}
			name := c.Param("name")

			var (
				rollout           *rolloutv1alpha1.Rollout
				rolloutErr        error
				kustomizationsRaw *kustomizev1.KustomizationList
				ociRepositories   *sourcev1.OCIRepositoryList
				kustomizations    interface{}
				rolloutGates      interface{}
				environment       interface{}
				kruiseRollout     interface{}
				rolloutTests      interface{}
				imageRepoScanTime string
			)

			// Fan out: rollout fetch is fatal (returns 500 below); the rest log-and-continue.
			// ImagePolicy → ImageRepository chain is sequenced inside the rollout goroutine since
			// it depends on rollout.Spec.ReleasesImagePolicy.Name.
			g, gctx := errgroup.WithContext(c.Request.Context())
			g.Go(func() error {
				r, err := k8sClient.GetRollout(gctx, namespace, name)
				if err != nil {
					rolloutErr = err
					return nil
				}
				rollout = r
				if r.Spec.ReleasesImagePolicy.Name == "" {
					return nil
				}
				imagePolicy, err := k8sClient.GetImagePolicy(gctx, namespace, r.Spec.ReleasesImagePolicy.Name)
				if err != nil || imagePolicy.Spec.ImageRepositoryRef.Name == "" {
					return nil
				}
				imageRepo, err := k8sClient.GetImageRepository(gctx, namespace, imagePolicy.Spec.ImageRepositoryRef.Name)
				if err == nil && imageRepo.Status.LastScanResult != nil {
					imageRepoScanTime = imageRepo.Status.LastScanResult.ScanTime.Format(time.RFC3339)
				}
				return nil
			})
			g.Go(func() error {
				res, err := k8sClient.GetKustomizations(gctx, namespace)
				if err != nil {
					log.Printf("Error fetching kustomizations: %v", err)
					return nil
				}
				kustomizationsRaw = res
				return nil
			})
			g.Go(func() error {
				res, err := k8sClient.GetOCIRepositoriesByRolloutAnnotation(gctx, namespace, name)
				if err != nil {
					log.Printf("Error fetching OCI repositories: %v", err)
					return nil
				}
				ociRepositories = res
				return nil
			})
			g.Go(func() error {
				res, err := k8sClient.GetRolloutGatesByRolloutReference(gctx, namespace, name)
				if err != nil {
					log.Printf("Error fetching rollout gates: %v", err)
					return nil
				}
				rolloutGates = res
				return nil
			})
			g.Go(func() error {
				res, err := k8sClient.GetEnvironmentByRolloutReference(gctx, namespace, name)
				if err != nil {
					log.Printf("Error fetching environment: %v", err)
					return nil
				}
				environment = res
				return nil
			})
			g.Go(func() error {
				res, err := k8sClient.GetKruiseRollout(gctx, namespace, name)
				if err != nil {
					// KruiseRollout might not exist, that's okay
					return nil
				}
				kruiseRollout = res
				return nil
			})
			g.Go(func() error {
				res, err := k8sClient.GetAllRolloutTests(gctx, namespace)
				if err != nil {
					log.Printf("Error fetching rollout tests: %v", err)
					return nil
				}
				rolloutTests = res
				return nil
			})
			_ = g.Wait()

			if rolloutErr != nil {
				log.Printf("Error fetching rollout: %v", rolloutErr)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch rollout",
					"details": rolloutErr.Error(),
				})
				return
			}

			// Filter the raw Kustomization list against the OCIRepositories list
			// fetched above — one namespace-scoped OCIRepositories LIST feeds both
			// the "ociRepositories" response field and this filter, instead of the
			// previous two independent LISTs of the same resource (one nested
			// inside GetKustomizationsByRolloutAnnotation, one standalone).
			if kustomizationsRaw != nil {
				oci := ociRepositories
				if oci == nil {
					// OCIRepositories fetch failed independently; still filter by
					// the direct rollout-substitute annotation so the page degrades
					// gracefully instead of losing kustomizations entirely.
					oci = &sourcev1.OCIRepositoryList{}
				}
				kustomizations = kubernetes.FilterKustomizationsByRolloutAnnotation(kustomizationsRaw, oci, name)
			}

			writeJSONWithETag(c, http.StatusOK, gin.H{
				"rollout":           rollout,
				"kustomizations":    kustomizations,
				"ociRepositories":   ociRepositories,
				"rolloutGates":      rolloutGates,
				"environment":       environment,
				"kruiseRollout":     kruiseRollout,
				"rolloutTests":      rolloutTests,
				"imageRepoScanTime": imageRepoScanTime,
			})
		})

		api.GET("/rollouts/:namespace/:name/environments", func(c *gin.Context) {
			k8sClient, ok := getK8sReadClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			if !requireRolloutVisibility(c, namespace) {
				return
			}

			// Get all Environments in the namespace
			environments, err := k8sClient.GetEnvironments(context.Background(), namespace)
			if err != nil {
				log.Printf("Error fetching environments: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch environments",
					"details": err.Error(),
				})
				return
			}

			c.JSON(http.StatusOK, gin.H{
				"environments": environments,
			})
		})

		// Get RolloutTests for a KruiseRollout
		api.GET("/rollouts/:namespace/:name/rollout-tests", func(c *gin.Context) {
			k8sClient, ok := getK8sReadClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			if !requireRolloutVisibility(c, namespace) {
				return
			}
			name := c.Param("name")

			// Get RolloutTests that reference this KruiseRollout
			rolloutTests, err := k8sClient.GetRolloutTestsByRolloutName(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error fetching rollout tests: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch rollout tests",
					"details": err.Error(),
				})
				return
			}

			// Try to get the KruiseRollout to get current step info
			// Note: We use interface{} since we don't import kruiserolloutv1beta1 in main.go
			var kruiseRollout interface{}
			kruiseRolloutObj, err := k8sClient.GetKruiseRollout(context.Background(), namespace, name)
			if err != nil {
				// KruiseRollout might not exist, that's okay
				kruiseRollout = nil
			} else {
				kruiseRollout = kruiseRolloutObj
			}

			c.JSON(http.StatusOK, gin.H{
				"rolloutTests":  rolloutTests,
				"kruiseRollout": kruiseRollout,
			})
		})

		api.POST("/rollouts/:namespace/:name/pin", func(c *gin.Context) {
			k8sClient, ok := getK8sWriteClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			name := c.Param("name")

			var pinRequest struct {
				Version     *string `json:"version"`
				Explanation string  `json:"explanation"`
			}
			if err := c.ShouldBindJSON(&pinRequest); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{
					"error":   "Invalid request body",
					"details": err.Error(),
				})
				return
			}

			// Set default explanation if not provided
			explanation := pinRequest.Explanation
			if explanation == "" {
				if pinRequest.Version != nil {
					explanation = fmt.Sprintf("Pinned to version %s", *pinRequest.Version)
				} else {
					explanation = "Cleared version pin"
				}
			}

			// Update the rollout with the new version and explanation
			updatedRollout, err := k8sClient.UpdateRolloutVersion(c.Request.Context(), namespace, name, pinRequest.Version, explanation)
			if err != nil {
				log.Printf("Error updating rollout: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to update rollout version",
					"details": err.Error(),
				})
				return
			}

			c.JSON(http.StatusOK, gin.H{
				"rollout": updatedRollout,
			})
		})

		// Add force-deploy annotation to rollout
		api.POST("/rollouts/:namespace/:name/force-deploy", func(c *gin.Context) {
			k8sClient, ok := getK8sWriteClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			name := c.Param("name")

			var forceDeployRequest struct {
				Version string `json:"version" binding:"required"`
				Message string `json:"message"`
			}
			if err := c.ShouldBindJSON(&forceDeployRequest); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{
					"error":   "Invalid request body",
					"details": err.Error(),
				})
				return
			}

			// Set default message if not provided
			message := forceDeployRequest.Message
			if message == "" {
				message = fmt.Sprintf("Force deploy version %s", forceDeployRequest.Version)
			}

			// Add the force-deploy annotation with the specific version and optional message
			updatedRollout, err := k8sClient.AddForceDeployAnnotation(c.Request.Context(), namespace, name, forceDeployRequest.Version, message)
			if err != nil {
				log.Printf("Error adding force-deploy annotation: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to add force-deploy annotation",
					"details": err.Error(),
				})
				return
			}

			c.JSON(http.StatusOK, gin.H{
				"rollout": updatedRollout,
			})
		})

		// Add bypass-gates annotation to rollout
		api.POST("/rollouts/:namespace/:name/bypass-gates", func(c *gin.Context) {
			k8sClient, ok := getK8sWriteClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			name := c.Param("name")

			var bypassRequest struct {
				Version string `json:"version" binding:"required"`
			}
			if err := c.ShouldBindJSON(&bypassRequest); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{
					"error":   "Invalid request body",
					"details": err.Error(),
				})
				return
			}

			// Add the bypass-gates annotation with the specific version
			updatedRollout, err := k8sClient.AddBypassGatesAnnotation(context.Background(), namespace, name, bypassRequest.Version)
			if err != nil {
				log.Printf("Error adding bypass-gates annotation: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to add bypass-gates annotation",
					"details": err.Error(),
				})
				return
			}

			c.JSON(http.StatusOK, gin.H{
				"rollout": updatedRollout,
			})
		})

		// Change version (pin or unpin + force-deploy) atomically
		api.POST("/rollouts/:namespace/:name/change-version", func(c *gin.Context) {
			k8sClient, ok := getK8sWriteClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			name := c.Param("name")

			var req struct {
				Version string `json:"version" binding:"required"`
				Pin     bool   `json:"pin"`
				Message string `json:"message"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{
					"error":   "Invalid request body",
					"details": err.Error(),
				})
				return
			}

			// Set default message if not provided
			message := req.Message
			if message == "" {
				if req.Pin {
					message = "Pinned version"
				} else {
					message = "Force deploy"
				}
			}

			updatedRollout, err := k8sClient.ChangeVersion(c.Request.Context(), namespace, name, req.Version, req.Pin, message)
			if err != nil {
				log.Printf("Error changing version: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to change version",
					"details": err.Error(),
				})
				return
			}

			c.JSON(http.StatusOK, gin.H{
				"rollout": updatedRollout,
			})
		})

		// Add unblock-failed annotation to rollout
		api.POST("/rollouts/:namespace/:name/unblock-failed", func(c *gin.Context) {
			k8sClient, ok := getK8sWriteClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			name := c.Param("name")

			// Add the unblock-failed annotation
			updatedRollout, err := k8sClient.AddUnblockFailedAnnotation(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error adding unblock-failed annotation: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to add unblock-failed annotation",
					"details": err.Error(),
				})
				return
			}

			c.JSON(http.StatusOK, gin.H{
				"rollout": updatedRollout,
			})
		})

		// Mark deployment as successful
		api.POST("/rollouts/:namespace/:name/mark-successful", func(c *gin.Context) {
			k8sClient, ok := getK8sWriteClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			name := c.Param("name")

			var markSuccessfulRequest struct {
				Message string `json:"message"`
			}
			if err := c.ShouldBindJSON(&markSuccessfulRequest); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{
					"error":   "Invalid request body",
					"details": err.Error(),
				})
				return
			}

			// Mark the deployment as successful
			updatedRollout, err := k8sClient.MarkDeploymentSuccessful(context.Background(), namespace, name, markSuccessfulRequest.Message)
			if err != nil {
				log.Printf("Error marking deployment as successful: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to mark deployment as successful",
					"details": err.Error(),
				})
				return
			}

			c.JSON(http.StatusOK, gin.H{
				"rollout": updatedRollout,
			})
		})

		// Reconcile all associated Flux resources for a rollout
		api.POST("/rollouts/:namespace/:name/reconcile", func(c *gin.Context) {
			k8sClient, ok := getK8sWriteClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			name := c.Param("name")

			// Reconcile all associated Flux resources
			previousScanTime, err := k8sClient.ReconcileAllFluxResources(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error reconciling Flux resources: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to reconcile Flux resources",
					"details": err.Error(),
				})
				return
			}

			c.JSON(http.StatusOK, gin.H{
				"message":          "Successfully triggered reconciliation of all associated Flux resources",
				"previousScanTime": previousScanTime,
			})
		})

		// Continue OpenKruise rollout
		api.POST("/rollouts/:namespace/:name/continue", func(c *gin.Context) {
			k8sClient, ok := getK8sWriteClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			kruiseRolloutName := c.Param("name")

			// Parse request body to get Kuberik rollout name
			var req struct {
				KuberikRolloutName string `json:"kuberikRolloutName"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				log.Printf("Error parsing continue request body: %v", err)
				c.JSON(http.StatusBadRequest, gin.H{
					"error":   "Invalid request body",
					"details": err.Error(),
				})
				return
			}

			// Reset bake status to Deploying on the Kuberik rollout
			if req.KuberikRolloutName != "" {
				_, err := k8sClient.ResetBakeStatusToDeploying(context.Background(), namespace, req.KuberikRolloutName)
				if err != nil {
					log.Printf("Error resetting bake status: %v", err)
					c.JSON(http.StatusInternalServerError, gin.H{
						"error":   "Failed to reset bake status",
						"details": err.Error(),
					})
					return
				}

				// Reset health checks to Pending
				if err := k8sClient.ResetHealthChecksToPending(context.Background(), namespace, req.KuberikRolloutName); err != nil {
					log.Printf("Error resetting health checks: %v", err)
					c.JSON(http.StatusInternalServerError, gin.H{
						"error":   "Failed to reset health checks",
						"details": err.Error(),
					})
					return
				}
			}

			// Continue the OpenKruise rollout
			updatedRollout, err := k8sClient.ContinueKruiseRollout(context.Background(), namespace, kruiseRolloutName)
			if err != nil {
				log.Printf("Error continuing kruise rollout: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to continue kruise rollout",
					"details": err.Error(),
				})
				return
			}

			c.JSON(http.StatusOK, gin.H{
				"rollout": updatedRollout,
			})
		})

		// Retry or skip a failed deployment by setting the rollout.kuberik.com/retry
		// annotation on the kuberik Rollout. The annotation value carries the mode:
		//   "retry" (default): re-run failed RolloutTests
		//   "skip":             mark failed RolloutTests as Skipped (treated as passing)
		// The controllers handle the cascade — no direct Kruise patching needed.
		// kruiseRolloutName in the body is legacy and ignored.
		api.POST("/rollouts/:namespace/:name/retry", func(c *gin.Context) {
			k8sClient, ok := getK8sWriteClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			kuberikRolloutName := c.Param("name")

			var req struct {
				KruiseRolloutName string `json:"kruiseRolloutName"`
				TestAction        string `json:"testAction"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body", "details": err.Error()})
				return
			}

			mode := openkruisev1alpha1.RetryModeRetry
			if req.TestAction == openkruisev1alpha1.RetryModeSkip {
				mode = openkruisev1alpha1.RetryModeSkip
			}

			if err := k8sClient.SetRetryAnnotation(context.Background(), namespace, kuberikRolloutName, mode); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to trigger retry", "details": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"status": "ok", "action": mode})
		})

		api.GET("/rollouts/:namespace/:name/manifest/:version", func(c *gin.Context) {
			k8sClient, ok := getK8sReadClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			if !requireRolloutVisibility(c, namespace) {
				return
			}
			name := c.Param("name")
			version := c.Param("version")

			// Get Rollout to get the image policy reference
			rollout, err := k8sClient.GetRollout(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error fetching rollout: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch rollout",
					"details": err.Error(),
				})
				return
			}

			// Get the ImagePolicy referenced by the rollout
			imagePolicyName := rollout.Spec.ReleasesImagePolicy.Name
			imagePolicy, err := k8sClient.GetImagePolicy(context.Background(), namespace, imagePolicyName)
			if err != nil {
				log.Printf("Error fetching image policy: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch image policy",
					"details": err.Error(),
				})
				return
			}

			// Get the ImageRepository referenced by the ImagePolicy
			imageRepoName := imagePolicy.Spec.ImageRepositoryRef.Name
			imageRepo, err := k8sClient.GetImageRepository(context.Background(), namespace, imageRepoName)
			if err != nil {
				log.Printf("Error fetching image repository: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch image repository",
					"details": err.Error(),
				})
				return
			}

			var opts []crane.Option
			if imageRepo.Spec.SecretRef != nil {
				secret, err := k8sClient.GetSecret(context.Background(), namespace, imageRepo.Spec.SecretRef.Name)
				if err != nil {
					log.Printf("Error fetching secret: %v", err)
					c.JSON(http.StatusInternalServerError, gin.H{
						"error": "Failed to fetch secret",
					})
					return
				}

				// Parse Docker config JSON using the same approach as crane
				reader := bytes.NewReader(secret.Data[".dockerconfigjson"])
				configFile, err := config.LoadFromReader(reader)
				if err != nil {
					log.Printf("Error loading Docker config: %v", err)
					c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse Docker config"})
					return
				}

				// Create a keychain that can resolve authentication for any registry
				keychain := &dockerConfigKeychain{config: configFile}
				opts = append(opts, crane.WithAuthFromKeychain(keychain))
			}

			// Get the image contents
			files, err := oci.GetImageContents(
				context.Background(),
				imageRepo.Spec.Image,
				version,
				opts...,
			)
			if err != nil {
				log.Printf("Error fetching image contents: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch image contents",
					"details": err.Error(),
				})
				return
			}

			// Convert files to a map for JSON response
			contents := make(map[string]string)
			for _, file := range files {
				contents[file.Name] = string(file.Content)
			}

			c.JSON(http.StatusOK, gin.H{
				"files": contents,
			})
		})

		// GET /api/rollouts/:namespace/:name/commits?base=<rev>&head=<rev>
		// Returns the commit range between two revisions in the rollout's source
		// repo, via the GitHub App installation (see pkg/githubapp). Requires the
		// rollout's status.source to be a github.com repo URL.
		//
		// ⭐ CACHING, AND THE ONE DISTINCTION IT TURNS ON. Every GitHub call
		// underneath is already conditional (`pkg/githubcache`), so a repeat
		// costs a `304` and no rate-limit budget. This handler adds the second
		// half: when BOTH refs are commit shas the answer is fixed for all time
		// — a range between two immutable objects — so the browser is told it
		// may reuse it. Anything else (a branch name, a tag) is `no-store`,
		// because a cache that serves a stale answer for mutable data is worse
		// than no cache. `private` throughout: this response is scoped to the
		// viewing user's GitHub access and must never land in a shared cache.
		api.GET("/rollouts/:namespace/:name/commits", func(c *gin.Context) {
			k8sClient, ok := getK8sReadClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			if !requireRolloutVisibility(c, namespace) {
				return
			}
			name := c.Param("name")
			base := c.Query("base")
			head := c.Query("head")
			if base == "" || head == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "base and head query params are required"})
				return
			}

			rollout, err := k8sClient.GetRollout(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error fetching rollout: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch rollout",
					"details": err.Error(),
				})
				return
			}

			if rollout.Status.Source == nil {
				c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "Rollout has no source repository"})
				return
			}

			owner, repo, ok := githubapp.ParseRepoURL(*rollout.Status.Source)
			if !ok {
				c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "Rollout source is not a GitHub repository"})
				return
			}

			// Both refs fixed objects => this body can never change.
			immutableRange := githubcache.IsCommitSHA(base) && githubcache.IsCommitSHA(head)
			setCommitsCacheHeaders := func() {
				if immutableRange {
					c.Header("Cache-Control", "private, max-age=600")
				} else {
					c.Header("Cache-Control", "no-store")
				}
			}

			if base == head {
				setCommitsCacheHeaders()
				c.JSON(http.StatusOK, gin.H{"ahead": 0, "behind": 0, "commits": []gin.H{}, "additions": 0, "deletions": 0, "changedFiles": 0})
				return
			}

			// Act on behalf of the viewing user, not the app installation, so the
			// commit range is scoped to what this user can see on GitHub.
			token := readCookie(c, githubTokenCookie)
			if token == "" {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "github_not_connected"})
				return
			}
			ghClient, err := githubapp.UserClient(token)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to build GitHub client", "details": err.Error()})
				return
			}

			compare := func(b, h string) (*github.CommitsComparison, error) {
				cmp, _, cerr := ghClient.Repositories.CompareCommits(context.Background(), owner, repo, b, h, nil)
				return cmp, cerr
			}

			comparison, err := compare(base, head)
			if err != nil {
				// A user who can't see the repo gets 404/403 from GitHub — surface
				// that as "no access" rather than a generic upstream error.
				var ghErr *github.ErrorResponse
				if errors.As(err, &ghErr) && ghErr.Response != nil {
					switch ghErr.Response.StatusCode {
					case http.StatusNotFound, http.StatusForbidden:
						c.JSON(http.StatusForbidden, gin.H{"error": "github_no_access"})
						return
					case http.StatusUnauthorized:
						// Token revoked — drop it so the UI reconnects.
						c.SetCookie(githubTokenCookie, "", -1, "/", "", true, true)
						c.JSON(http.StatusUnauthorized, gin.H{"error": "github_not_connected"})
						return
					}
				}
				log.Printf("Error comparing commits %s...%s in %s/%s: %v", base, head, owner, repo, err)
				c.JSON(http.StatusBadGateway, gin.H{
					"error":   "Failed to fetch commit range from GitHub",
					"details": err.Error(),
				})
				return
			}

			// Direction is inferred from the comparison so every caller (forward
			// deploys AND rollbacks) works with a single base→head convention.
			// When head is *behind* base (a rollback to an older revision), the
			// forward range has no commits; re-fetch the swapped range so we can
			// list the commits that were reverted.
			direction := "same"
			active := comparison
			if comparison.GetAheadBy() > 0 {
				direction = "forward"
			} else if comparison.GetBehindBy() > 0 {
				direction = "rollback"
				if swapped, serr := compare(head, base); serr == nil {
					active = swapped
				}
			}

			commits := make([]gin.H, 0, len(active.Commits))
			for _, commit := range active.Commits {
				var authorLogin, authorURL, avatarURL string
				if commit.Author != nil {
					authorLogin = commit.Author.GetLogin()
					authorURL = commit.Author.GetHTMLURL()
					avatarURL = commit.Author.GetAvatarURL()
				}
				if authorLogin == "" && commit.Commit != nil && commit.Commit.Author != nil {
					authorLogin = commit.Commit.Author.GetName()
				}
				var commitDate string
				if commit.Commit != nil && commit.Commit.Author != nil && commit.Commit.Author.Date != nil {
					commitDate = commit.Commit.Author.Date.Format(time.RFC3339)
				}
				var message string
				if commit.Commit != nil {
					message = commit.Commit.GetMessage()
				}
				commits = append(commits, gin.H{
					"sha":        commit.GetSHA(),
					"message":    message,
					"author":     authorLogin,
					"authorUrl":  authorURL,
					"avatarUrl":  avatarURL,
					"commitDate": commitDate,
					"url":        commit.GetHTMLURL(),
				})
			}

			// Aggregate line stats come free with the comparison (no per-commit
			// fetch), powering compact "+X / −Y · N files" summaries.
			var additions, deletions int
			for _, f := range active.Files {
				additions += f.GetAdditions()
				deletions += f.GetDeletions()
			}

			setCommitsCacheHeaders()
			c.JSON(http.StatusOK, gin.H{
				"direction":    direction,
				"ahead":        comparison.GetAheadBy(),
				"behind":       comparison.GetBehindBy(),
				"commits":      commits,
				"additions":    additions,
				"deletions":    deletions,
				"changedFiles": len(active.Files),
			})
		})

		// New endpoint to fetch the media type for a given version
		api.GET("/rollouts/:namespace/:name/mediatype/:version", func(c *gin.Context) {
			k8sClient, ok := getK8sReadClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			if !requireRolloutVisibility(c, namespace) {
				return
			}
			name := c.Param("name")
			version := c.Param("version")

			rollout, err := k8sClient.GetRollout(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error fetching rollout: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch rollout"})
				return
			}

			imagePolicyName := rollout.Spec.ReleasesImagePolicy.Name
			imagePolicy, err := k8sClient.GetImagePolicy(context.Background(), namespace, imagePolicyName)
			if err != nil {
				log.Printf("Error fetching image policy: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch image policy"})
				return
			}

			imageRepoName := imagePolicy.Spec.ImageRepositoryRef.Name
			imageRepo, err := k8sClient.GetImageRepository(context.Background(), namespace, imageRepoName)
			if err != nil {
				log.Printf("Error fetching image repository: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch image repository"})
				return
			}

			var opts []crane.Option
			if imageRepo.Spec.SecretRef != nil {
				secret, err := k8sClient.GetSecret(context.Background(), namespace, imageRepo.Spec.SecretRef.Name)
				if err != nil {
					log.Printf("Error fetching secret: %v", err)
					c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch secret"})
					return
				}

				// Parse Docker config JSON using the same approach as crane
				reader := bytes.NewReader(secret.Data[".dockerconfigjson"])
				configFile, err := config.LoadFromReader(reader)
				if err != nil {
					log.Printf("Error loading Docker config: %v", err)
					c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse Docker config"})
					return
				}

				// Create a keychain that can resolve authentication for any registry
				keychain := &dockerConfigKeychain{config: configFile}
				opts = append(opts, crane.WithAuthFromKeychain(keychain))
			}

			mediaType, err := oci.GetArtifactType(context.Background(), imageRepo.Spec.Image, version, opts...)
			if err != nil {
				log.Printf("Error fetching media type: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch media type"})
				return
			}

			c.JSON(http.StatusOK, gin.H{"mediaType": mediaType})
		})

		api.GET("/rollouts/:namespace/:name/annotations/:version", func(c *gin.Context) {
			k8sClient, ok := getK8sReadClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			if !requireRolloutVisibility(c, namespace) {
				return
			}
			name := c.Param("name")
			version := c.Param("version")

			// Get Rollout to get the image policy reference
			rollout, err := k8sClient.GetRollout(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error fetching rollout: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch rollout"})
				return
			}

			// Get the ImagePolicy referenced by the rollout
			imagePolicyName := rollout.Spec.ReleasesImagePolicy.Name
			imagePolicy, err := k8sClient.GetImagePolicy(context.Background(), namespace, imagePolicyName)
			if err != nil {
				log.Printf("Error fetching image policy: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch image policy"})
				return
			}

			imageRepoName := imagePolicy.Spec.ImageRepositoryRef.Name
			imageRepo, err := k8sClient.GetImageRepository(context.Background(), namespace, imageRepoName)
			if err != nil {
				log.Printf("Error fetching image repository: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch image repository"})
				return
			}

			var opts []crane.Option
			if imageRepo.Spec.SecretRef != nil {
				secret, err := k8sClient.GetSecret(context.Background(), namespace, imageRepo.Spec.SecretRef.Name)
				if err != nil {
					log.Printf("Error fetching secret: %v", err)
					c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch secret"})
					return
				}

				// Parse Docker config JSON using the same approach as crane
				reader := bytes.NewReader(secret.Data[".dockerconfigjson"])
				configFile, err := config.LoadFromReader(reader)
				if err != nil {
					log.Printf("Error loading Docker config: %v", err)
					c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse Docker config"})
					return
				}

				// Create a keychain that can resolve authentication for any registry
				keychain := &dockerConfigKeychain{config: configFile}
				opts = append(opts, crane.WithAuthFromKeychain(keychain))
			}

			annotations, err := oci.GetImageAnnotations(context.Background(), imageRepo.Spec.Image, version, opts...)
			if err != nil {
				log.Printf("Error fetching annotations: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch annotations"})
				return
			}

			c.JSON(http.StatusOK, gin.H{"annotations": annotations})
		})

		// New endpoint to fetch all available tags from a repository
		api.GET("/rollouts/:namespace/:name/tags", func(c *gin.Context) {
			k8sClient, ok := getK8sReadClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			if !requireRolloutVisibility(c, namespace) {
				return
			}
			name := c.Param("name")

			// Get Rollout to get the image policy reference
			rollout, err := k8sClient.GetRollout(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error fetching rollout: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch rollout"})
				return
			}

			// Get the ImagePolicy referenced by the rollout
			imagePolicyName := rollout.Spec.ReleasesImagePolicy.Name
			imagePolicy, err := k8sClient.GetImagePolicy(context.Background(), namespace, imagePolicyName)
			if err != nil {
				log.Printf("Error fetching image policy: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch image policy"})
				return
			}

			imageRepoName := imagePolicy.Spec.ImageRepositoryRef.Name
			imageRepo, err := k8sClient.GetImageRepository(context.Background(), namespace, imageRepoName)
			if err != nil {
				log.Printf("Error fetching image repository: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch image repository"})
				return
			}

			var opts []crane.Option
			if imageRepo.Spec.SecretRef != nil {
				secret, err := k8sClient.GetSecret(context.Background(), namespace, imageRepo.Spec.SecretRef.Name)
				if err != nil {
					log.Printf("Error fetching secret: %v", err)
					c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch secret"})
					return
				}

				// Parse Docker config JSON using the same approach as crane
				reader := bytes.NewReader(secret.Data[".dockerconfigjson"])
				configFile, err := config.LoadFromReader(reader)
				if err != nil {
					log.Printf("Error loading Docker config: %v", err)
					c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse Docker config"})
					return
				}

				// Create a keychain that can resolve authentication for any registry
				keychain := &dockerConfigKeychain{config: configFile}
				opts = append(opts, crane.WithAuthFromKeychain(keychain))
			}

			// Get all tags from the repository
			tags, err := oci.ListRepositoryTags(context.Background(), imageRepo.Spec.Image, opts...)
			if err != nil {
				log.Printf("Error fetching repository tags: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch repository tags"})
				return
			}

			c.JSON(http.StatusOK, gin.H{"tags": tags})
		})

		api.GET("/kustomizations/:namespace/:name/managed-resources", func(c *gin.Context) {
			k8sClient, ok := getK8sReadClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			if !requireRolloutVisibility(c, namespace) {
				return
			}
			name := c.Param("name")

			// Get managed resources for the Kustomization. This used to be
			// preceded by its own k8sClient.GetKustomization call, made only to
			// build a "debug" response block (dropped below — the frontend never
			// reads it) — GetKustomizationManagedResources already does its own
			// Get of the same Kustomization internally, so that first call was a
			// second GET of the identical object on every request. Its "does the
			// kustomization exist" error case is still covered:
			// GetKustomizationManagedResources returns the same
			// "failed to get kustomization: %w" error, surfaced below.
			managedResources, err := k8sClient.GetKustomizationManagedResources(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error fetching managed resources: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch managed resources",
					"details": err.Error(),
				})
				return
			}

			// The "object" field on each ManagedResourceStatus IS the full
			// unstructured manifest, and IS read by the frontend — not just for
			// display fields but cast whole (`resource.object as KruiseRollout`,
			// `resource.object as RolloutTest` in
			// frontend/src/routes/rollouts/[cluster]/[namespace]/[name]/+page.svelte
			// and .../history/+page.svelte, plus `.status.readyReplicas`/
			// `.status.replicas` for Deployments and `.spec.hostnames` for
			// HTTPRoutes). Per this task's own instruction, it stays.
			//
			// The "debug" block (hasInventory + every inventory entry ID) is
			// different: grepped every consumer of this endpoint
			// (ResourcesCard.svelte's callers in rollout detail, the history tab,
			// and apps/[name]) and none reads response.debug — only
			// response.managedResources. Dropped; managedResources is untouched.
			response := gin.H{
				"managedResources": managedResources,
			}

			c.JSON(http.StatusOK, response)
		})

		api.GET("/kustomizations/:namespace/:name/test", func(c *gin.Context) {
			k8sClient, ok := getK8sReadClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			if !requireRolloutVisibility(c, namespace) {
				return
			}
			name := c.Param("name")

			// Get the Kustomization
			kustomization, err := k8sClient.GetKustomization(context.Background(), namespace, name)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch kustomization",
					"details": err.Error(),
				})
				return
			}

			c.JSON(http.StatusOK, gin.H{
				"name":         kustomization.Name,
				"namespace":    kustomization.Namespace,
				"hasInventory": kustomization.Status.Inventory != nil,
			})
		})

		// Get child resources (ReplicaSets + Pods) for a Deployment
		api.GET("/namespaces/:namespace/deployments/:name/children", func(c *gin.Context) {
			k8sClient, ok := getK8sReadClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			if !requireRolloutVisibility(c, namespace) {
				return
			}
			name := c.Param("name")
			ctx := context.Background()
			clientset := k8sClient.GetClientset()

			// Get the Deployment to get its UID and selector
			deployment, err := clientset.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "Deployment not found"})
				return
			}

			deploymentUID := string(deployment.UID)

			// Narrow LIST scope: deployment selector matches all RS + Pods belonging to this deployment.
			// (RS adds pod-template-hash on top, but base labels still match.)
			selectorStr := metav1.FormatLabelSelector(deployment.Spec.Selector)
			listOpts := metav1.ListOptions{LabelSelector: selectorStr}

			// Get RS and Pods once — filter by ownerRef in-memory below to avoid N+1.
			allRS, err := clientset.AppsV1().ReplicaSets(namespace).List(ctx, listOpts)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list ReplicaSets"})
				return
			}
			allPods, err := clientset.CoreV1().Pods(namespace).List(ctx, listOpts)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list Pods"})
				return
			}

			type PodInfo struct {
				Name        string   `json:"name"`
				Namespace   string   `json:"namespace"`
				Phase       string   `json:"phase"`
				Ready       bool     `json:"ready"`
				Terminating bool     `json:"terminating"`
				Restarts    int32    `json:"restarts"`
				Node        string   `json:"node"`
				Age         string   `json:"age"`
				Images      []string `json:"images"`
				Message     string   `json:"message,omitempty"`
			}
			type RSInfo struct {
				Name            string    `json:"name"`
				Namespace       string    `json:"namespace"`
				Replicas        int32     `json:"replicas"`
				ReadyReplicas   int32     `json:"readyReplicas"`
				DesiredReplicas int32     `json:"desiredReplicas"`
				IsCurrentRS     bool      `json:"isCurrentRS"`
				Pods            []PodInfo `json:"pods"`
			}

			var replicaSets []RSInfo
			currentRSRevision := deployment.Annotations["deployment.kubernetes.io/revision"]

			for _, rs := range allRS.Items {
				owned := false
				for _, ownerRef := range rs.OwnerReferences {
					if string(ownerRef.UID) == deploymentUID {
						owned = true
						break
					}
				}
				if !owned {
					continue
				}

				rsUID := string(rs.UID)
				isCurrent := rs.Annotations["deployment.kubernetes.io/revision"] == currentRSRevision

				pods := []PodInfo{}
				for _, pod := range allPods.Items {
					isPodOwned := false
					for _, ownerRef := range pod.OwnerReferences {
						if string(ownerRef.UID) == rsUID {
							isPodOwned = true
							break
						}
					}
					if !isPodOwned {
						continue
					}

					// Count restarts and check readiness
					var totalRestarts int32
					isReady := false
					for _, cs := range pod.Status.ContainerStatuses {
						totalRestarts += cs.RestartCount
					}
					for _, cond := range pod.Status.Conditions {
						if cond.Type == corev1.PodReady && cond.Status == corev1.ConditionTrue {
							isReady = true
							break
						}
					}

					// Collect first meaningful message from container states or conditions
					podMessage := ""
					for _, cs := range pod.Status.ContainerStatuses {
						if cs.State.Waiting != nil && cs.State.Waiting.Reason != "" {
							podMessage = cs.State.Waiting.Reason
							if cs.State.Waiting.Message != "" {
								podMessage += ": " + cs.State.Waiting.Message
							}
							break
						}
						if cs.State.Terminated != nil && cs.State.Terminated.Reason != "" && cs.State.Terminated.Reason != "Completed" {
							podMessage = cs.State.Terminated.Reason
							if cs.State.Terminated.Message != "" {
								podMessage += ": " + cs.State.Terminated.Message
							}
							break
						}
					}
					if podMessage == "" {
						for _, cond := range pod.Status.Conditions {
							if cond.Status != corev1.ConditionTrue && cond.Message != "" {
								podMessage = cond.Message
								break
							}
						}
					}

					var images []string
					for _, c := range pod.Spec.Containers {
						images = append(images, c.Image)
					}

					age := ""
					if !pod.CreationTimestamp.IsZero() {
						dur := time.Since(pod.CreationTimestamp.Time)
						if dur < time.Minute {
							age = fmt.Sprintf("%ds", int(dur.Seconds()))
						} else if dur < time.Hour {
							age = fmt.Sprintf("%dm", int(dur.Minutes()))
						} else if dur < 24*time.Hour {
							age = fmt.Sprintf("%dh", int(dur.Hours()))
						} else {
							age = fmt.Sprintf("%dd", int(dur.Hours()/24))
						}
					}

					pods = append(pods, PodInfo{
						Name:        pod.Name,
						Namespace:   pod.Namespace,
						Phase:       string(pod.Status.Phase),
						Ready:       isReady,
						Terminating: pod.DeletionTimestamp != nil,
						Restarts:    totalRestarts,
						Node:        pod.Spec.NodeName,
						Age:         age,
						Images:      images,
						Message:     podMessage,
					})
				}

				desiredReplicas := int32(1)
				if rs.Spec.Replicas != nil {
					desiredReplicas = *rs.Spec.Replicas
				}

				replicaSets = append(replicaSets, RSInfo{
					Name:            rs.Name,
					Namespace:       rs.Namespace,
					Replicas:        rs.Status.Replicas,
					ReadyReplicas:   rs.Status.ReadyReplicas,
					DesiredReplicas: desiredReplicas,
					IsCurrentRS:     isCurrent,
					Pods:            pods,
				})
			}

			if replicaSets == nil {
				replicaSets = []RSInfo{}
			}

			c.JSON(http.StatusOK, gin.H{
				"replicaSets": replicaSets,
				"deployment": map[string]interface{}{
					"name":              deployment.Name,
					"namespace":         deployment.Namespace,
					"replicas":          deployment.Status.Replicas,
					"readyReplicas":     deployment.Status.ReadyReplicas,
					"updatedReplicas":   deployment.Status.UpdatedReplicas,
					"availableReplicas": deployment.Status.AvailableReplicas,
				},
			})
		})

		// New endpoint to fetch health checks for a rollout
		// Check permissions for a rollout action
		api.GET("/rollouts/:namespace/:name/permissions", func(c *gin.Context) {
			k8sClient, ok := getK8sWriteClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			name := c.Param("name")
			verb := c.DefaultQuery("verb", "update") // Default to "update" for most actions

			allowed, err := k8sClient.CheckRolloutPermission(context.Background(), verb, namespace, name)
			if err != nil {
				log.Printf("Error checking permission: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to check permission",
					"details": err.Error(),
				})
				return
			}

			c.JSON(http.StatusOK, gin.H{
				"allowed": allowed,
				"verb":    verb,
				"resource": gin.H{
					"apiGroup":  "kuberik.com",
					"kind":      "Rollout",
					"name":      name,
					"namespace": namespace,
				},
			})
		})

		// Check permissions for all common rollout actions
		api.GET("/rollouts/:namespace/:name/permissions/all", func(c *gin.Context) {
			k8sClient, ok := getK8sWriteClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			name := c.Param("name")

			// Check permissions for all common actions
			actions := map[string]string{
				"update": "update", // For pin, change-version, mark-successful, unblock-failed
				"patch":  "patch",  // For force-deploy, bypass-gates (annotation updates)
			}

			permissions := make(map[string]bool)
			for action, verb := range actions {
				allowed, err := k8sClient.CheckRolloutPermission(context.Background(), verb, namespace, name)
				if err != nil {
					log.Printf("Error checking permission for %s: %v", action, err)
					permissions[action] = false
				} else {
					permissions[action] = allowed
				}
			}

			c.JSON(http.StatusOK, gin.H{
				"permissions": permissions,
				"resource": gin.H{
					"apiGroup":  "kuberik.com",
					"kind":      "Rollout",
					"name":      name,
					"namespace": namespace,
				},
			})
		})

		api.GET("/rollouts/:namespace/:name/health-checks", func(c *gin.Context) {
			k8sClient, ok := getK8sReadClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			if !requireRolloutVisibility(c, namespace) {
				return
			}
			name := c.Param("name")

			// Get Rollout to get the health check selector
			rollout, err := k8sClient.GetRollout(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error fetching rollout: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch rollout",
					"details": err.Error(),
				})
				return
			}

			// Get health checks that match the rollout's health selector
			healthChecks, err := k8sClient.GetHealthChecksBySelector(context.Background(), namespace, rollout.Spec.HealthCheckSelector)
			if err != nil {
				log.Printf("Error fetching health checks: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch health checks",
					"details": err.Error(),
				})
				return
			}

			// Add debug information about namespace search
			debugInfo := gin.H{
				"rolloutNamespace":       namespace,
				"hasHealthCheckSelector": rollout.Spec.HealthCheckSelector != nil,
			}

			if rollout.Spec.HealthCheckSelector != nil {
				debugInfo["hasNamespaceSelector"] = rollout.Spec.HealthCheckSelector.NamespaceSelector != nil
				if rollout.Spec.HealthCheckSelector.NamespaceSelector != nil {
					debugInfo["namespaceSelectorType"] = "configured"
				} else {
					debugInfo["namespaceSelectorType"] = "current namespace only"
				}
			}

			c.JSON(http.StatusOK, gin.H{
				"healthChecks": healthChecks,
				"debug":        debugInfo,
			})
		})

		// Get events for a specific rollout
		api.GET("/rollouts/:namespace/:name/events", func(c *gin.Context) {
			k8sClient, ok := getK8sReadClient(c)
			if !ok {
				return
			}
			namespace := c.Param("namespace")
			if !requireRolloutVisibility(c, namespace) {
				return
			}
			name := c.Param("name")

			events, err := k8sClient.GetEventsForRollout(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error fetching events: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch events", "details": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"events": events})
		})

		// Get schedules for a specific rollout
		api.GET("/rollouts/:namespace/:name/schedules", func(c *gin.Context) {
			k8sClient, ok := getK8sReadClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			if !requireRolloutVisibility(c, namespace) {
				return
			}
			name := c.Param("name")

			// Get the rollout to get its labels
			rollout, err := k8sClient.GetRollout(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error fetching rollout: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch rollout",
					"details": err.Error(),
				})
				return
			}

			// Get the namespace to get its labels
			namespaceObj, err := k8sClient.GetClientset().CoreV1().Namespaces().Get(context.Background(), namespace, metav1.GetOptions{})
			if err != nil {
				log.Printf("Error fetching namespace: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch namespace",
					"details": err.Error(),
				})
				return
			}

			// Get RolloutSchedules in this namespace that match the rollout
			rolloutSchedules, err := k8sClient.GetRolloutSchedulesByRollout(context.Background(), namespace, name, rollout.Labels)
			if err != nil {
				log.Printf("Error fetching rollout schedules: %v", err)
			}

			// Get ClusterRolloutSchedules that match the rollout
			clusterSchedules, err := k8sClient.GetClusterRolloutSchedulesByRollout(context.Background(), namespace, name, rollout.Labels, namespaceObj.Labels)
			if err != nil {
				log.Printf("Error fetching cluster rollout schedules: %v", err)
			}

			c.JSON(http.StatusOK, gin.H{
				"rolloutSchedules":        rolloutSchedules,
				"clusterRolloutSchedules": clusterSchedules,
			})
		})

		// Get all schedules in a namespace
		api.GET("/schedules", func(c *gin.Context) {
			k8sClient, ok := getK8sReadClient(c)
			if !ok {
				return
			}

			namespace := c.DefaultQuery("namespace", "all")
			allNamespaces := namespace == "all" || namespace == "*" || namespace == ""

			var rolloutSchedules *rolloutv1alpha1.RolloutScheduleList
			var err error

			if allNamespaces {
				rolloutSchedules, err = k8sClient.GetRolloutSchedulesAllNamespaces(context.Background())
			} else {
				if !requireRolloutVisibility(c, namespace) {
					return
				}
				rolloutSchedules, err = k8sClient.GetRolloutSchedules(context.Background(), namespace)
			}

			if err != nil {
				log.Printf("Error fetching rollout schedules: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch rollout schedules",
					"details": err.Error(),
				})
				return
			}

			// Cluster-wide response, same per-user visibility rule as GET
			// /api/rollouts — trim to namespaces the caller may list rollouts in.
			// No-op for the single-namespace branch above (already gated by
			// requireRolloutVisibility) and for service-account requests.
			if allNamespaces {
				nsSet := map[string]struct{}{}
				for _, s := range rolloutSchedules.Items {
					nsSet[s.Namespace] = struct{}{}
				}
				namespaces := make([]string, 0, len(nsSet))
				for ns := range nsSet {
					namespaces = append(namespaces, ns)
				}
				allowedNS, visErr := kubernetes.AllowedNamespaces(c, namespaces)
				if visErr != nil {
					log.Printf("Error checking namespace visibility: %v", visErr)
					c.JSON(http.StatusInternalServerError, gin.H{
						"error":   "Failed to check namespace visibility",
						"details": visErr.Error(),
					})
					return
				}
				rolloutSchedules.Items = kubernetes.FilterByNamespace(rolloutSchedules.Items, func(s rolloutv1alpha1.RolloutSchedule) string { return s.Namespace }, allowedNS)
			}

			// Always get cluster schedules (they're cluster-scoped)
			clusterSchedules, err := k8sClient.GetClusterRolloutSchedules(context.Background())
			if err != nil {
				log.Printf("Error fetching cluster schedules: %v", err)
			}

			c.JSON(http.StatusOK, gin.H{
				"rolloutSchedules":        rolloutSchedules,
				"clusterRolloutSchedules": clusterSchedules,
			})
		})

		// Stream fleet change events (add/update/delete on the informer
		// cache's cached types — pkg/kubernetes/cache.go's cachedByObject)
		// using Server-Sent Events. PERF-2026-09-04 §C.6/C.7: lets the
		// frontend invalidate its TanStack queries the instant something
		// changes instead of polling on a timer. Same SSE plumbing as the
		// pod-logs stream below (gin-contrib/sse, manual flush, excluded
		// from gzip above) — this route only reads (kubernetes.Hub), so
		// unlike every mutating route in this file it never touches
		// getK8sWriteClient.
		api.GET("/events/stream", func(c *gin.Context) {
			id, ch := kubernetes.Hub.Register(32)
			defer kubernetes.Hub.Unregister(id)

			c.Header("Content-Type", sse.ContentType)
			c.Header("Cache-Control", "no-cache")
			c.Header("Connection", "keep-alive")
			c.Header("X-Accel-Buffering", "no")

			flush := func() {
				if f, ok := c.Writer.(http.Flusher); ok {
					f.Flush()
				}
			}
			flush() // establish the connection immediately

			ctx := c.Request.Context()
			heartbeat := time.NewTicker(30 * time.Second)
			defer heartbeat.Stop()

			for {
				select {
				case <-ctx.Done():
					return
				case batch, ok := <-ch:
					if !ok {
						// Hub dropped us for backpressure — our buffer was
						// full, meaning we weren't draining fast enough
						// (dead tab, slow network). `retry:` tells the
						// browser's EventSource how long to wait before it
						// reconnects on its own; a fresh connection gets a
						// clean buffer rather than this one growing forever.
						c.Writer.Write([]byte("retry: 5000\n\n"))
						flush()
						return
					}
					visible := kubernetes.FilterEventsByVisibility(c, batch)
					if len(visible) == 0 {
						continue
					}
					data, err := json.Marshal(visible)
					if err != nil {
						continue
					}
					sse.Encode(c.Writer, sse.Event{Event: "changes", Data: string(data)})
					flush()
				case <-heartbeat.C:
					sse.Encode(c.Writer, sse.Event{Event: "heartbeat", Data: "{}"})
					flush()
				}
			}
		})

		// Stream pod logs using Server-Sent Events
		api.GET("/rollouts/:namespace/:name/pods/logs", func(c *gin.Context) {
			k8sClient, ok := getK8sReadClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			if !requireRolloutVisibility(c, namespace) {
				return
			}
			name := c.Param("name")
			filterType := c.DefaultQuery("type", "")
			podName := c.Query("pod")
			containerName := c.DefaultQuery("container", "")

			// Set headers for SSE
			c.Header("Content-Type", sse.ContentType)
			c.Header("Cache-Control", "no-cache")
			c.Header("Connection", "keep-alive")
			c.Header("X-Accel-Buffering", "no")
			c.Writer.Header().Set("X-Timeout", "0")
			// Additional headers to prevent timeouts
			c.Writer.Header().Set("Keep-Alive", "timeout=60")
			c.Writer.Header().Set("X-Accel-Buffering", "no") // Disable nginx buffering

			// Ensure we can flush
			if flusher, ok := c.Writer.(http.Flusher); ok {
				flusher.Flush() // Initial flush to establish connection
			}

			// If specific pod is requested, stream only that pod (simple case)
			if podName != "" {
				clientset := k8sClient.GetClientset()
				if clientset == nil {
					sse.Encode(c.Writer, sse.Event{
						Event: "error",
						Data:  "Clientset not available",
					})
					if flusher, ok := c.Writer.(http.Flusher); ok {
						flusher.Flush()
					}
					return
				}

				opts := &corev1.PodLogOptions{
					Container: containerName,
					Follow:    true,
				}

				// If since timestamp is provided, fetch logs from that time
				if sinceStr := c.Query("since"); sinceStr != "" {
					if sinceMs, err := strconv.ParseInt(sinceStr, 10, 64); err == nil {
						// Convert milliseconds to seconds for Kubernetes API
						sinceTime := metav1.NewTime(time.Unix(sinceMs/1000, (sinceMs%1000)*1000000))
						opts.SinceTime = &sinceTime
					}
				}

				req := clientset.CoreV1().Pods(namespace).GetLogs(podName, opts)
				stream, err := req.Stream(context.Background())
				if err != nil {
					sse.Encode(c.Writer, sse.Event{
						Event: "error",
						Data:  fmt.Sprintf("Failed to stream logs: %v", err),
					})
					if flusher, ok := c.Writer.(http.Flusher); ok {
						flusher.Flush()
					}
					return
				}
				defer stream.Close()

				scanner := bufio.NewScanner(stream)
				for scanner.Scan() {
					if c.Request.Context().Err() != nil {
						return
					}
					line := scanner.Text()
					if line != "" {
						logLine := map[string]string{
							"pod":       podName,
							"container": containerName,
							"type":      filterType,
							"line":      line,
						}
						if jsonBytes, err := json.Marshal(logLine); err == nil {
							sse.Encode(c.Writer, sse.Event{
								Event: "log",
								Data:  string(jsonBytes),
							})
							if flusher, ok := c.Writer.(http.Flusher); ok {
								flusher.Flush()
							}
						}
					}
				}
				return
			}

			// Use the refactored log streaming service
			// For SSE, we need a context that doesn't timeout, but we still check
			// the request context to detect client disconnection
			requestCtx := c.Request.Context()
			// Create a context that won't be cancelled by request timeout
			// but will be cancelled if the request context is cancelled (client disconnect)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			// Monitor request context for client disconnection
			go func() {
				<-requestCtx.Done()
				cancel()
			}()

			// Get the rollout to find current version tag
			rollout, err := k8sClient.GetRollout(context.Background(), namespace, name)
			if err != nil {
				sse.Encode(c.Writer, sse.Event{
					Event: "error",
					Data:  fmt.Sprintf("Failed to fetch rollout: %v", err),
				})
				if flusher, ok := c.Writer.(http.Flusher); ok {
					flusher.Flush()
				}
				return
			}

			var currentVersionTag string
			if len(rollout.Status.History) > 0 {
				currentVersionTag = rollout.Status.History[0].Version.Tag
			}

			// Parse since timestamp if provided
			var sinceTime *time.Time
			if sinceStr := c.Query("since"); sinceStr != "" {
				if sinceMs, err := strconv.ParseInt(sinceStr, 10, 64); err == nil {
					t := time.Unix(sinceMs/1000, (sinceMs%1000)*1000000)
					sinceTime = &t
				}
			}

			// Create pod discovery and log streamer
			discovery := logs.NewPodDiscovery(k8sClient, namespace, name, currentVersionTag, filterType)
			streamer := logs.NewLogStreamer(k8sClient, discovery, ctx, sinceTime)

			// Start streaming
			if err := streamer.Start(); err != nil {
				sse.Encode(c.Writer, sse.Event{
					Event: "error",
					Data:  fmt.Sprintf("Failed to start streaming: %v", err),
				})
				if flusher, ok := c.Writer.(http.Flusher); ok {
					flusher.Flush()
				}
				return
			}
			defer streamer.Stop()

			// SSE writer goroutine
			sseChan := streamer.GetSSEChannel()
			var wg sync.WaitGroup
			var messagesSent int64

			wg.Add(1)
			go func() {
				defer wg.Done()
				for {
					select {
					case <-ctx.Done():
						return
					case msg, ok := <-sseChan:
						if !ok {
							return
						}
						func() {
							defer func() {
								if r := recover(); r != nil {
									// Panic while sending SSE event
								}
							}()
							messagesSent++

							// Use gin-contrib/sse for proper SSE encoding
							if err := sse.Encode(c.Writer, sse.Event{
								Event: msg.Event,
								Data:  msg.Data,
							}); err != nil {
								return
							}

							// Flush every message to ensure real-time delivery
							if flusher, ok := c.Writer.(http.Flusher); ok {
								flusher.Flush()
							}
						}()
					}
				}
			}()

			// Send initial keepalive immediately to establish connection
			streamer.SendKeepalive()

			// Keepalive ticker - send every 10 seconds to prevent timeouts
			ticker := time.NewTicker(10 * time.Second)
			defer ticker.Stop()

			keepaliveCount := 1 // Start at 1 since we sent initial

			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					keepaliveCount++
					streamer.SendKeepalive()
				}
			}
		})
	}

	// Serve frontend
	r.Use(static.Serve("/", static.LocalFile(os.Getenv("KO_DATA_PATH"), false)))
	r.NoRoute(func(c *gin.Context) {
		c.File(filepath.Join(os.Getenv("KO_DATA_PATH"), "index.html"))
	})

	// Start server. PORT overrides the default so the binary can be run locally
	// against a kubeconfig context while the dev cluster already holds :8080.
	addr := ":8080"
	if port := os.Getenv("PORT"); port != "" {
		addr = ":" + port
	}
	if err := r.Run(addr); err != nil {
		log.Printf("Failed to start server: %v", err)
		os.Exit(1)
	}
}
