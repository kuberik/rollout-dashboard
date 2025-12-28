package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"bytes"

	"sync"

	"github.com/docker/cli/cli/config"
	"github.com/docker/cli/cli/config/configfile"
	"github.com/gin-contrib/static"
	"github.com/gin-gonic/gin"
	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/crane"
	openkruisev1alpha1 "github.com/kuberik/openkruise-controller/api/v1alpha1"
	"github.com/kuberik/rollout-dashboard/pkg/auth"
	"github.com/kuberik/rollout-dashboard/pkg/oci"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
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
	r := gin.Default()

	// Apply token extraction middleware to all routes
	r.Use(auth.ExtractTokenMiddleware())

	// API routes under /api prefix
	api := r.Group("/api")
	{
		api.GET("/health", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"status": "ok",
			})
		})

		api.GET("/rollouts", func(c *gin.Context) {
			k8sClient, ok := getK8sClient(c)
			if !ok {
				return
			}

			namespace := c.DefaultQuery("namespace", "all")

			// Get Rollouts
			var rollouts interface{}
			var err error
			if namespace == "all" || namespace == "*" || namespace == "" {
				rollouts, err = k8sClient.GetRolloutsAllNamespaces(context.Background())
			} else {
				rollouts, err = k8sClient.GetRollouts(context.Background(), namespace)
			}
			if err != nil {
				log.Printf("Error fetching rollouts: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch rollouts",
					"details": err.Error(),
				})
				return
			}

			// Get associated Flux resources
			var imagePolicies interface{}
			if namespace == "all" || namespace == "*" || namespace == "" {
				imagePolicies, err = k8sClient.GetImagePoliciesAllNamespaces(context.Background())
			} else {
				imagePolicies, err = k8sClient.GetImagePolicies(context.Background(), namespace)
			}
			if err != nil {
				log.Printf("Error fetching image policies: %v", err)
			}

			var imageRepositories interface{}
			if namespace == "all" || namespace == "*" || namespace == "" {
				imageRepositories, err = k8sClient.GetImageRepositoriesAllNamespaces(context.Background())
			} else {
				imageRepositories, err = k8sClient.GetImageRepositories(context.Background(), namespace)
			}
			if err != nil {
				log.Printf("Error fetching image repositories: %v", err)
			}

			var kustomizations interface{}
			if namespace == "all" || namespace == "*" || namespace == "" {
				kustomizations, err = k8sClient.GetKustomizationsAllNamespaces(context.Background())
			} else {
				kustomizations, err = k8sClient.GetKustomizations(context.Background(), namespace)
			}
			if err != nil {
				log.Printf("Error fetching kustomizations: %v", err)
			}

			var ociRepositories interface{}
			if namespace == "all" || namespace == "*" || namespace == "" {
				ociRepositories, err = k8sClient.GetOCIRepositoriesAllNamespaces(context.Background())
			} else {
				ociRepositories, err = k8sClient.GetOCIRepositories(context.Background(), namespace)
			}
			if err != nil {
				log.Printf("Error fetching OCI repositories: %v", err)
			}

			c.JSON(http.StatusOK, gin.H{
				"rollouts":          rollouts,
				"imagePolicies":     imagePolicies,
				"imageRepositories": imageRepositories,
				"kustomizations":    kustomizations,
				"ociRepositories":   ociRepositories,
			})
		})

		api.GET("/rollouts/:namespace/:name", func(c *gin.Context) {
			k8sClient, ok := getK8sClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			name := c.Param("name")

			// Get Rollout
			rollout, err := k8sClient.GetRollout(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error fetching rollout: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch rollout",
					"details": err.Error(),
				})
				return
			}

			// Get associated Kustomizations that reference this rollout
			kustomizations, err := k8sClient.GetKustomizationsByRolloutAnnotation(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error fetching kustomizations: %v", err)
			}

			// Get associated OCIRepositories that reference this rollout
			ociRepositories, err := k8sClient.GetOCIRepositoriesByRolloutAnnotation(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error fetching OCI repositories: %v", err)
			}

			// Get associated RolloutGates that reference this rollout
			rolloutGates, err := k8sClient.GetRolloutGatesByRolloutReference(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error fetching rollout gates: %v", err)
			}

			// Get associated KuberikEnvironment that references this rollout
			environment, err := k8sClient.GetEnvironmentByRolloutReference(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error fetching environment: %v", err)
			}

			// Try to get the KruiseRollout (may not exist)
			// Note: We use interface{} since we don't import kruiserolloutv1beta1 in main.go
			var kruiseRollout interface{}
			kruiseRolloutObj, err := k8sClient.GetKruiseRollout(context.Background(), namespace, name)
			if err != nil {
				// KruiseRollout might not exist, that's okay
				kruiseRollout = nil
			} else {
				kruiseRollout = kruiseRolloutObj
			}

			// Get all RolloutTests in the namespace (they will be filtered by rollout name in frontend)
			// We fetch all tests and let the frontend filter by the actual KruiseRollout name
			rolloutTests, err := k8sClient.GetAllRolloutTests(context.Background(), namespace)
			if err != nil {
				log.Printf("Error fetching rollout tests: %v", err)
				// Continue without rollout tests if there's an error
				rolloutTests = nil
			}

			c.JSON(http.StatusOK, gin.H{
				"rollout":         rollout,
				"kustomizations":  kustomizations,
				"ociRepositories": ociRepositories,
				"rolloutGates":    rolloutGates,
				"environment":     environment,
				"kruiseRollout":   kruiseRollout,
				"rolloutTests":    rolloutTests,
			})
		})

		api.GET("/rollouts/:namespace/:name/environments", func(c *gin.Context) {
			k8sClient, ok := getK8sClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")

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
			k8sClient, ok := getK8sClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
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
			k8sClient, ok := getK8sClient(c)
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
			k8sClient, ok := getK8sClient(c)
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
			k8sClient, ok := getK8sClient(c)
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
			k8sClient, ok := getK8sClient(c)
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
			k8sClient, ok := getK8sClient(c)
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
			k8sClient, ok := getK8sClient(c)
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
			k8sClient, ok := getK8sClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			name := c.Param("name")

			// Reconcile all associated Flux resources
			err := k8sClient.ReconcileAllFluxResources(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error reconciling Flux resources: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to reconcile Flux resources",
					"details": err.Error(),
				})
				return
			}

			c.JSON(http.StatusOK, gin.H{
				"message": "Successfully triggered reconciliation of all associated Flux resources",
			})
		})

		// Continue OpenKruise rollout
		api.POST("/rollouts/:namespace/:name/continue", func(c *gin.Context) {
			k8sClient, ok := getK8sClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			name := c.Param("name")

			// Continue the OpenKruise rollout
			updatedRollout, err := k8sClient.ContinueKruiseRollout(context.Background(), namespace, name)
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

		api.GET("/rollouts/:namespace/:name/manifest/:version", func(c *gin.Context) {
			k8sClient, ok := getK8sClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
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

		// New endpoint to fetch the media type for a given version
		api.GET("/rollouts/:namespace/:name/mediatype/:version", func(c *gin.Context) {
			k8sClient, ok := getK8sClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
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
			k8sClient, ok := getK8sClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
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
			k8sClient, ok := getK8sClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
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
			k8sClient, ok := getK8sClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			name := c.Param("name")

			// Get the Kustomization first to check its inventory
			kustomization, err := k8sClient.GetKustomization(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error fetching kustomization: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch kustomization",
					"details": err.Error(),
				})
				return
			}

			// Get managed resources for the Kustomization
			managedResources, err := k8sClient.GetKustomizationManagedResources(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error fetching managed resources: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to fetch managed resources",
					"details": err.Error(),
				})
				return
			}

			// Add debug information
			response := gin.H{
				"managedResources": managedResources,
				"debug": gin.H{
					"hasInventory": kustomization.Status.Inventory != nil,
					"inventoryEntries": func() []string {
						if kustomization.Status.Inventory == nil {
							return []string{}
						}
						entries := make([]string, len(kustomization.Status.Inventory.Entries))
						for i, entry := range kustomization.Status.Inventory.Entries {
							entries[i] = entry.ID
						}
						return entries
					}(),
				},
			}

			c.JSON(http.StatusOK, response)
		})

		api.GET("/kustomizations/:namespace/:name/test", func(c *gin.Context) {
			k8sClient, ok := getK8sClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
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

		// New endpoint to fetch health checks for a rollout
		// Check permissions for a rollout action
		api.GET("/rollouts/:namespace/:name/permissions", func(c *gin.Context) {
			k8sClient, ok := getK8sClient(c)
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
			k8sClient, ok := getK8sClient(c)
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
			k8sClient, ok := getK8sClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
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

		// Stream pod logs using Server-Sent Events
		api.GET("/rollouts/:namespace/:name/pods/logs", func(c *gin.Context) {
			k8sClient, ok := getK8sClient(c)
			if !ok {
				return
			}

			namespace := c.Param("namespace")
			name := c.Param("name")
			filterType := c.DefaultQuery("type", "")
			podName := c.Query("pod")
			containerName := c.DefaultQuery("container", "")

			log.Printf("[Stream Logs] Starting stream for %s/%s, filterType=%s", namespace, name, filterType)

			// Set headers for SSE
			c.Header("Content-Type", "text/event-stream")
			c.Header("Cache-Control", "no-cache")
			c.Header("Connection", "keep-alive")
			c.Header("X-Accel-Buffering", "no")
			// Prevent timeout - set a very long timeout or disable it
			c.Writer.Header().Set("X-Timeout", "0")

			// If specific pod is requested, stream only that pod
			if podName != "" {
				clientset := k8sClient.GetClientset()
				if clientset == nil {
					c.SSEvent("error", "Clientset not available")
					return
				}

				opts := &corev1.PodLogOptions{
					Container: containerName,
					Follow:    true,
				}

				req := clientset.CoreV1().Pods(namespace).GetLogs(podName, opts)
				stream, err := req.Stream(context.Background())
				if err != nil {
					c.SSEvent("error", fmt.Sprintf("Failed to stream logs: %v", err))
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
							c.SSEvent("log", string(jsonBytes))
							c.Writer.Flush()
						}
					}
				}
				return
			}

			// Get the rollout to find current version tag
			rollout, err := k8sClient.GetRollout(context.Background(), namespace, name)
			if err != nil {
				log.Printf("[Stream Logs] Error fetching rollout: %v", err)
				c.SSEvent("error", fmt.Sprintf("Failed to fetch rollout: %v", err))
				return
			}

			var currentVersionTag string
			if len(rollout.Status.History) > 0 {
				currentVersionTag = rollout.Status.History[0].Version.Tag
			}
			log.Printf("[Stream Logs] Rollout: %s/%s, Current version tag: %s, Filter type: %s", namespace, name, currentVersionTag, filterType)

			// Helper function to check if pod contains version tag
			containsVersionTag := func(pod *corev1.Pod, versionTag string) bool {
				if versionTag == "" {
					return true
				}
				for key, value := range pod.Labels {
					if strings.Contains(key, versionTag) || strings.Contains(value, versionTag) {
						return true
					}
				}
				for key, value := range pod.Annotations {
					if strings.Contains(key, versionTag) || strings.Contains(value, versionTag) {
						return true
					}
				}
				for _, container := range pod.Spec.Containers {
					if strings.Contains(container.Image, versionTag) {
						return true
					}
				}
				return false
			}

			type PodInfo struct {
				Name      string `json:"name"`
				Namespace string `json:"namespace"`
				Type      string `json:"type"`
			}
			allPods := make([]PodInfo, 0)

			// Get pods from deployments in kustomization inventory
			if filterType == "" || filterType == "pod" {
				log.Printf("[Stream Logs] Fetching kustomizations for pods")
				kustomizations, err := k8sClient.GetKustomizationsByRolloutAnnotation(context.Background(), namespace, name)
				if err != nil {
					log.Printf("[Stream Logs] Error fetching kustomizations: %v", err)
				} else if kustomizations == nil {
					log.Printf("[Stream Logs] No kustomizations found")
				} else {
					log.Printf("[Stream Logs] Found %d kustomizations", len(kustomizations.Items))
				}
				if err == nil && kustomizations != nil {
					for _, kustomization := range kustomizations.Items {
						log.Printf("[Stream Logs] Processing kustomization: %s/%s", kustomization.Namespace, kustomization.Name)
						managedResources, err := k8sClient.GetKustomizationManagedResources(context.Background(), kustomization.Namespace, kustomization.Name)
						if err != nil {
							log.Printf("[Stream Logs] Error fetching managed resources: %v", err)
							continue
						}
						log.Printf("[Stream Logs] Found %d managed resources", len(managedResources))

						for _, resource := range managedResources {
							if strings.Contains(resource.GroupVersionKind, "apps/v1/Deployment") {
								log.Printf("[Stream Logs] Found Deployment: %s/%s", resource.Namespace, resource.Name)
								obj := resource.Object
								if obj != nil {
									// Unmarshal to Deployment to get selector
									var deployment appsv1.Deployment
									if err := runtime.DefaultUnstructuredConverter.FromUnstructured(obj.Object, &deployment); err != nil {
										log.Printf("[Stream Logs] Error unmarshaling deployment: %v", err)
										continue
									}

									// Get selector labels (these are what pods actually have)
									selectorLabels := deployment.Spec.Selector.MatchLabels
									log.Printf("[Stream Logs] Deployment selector labels: %v", selectorLabels)

									allPodsList, err := k8sClient.GetAllPods(context.Background(), resource.Namespace)
									if err != nil {
										log.Printf("[Stream Logs] Error fetching pods: %v", err)
									} else {
										log.Printf("[Stream Logs] Found %d total pods in namespace %s", len(allPodsList.Items), resource.Namespace)
									}
									if err == nil {
										matchedCount := 0
										for _, pod := range allPodsList.Items {
											podMatches := true
											for key, value := range selectorLabels {
												if pod.Labels[key] != value {
													podMatches = false
													break
												}
											}
											if podMatches {
												matchedCount++
												if containsVersionTag(&pod, currentVersionTag) {
													log.Printf("[Stream Logs] Pod %s matches version tag %s", pod.Name, currentVersionTag)
													allPods = append(allPods, PodInfo{
														Name:      pod.Name,
														Namespace: pod.Namespace,
														Type:      "pod",
													})
												} else {
													log.Printf("[Stream Logs] Pod %s does not match version tag %s", pod.Name, currentVersionTag)
												}
											}
										}
										log.Printf("[Stream Logs] Matched %d pods by selector labels, %d matched version tag", matchedCount, len(allPods))
									}
								}
							}
						}
					}
				}
			}

			// Get pods from RolloutTest jobs (from kustomize inventory)
			if filterType == "" || filterType == "test" {
				log.Printf("[Stream Logs] Fetching rollout tests from kustomize inventory")
				kustomizations, err := k8sClient.GetKustomizationsByRolloutAnnotation(context.Background(), namespace, name)
				if err == nil && kustomizations != nil {
					for _, kustomization := range kustomizations.Items {
						managedResources, err := k8sClient.GetKustomizationManagedResources(context.Background(), kustomization.Namespace, kustomization.Name)
						if err != nil {
							log.Printf("[Stream Logs] Error fetching managed resources for tests: %v", err)
							continue
						}

						for _, resource := range managedResources {
							// Look for RolloutTest resources
							if strings.Contains(resource.GroupVersionKind, "RolloutTest") {
								log.Printf("[Stream Logs] Found RolloutTest: %s/%s", resource.Namespace, resource.Name)
								obj := resource.Object
								if obj != nil {
									// Get the RolloutTest to find its job
									var rolloutTest openkruisev1alpha1.RolloutTest
									if err := runtime.DefaultUnstructuredConverter.FromUnstructured(obj.Object, &rolloutTest); err != nil {
										log.Printf("[Stream Logs] Error unmarshaling RolloutTest: %v", err)
										continue
									}

									if rolloutTest.Status.JobName != "" {
										jobName := rolloutTest.Status.JobName
										log.Printf("[Stream Logs] Processing test job: %s", jobName)
										// Query pods directly by batch.kubernetes.io/job-name label instead of fetching the job (which may be cleaned up)
										selector, err := labels.Parse(fmt.Sprintf("batch.kubernetes.io/job-name=%s", jobName))
										if err != nil {
											log.Printf("[Stream Logs] Error creating selector for job %s: %v", jobName, err)
										} else {
											pods, err := k8sClient.GetPodsBySelector(context.Background(), namespace, selector)
											if err != nil {
												log.Printf("[Stream Logs] Error fetching pods for job %s: %v", jobName, err)
											} else if pods == nil {
												log.Printf("[Stream Logs] No pods found for job %s", jobName)
											} else {
												log.Printf("[Stream Logs] Found %d pods for job %s", len(pods.Items), jobName)
												for _, pod := range pods.Items {
													allPods = append(allPods, PodInfo{
														Name:      pod.Name,
														Namespace: pod.Namespace,
														Type:      "test",
													})
												}
											}
										}
									} else {
										log.Printf("[Stream Logs] RolloutTest %s/%s has no job name in status", resource.Namespace, resource.Name)
									}
								}
							}
						}
					}
				} else if err != nil {
					log.Printf("[Stream Logs] Error fetching kustomizations for tests: %v", err)
				}
			}

			log.Printf("[Stream Logs] Total pods found: %d", len(allPods))
			// Send initial pods list
			if podsJSON, err := json.Marshal(allPods); err == nil {
				c.SSEvent("pods", string(podsJSON))
				c.Writer.Flush()
			} else {
				log.Printf("[Stream Logs] Error marshaling pods: %v", err)
			}

			// Stream logs from all pods concurrently
			clientset := k8sClient.GetClientset()
			if clientset == nil {
				c.SSEvent("error", "Clientset not available")
				return
			}

			// Use request context - it stays alive as long as the SSE connection is open
			// Don't create a child context that gets cancelled
			ctx := c.Request.Context()

			// Use a wait group to track goroutines
			var wg sync.WaitGroup

			// Get all pods to stream from
			type StreamPod struct {
				Pod       *corev1.Pod
				PodType   string
				Container string
			}
			streamPods := make([]StreamPod, 0)
			for _, podInfo := range allPods {
				pods, err := k8sClient.GetAllPods(context.Background(), podInfo.Namespace)
				if err != nil {
					log.Printf("[Stream Logs] Error fetching pods for namespace %s: %v", podInfo.Namespace, err)
					continue
				}
				for _, pod := range pods.Items {
					if pod.Name == podInfo.Name {
						log.Printf("[Stream Logs] Found pod %s with %d containers", pod.Name, len(pod.Spec.Containers))
						for _, container := range pod.Spec.Containers {
							streamPods = append(streamPods, StreamPod{
								Pod:       &pod,
								PodType:   podInfo.Type,
								Container: container.Name,
							})
						}
						break
					}
				}
			}

			log.Printf("[Stream Logs] Starting streams for %d pod/container combinations", len(streamPods))

			// Channel to serialize all SSE writes (Gin context is not thread-safe)
			type sseMessage struct {
				event string
				data  string
			}
			sseChan := make(chan sseMessage, 1000)

			// Single goroutine to handle all SSE writes
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
						// Serialize all SSE writes through this single goroutine
						func() {
							defer func() {
								if r := recover(); r != nil {
									log.Printf("[Stream Logs] Panic while sending SSE event (connection closed): %v", r)
								}
							}()
							c.SSEvent(msg.event, msg.data)
							if c.Writer != nil {
								c.Writer.Flush()
							}
						}()
					}
				}
			}()

			// Stream from each pod/container in a goroutine
			for _, streamPod := range streamPods {
				wg.Add(1)
				go func(sp StreamPod) {
					defer wg.Done()
					log.Printf("[Stream Logs] Starting stream for pod %s container %s", sp.Pod.Name, sp.Container)
					// Use background context for the log stream itself, but check request context for cancellation
					streamCtx := context.Background()
					opts := &corev1.PodLogOptions{
						Container: sp.Container,
						Follow:    true,
					}
					req := clientset.CoreV1().Pods(sp.Pod.Namespace).GetLogs(sp.Pod.Name, opts)
					stream, err := req.Stream(streamCtx)
					if err != nil {
						log.Printf("[Stream Logs] Error streaming logs for pod %s container %s: %v", sp.Pod.Name, sp.Container, err)
						return
					}
					defer stream.Close()

					lineCount := 0
					scanner := bufio.NewScanner(stream)
					for scanner.Scan() {
						// Check if request context is cancelled (client disconnected)
						select {
						case <-ctx.Done():
							log.Printf("[Stream Logs] Request context cancelled for pod %s container %s", sp.Pod.Name, sp.Container)
							return
						default:
						}

						line := scanner.Text()
						if line != "" {
							lineCount++
							if lineCount%100 == 0 {
								log.Printf("[Stream Logs] Streamed %d lines from pod %s container %s", lineCount, sp.Pod.Name, sp.Container)
							}
							logLine := map[string]string{
								"pod":       sp.Pod.Name,
								"container": sp.Container,
								"type":      sp.PodType,
								"line":      line,
							}
							if jsonBytes, err := json.Marshal(logLine); err == nil {
								// Send to channel instead of writing directly
								select {
								case <-ctx.Done():
									return
								case sseChan <- sseMessage{event: "log", data: string(jsonBytes)}:
									// Successfully queued
								default:
									// Channel full, skip this line to avoid blocking
									log.Printf("[Stream Logs] SSE channel full, dropping log line from pod %s", sp.Pod.Name)
								}
							} else {
								log.Printf("[Stream Logs] Error marshaling log line: %v", err)
							}
						}
					}
					if err := scanner.Err(); err != nil {
						log.Printf("[Stream Logs] Scanner error for pod %s container %s: %v", sp.Pod.Name, sp.Container, err)
					}
					log.Printf("[Stream Logs] Finished streaming from pod %s container %s (total lines: %d)", sp.Pod.Name, sp.Container, lineCount)
				}(streamPod)
			}

			// Keep connection alive with periodic pings while waiting for context cancellation
			// Use shorter interval to prevent timeouts
			ticker := time.NewTicker(15 * time.Second)
			defer ticker.Stop()

			// Keep sending keepalive pings until context is cancelled
			// This loop keeps the connection alive
			for {
				select {
				case <-ctx.Done():
					log.Printf("[Stream Logs] Connection closed, context cancelled")
					goto cleanup
				case <-ticker.C:
					// Send keepalive ping through the channel
					select {
					case <-ctx.Done():
						log.Printf("[Stream Logs] Connection closed, context cancelled")
						goto cleanup
					case sseChan <- sseMessage{event: "ping", data: "keepalive"}:
						// Successfully queued
					default:
						// Channel full, skip keepalive but don't exit
					}
				}
			}
		cleanup:
			// Close the SSE channel to signal the writer goroutine to stop
			close(sseChan)

			// Wait a bit for goroutines to finish, but don't block forever
			done := make(chan struct{})
			go func() {
				wg.Wait()
				close(done)
			}()

			select {
			case <-done:
				log.Printf("[Stream Logs] All streams finished")
			case <-time.After(5 * time.Second):
				log.Printf("[Stream Logs] Timeout waiting for streams to finish")
			}
		})
	}

	// Serve frontend
	r.Use(static.Serve("/", static.LocalFile(os.Getenv("KO_DATA_PATH"), false)))
	r.NoRoute(func(c *gin.Context) {
		c.File(filepath.Join(os.Getenv("KO_DATA_PATH"), "index.html"))
	})

	// Start server
	if err := r.Run(":8080"); err != nil {
		log.Printf("Failed to start server: %v", err)
		os.Exit(1)
	}
}
