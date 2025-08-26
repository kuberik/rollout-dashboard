package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"bytes"

	"github.com/docker/cli/cli/config"
	"github.com/docker/cli/cli/config/configfile"
	"github.com/gin-contrib/static"
	"github.com/gin-gonic/gin"
	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/crane"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
	"github.com/kuberik/rollout-dashboard/pkg/oci"
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
	// Initialize Kubernetes client
	k8sClient, err := kubernetes.NewClient()
	if err != nil {
		log.Printf("Failed to initialize Kubernetes client: %v", err)
		os.Exit(1)
	}

	r := gin.Default()

	// API routes under /api prefix
	api := r.Group("/api")
	{
		api.GET("/health", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"status": "ok",
			})
		})

		api.GET("/rollouts", func(c *gin.Context) {
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

			c.JSON(http.StatusOK, gin.H{
				"rollout":         rollout,
				"kustomizations":  kustomizations,
				"ociRepositories": ociRepositories,
			})
		})

		api.POST("/rollouts/:namespace/:name/pin", func(c *gin.Context) {
			namespace := c.Param("namespace")
			name := c.Param("name")

			var pinRequest struct {
				Version *string `json:"version"`
			}
			if err := c.ShouldBindJSON(&pinRequest); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{
					"error":   "Invalid request body",
					"details": err.Error(),
				})
				return
			}

			// Update the rollout with the new version
			updatedRollout, err := k8sClient.UpdateRolloutVersion(context.Background(), namespace, name, pinRequest.Version)
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

		// Add bypass-gates annotation to rollout
		api.POST("/rollouts/:namespace/:name/bypass-gates", func(c *gin.Context) {
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

		// Remove bypass-gates annotation from rollout
		api.DELETE("/rollouts/:namespace/:name/bypass-gates", func(c *gin.Context) {
			namespace := c.Param("namespace")
			name := c.Param("name")

			// Remove the bypass-gates annotation
			updatedRollout, err := k8sClient.RemoveBypassGatesAnnotation(context.Background(), namespace, name)
			if err != nil {
				log.Printf("Error removing bypass-gates annotation: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "Failed to remove bypass-gates annotation",
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

		api.GET("/rollouts/:namespace/:name/manifest/:version", func(c *gin.Context) {
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
		api.GET("/rollouts/:namespace/:name/health-checks", func(c *gin.Context) {
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
