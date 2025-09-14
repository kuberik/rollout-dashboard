package kubernetes

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
	"sigs.k8s.io/cli-utils/pkg/kstatus/status"
	"sigs.k8s.io/cli-utils/pkg/object"
	"sigs.k8s.io/controller-runtime/pkg/client"

	imagereflectorv1beta2 "github.com/fluxcd/image-reflector-controller/api/v1beta2"
	kustomizev1 "github.com/fluxcd/kustomize-controller/api/v1"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	kruiserolloutv1beta1 "github.com/openkruise/kruise-rollout-api/rollouts/v1beta1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type Client struct {
	client client.Client
}

func NewClient() (*Client, error) {
	var config *rest.Config
	var err error

	// First try in-cluster config
	config, err = rest.InClusterConfig()
	if err != nil {
		// If in-cluster config fails, try local kubeconfig
		var kubeconfig string
		if home := homedir.HomeDir(); home != "" {
			kubeconfig = filepath.Join(home, ".kube", "config")
		} else {
			kubeconfig = os.Getenv("KUBECONFIG")
		}

		config, err = clientcmd.BuildConfigFromFlags("", kubeconfig)
		if err != nil {
			return nil, fmt.Errorf("failed to get kubeconfig: %w", err)
		}
	}

	scheme := runtime.NewScheme()

	// Add core Kubernetes scheme (includes v1.Secret, v1.Pod, etc.)
	if err := corev1.AddToScheme(scheme); err != nil {
		return nil, fmt.Errorf("failed to add core scheme: %w", err)
	}

	if err := rolloutv1alpha1.AddToScheme(scheme); err != nil {
		return nil, fmt.Errorf("failed to add scheme: %w", err)
	}
	if err := imagereflectorv1beta2.AddToScheme(scheme); err != nil {
		return nil, fmt.Errorf("failed to add image reflector scheme: %w", err)
	}
	if err := kustomizev1.AddToScheme(scheme); err != nil {
		return nil, fmt.Errorf("failed to add kustomize scheme: %w", err)
	}
	if err := sourcev1.AddToScheme(scheme); err != nil {
		return nil, fmt.Errorf("failed to add source scheme: %w", err)
	}
	if err := kruiserolloutv1beta1.AddToScheme(scheme); err != nil {
		return nil, fmt.Errorf("failed to add kruise rollout scheme: %w", err)
	}

	cl, err := client.New(config, client.Options{Scheme: scheme})
	if err != nil {
		return nil, fmt.Errorf("failed to create client: %w", err)
	}

	return &Client{client: cl}, nil
}

func (c *Client) GetRollouts(ctx context.Context, namespace string) (*rolloutv1alpha1.RolloutList, error) {
	rollouts := &rolloutv1alpha1.RolloutList{}
	if err := c.client.List(ctx, rollouts, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list rollouts: %w", err)
	}
	return rollouts, nil
}

// New: list rollouts across all namespaces
func (c *Client) GetRolloutsAllNamespaces(ctx context.Context) (*rolloutv1alpha1.RolloutList, error) {
	rollouts := &rolloutv1alpha1.RolloutList{}
	if err := c.client.List(ctx, rollouts); err != nil {
		return nil, fmt.Errorf("failed to list rollouts across all namespaces: %w", err)
	}
	return rollouts, nil
}

func (c *Client) GetRollout(ctx context.Context, namespace, name string) (*rolloutv1alpha1.Rollout, error) {
	rollout := &rolloutv1alpha1.Rollout{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, rollout); err != nil {
		return nil, fmt.Errorf("failed to get rollout: %w", err)
	}
	return rollout, nil
}

func (c *Client) UpdateRolloutVersion(ctx context.Context, namespace, name string, version *string, explanation string) (*rolloutv1alpha1.Rollout, error) {
	// Create an unstructured patch object with the spec.wantedVersion field and annotations
	patch := &unstructured.Unstructured{}
	patch.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "kuberik.com",
		Version: "v1alpha1",
		Kind:    "Rollout",
	})
	patch.SetNamespace(namespace)
	patch.SetName(name)

	// Set the wantedVersion field
	if version != nil {
		patch.Object["spec"] = map[string]any{
			"wantedVersion": *version,
		}
	} else {
		// If version is nil, we're clearing the field
		patch.Object["spec"] = map[string]any{
			"wantedVersion": nil,
		}
	}

	// Set annotations if explanation is provided
	if explanation != "" {
		annotations := map[string]string{
			"rollout.kuberik.com/deployment-message": explanation,
		}
		patch.SetAnnotations(annotations)
	}

	// Use server-side apply to update the wantedVersion field and annotations
	// This ensures proper field ownership and prevents conflicts
	// If the dashboard doesn't own the field, the patch will fail naturally
	if err := c.client.Patch(ctx, patch, client.Merge, client.FieldOwner("rollout-dashboard")); err != nil {
		return nil, fmt.Errorf("failed to update rollout wantedVersion using server-side apply: %w", err)
	}

	// Get the updated rollout to return
	updatedRollout := &rolloutv1alpha1.Rollout{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, updatedRollout); err != nil {
		return nil, fmt.Errorf("failed to get updated rollout: %w", err)
	}

	return updatedRollout, nil
}

// ContinueKruiseRollout updates the currentStepState of an OpenKruise rollout to continue the rollout
func (c *Client) ContinueKruiseRollout(ctx context.Context, namespace, name string) (*kruiserolloutv1beta1.Rollout, error) {
	// Create an unstructured patch object with the status.currentStepState field
	patch := &unstructured.Unstructured{}
	patch.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "rollouts.kruise.io",
		Version: "v1beta1",
		Kind:    "Rollout",
	})
	patch.SetNamespace(namespace)
	patch.SetName(name)

	// Set the currentStepState to StepReady to continue the rollout
	patch.Object["status"] = map[string]any{
		"canaryStatus": map[string]any{
			"currentStepState": kruiserolloutv1beta1.CanaryStepStateReady,
		},
	}

	// Use server-side apply to update the status field
	if err := c.client.Status().Patch(ctx, patch, client.Merge, client.FieldOwner("rollout-dashboard")); err != nil {
		return nil, fmt.Errorf("failed to continue kruise rollout using server-side apply: %w", err)
	}

	// Get the updated rollout to return
	updatedRollout := &kruiserolloutv1beta1.Rollout{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, updatedRollout); err != nil {
		return nil, fmt.Errorf("failed to get updated kruise rollout: %w", err)
	}

	return updatedRollout, nil
}

// AddBypassGatesAnnotation adds the rollout.kuberik.com/bypass-gates annotation to a rollout
// This allows the rollout to bypass gate checks for a specific version
func (c *Client) AddBypassGatesAnnotation(ctx context.Context, namespace, name string, version string) (*rolloutv1alpha1.Rollout, error) {
	// Create an unstructured patch object with only the annotation
	patch := &unstructured.Unstructured{}
	patch.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "kuberik.com",
		Version: "v1alpha1",
		Kind:    "Rollout",
	})
	patch.SetNamespace(namespace)
	patch.SetName(name)

	// Set the bypass-gates annotation with the specific version
	patch.SetAnnotations(map[string]string{
		"rollout.kuberik.com/bypass-gates": version,
	})

	// Use server-side apply to update only the annotation
	if err := c.client.Patch(ctx, patch, client.Merge, client.FieldOwner("rollout-dashboard")); err != nil {
		return nil, fmt.Errorf("failed to add bypass-gates annotation using server-side apply: %w", err)
	}

	// Get the updated rollout to return
	updatedRollout := &rolloutv1alpha1.Rollout{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, updatedRollout); err != nil {
		return nil, fmt.Errorf("failed to get updated rollout: %w", err)
	}

	return updatedRollout, nil
}

// AddUnblockFailedAnnotation adds the rollout.kuberik.com/unblock-failed annotation to a rollout
// This allows the rollout to resume after a failed bake
func (c *Client) AddUnblockFailedAnnotation(ctx context.Context, namespace, name string) (*rolloutv1alpha1.Rollout, error) {
	// Create an unstructured patch object with only the annotation
	patch := &unstructured.Unstructured{}
	patch.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "kuberik.com",
		Version: "v1alpha1",
		Kind:    "Rollout",
	})
	patch.SetNamespace(namespace)
	patch.SetName(name)

	// Set the unblock-failed annotation to true
	patch.SetAnnotations(map[string]string{
		"rollout.kuberik.com/unblock-failed": "true",
	})

	// Use server-side apply to update only the annotation
	if err := c.client.Patch(ctx, patch, client.Merge, client.FieldOwner("rollout-dashboard")); err != nil {
		return nil, fmt.Errorf("failed to add unblock-failed annotation using server-side apply: %w", err)
	}

	// Get the updated rollout to return
	updatedRollout := &rolloutv1alpha1.Rollout{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, updatedRollout); err != nil {
		return nil, fmt.Errorf("failed to get updated rollout: %w", err)
	}

	return updatedRollout, nil
}

func (c *Client) GetSecret(ctx context.Context, namespace, name string) (*corev1.Secret, error) {
	secret := &corev1.Secret{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, secret); err != nil {
		return nil, fmt.Errorf("failed to get secret: %w", err)
	}
	return secret, nil
}

func (c *Client) GetImagePolicies(ctx context.Context, namespace string) (*imagereflectorv1beta2.ImagePolicyList, error) {
	imagePolicies := &imagereflectorv1beta2.ImagePolicyList{}
	if err := c.client.List(ctx, imagePolicies, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list image policies: %w", err)
	}
	return imagePolicies, nil
}

// New: list image policies across all namespaces
func (c *Client) GetImagePoliciesAllNamespaces(ctx context.Context) (*imagereflectorv1beta2.ImagePolicyList, error) {
	imagePolicies := &imagereflectorv1beta2.ImagePolicyList{}
	if err := c.client.List(ctx, imagePolicies); err != nil {
		return nil, fmt.Errorf("failed to list image policies across all namespaces: %w", err)
	}
	return imagePolicies, nil
}

func (c *Client) GetImageRepositories(ctx context.Context, namespace string) (*imagereflectorv1beta2.ImageRepositoryList, error) {
	imageRepositories := &imagereflectorv1beta2.ImageRepositoryList{}
	if err := c.client.List(ctx, imageRepositories, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list image repositories: %w", err)
	}
	return imageRepositories, nil
}

// New: list image repositories across all namespaces
func (c *Client) GetImageRepositoriesAllNamespaces(ctx context.Context) (*imagereflectorv1beta2.ImageRepositoryList, error) {
	imageRepositories := &imagereflectorv1beta2.ImageRepositoryList{}
	if err := c.client.List(ctx, imageRepositories); err != nil {
		return nil, fmt.Errorf("failed to list image repositories across all namespaces: %w", err)
	}
	return imageRepositories, nil
}

func (c *Client) GetKustomizations(ctx context.Context, namespace string) (*kustomizev1.KustomizationList, error) {
	kustomizations := &kustomizev1.KustomizationList{}
	if err := c.client.List(ctx, kustomizations, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list kustomizations: %w", err)
	}
	return kustomizations, nil
}

// New: list kustomizations across all namespaces
func (c *Client) GetKustomizationsAllNamespaces(ctx context.Context) (*kustomizev1.KustomizationList, error) {
	kustomizations := &kustomizev1.KustomizationList{}
	if err := c.client.List(ctx, kustomizations); err != nil {
		return nil, fmt.Errorf("failed to list kustomizations across all namespaces: %w", err)
	}
	return kustomizations, nil
}

func (c *Client) GetOCIRepositories(ctx context.Context, namespace string) (*sourcev1.OCIRepositoryList, error) {
	ociRepositories := &sourcev1.OCIRepositoryList{}
	if err := c.client.List(ctx, ociRepositories, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list OCI repositories: %w", err)
	}
	return ociRepositories, nil
}

// New: list OCI repositories across all namespaces
func (c *Client) GetOCIRepositoriesAllNamespaces(ctx context.Context) (*sourcev1.OCIRepositoryList, error) {
	ociRepositories := &sourcev1.OCIRepositoryList{}
	if err := c.client.List(ctx, ociRepositories); err != nil {
		return nil, fmt.Errorf("failed to list OCI repositories across all namespaces: %w", err)
	}
	return ociRepositories, nil
}

func (c *Client) GetImagePolicy(ctx context.Context, namespace, name string) (*imagereflectorv1beta2.ImagePolicy, error) {
	imagePolicy := &imagereflectorv1beta2.ImagePolicy{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, imagePolicy); err != nil {
		return nil, fmt.Errorf("failed to get image policy: %w", err)
	}
	return imagePolicy, nil
}

func (c *Client) GetImageRepository(ctx context.Context, namespace, name string) (*imagereflectorv1beta2.ImageRepository, error) {
	imageRepository := &imagereflectorv1beta2.ImageRepository{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, imageRepository); err != nil {
		return nil, fmt.Errorf("failed to get image repository: %w", err)
	}
	return imageRepository, nil
}

func (c *Client) GetKustomizationsByRolloutAnnotation(ctx context.Context, namespace, rolloutName string) (*kustomizev1.KustomizationList, error) {
	kustomizations := &kustomizev1.KustomizationList{}
	if err := c.client.List(ctx, kustomizations, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list kustomizations: %w", err)
	}

	// Get OCIRepositories that reference this rollout
	ociRepositories, err := c.GetOCIRepositoriesByRolloutAnnotation(ctx, namespace, rolloutName)
	if err != nil {
		return nil, fmt.Errorf("failed to get OCI repositories: %w", err)
	}

	// Create a map of OCI repository names for quick lookup
	ociRepoNames := make(map[string]bool)
	for _, ociRepo := range ociRepositories.Items {
		ociRepoNames[ociRepo.Name] = true
	}

	// Filter kustomizations that reference the rollout through annotations
	// or reference OCIRepositories that have rollout annotations
	filteredKustomizations := &kustomizev1.KustomizationList{}
	for _, kustomization := range kustomizations.Items {
		// Check for rollout.kuberik.com/substitute.<variable>.from: <rollout> annotation
		// This format allows kustomizations to specify which rollout they get variables from
		// Example: rollout.kuberik.com/substitute.HELLO_WORLD_VERSION.from: "hello-world-app"
		for annotationKey, annotationValue := range kustomization.Annotations {
			if strings.HasPrefix(annotationKey, "rollout.kuberik.com/substitute.") &&
				strings.HasSuffix(annotationKey, ".from") &&
				annotationValue == rolloutName {
				filteredKustomizations.Items = append(filteredKustomizations.Items, kustomization)
				break
			}
		}

		// Check if this kustomization references an OCIRepository that has the rollout annotation
		if kustomization.Spec.SourceRef.Kind == "OCIRepository" &&
			kustomization.Spec.SourceRef.Name != "" &&
			ociRepoNames[kustomization.Spec.SourceRef.Name] {
			filteredKustomizations.Items = append(filteredKustomizations.Items, kustomization)
		}
	}

	return filteredKustomizations, nil
}

func (c *Client) GetOCIRepositoriesByRolloutAnnotation(ctx context.Context, namespace, rolloutName string) (*sourcev1.OCIRepositoryList, error) {
	ociRepositories := &sourcev1.OCIRepositoryList{}
	if err := c.client.List(ctx, ociRepositories, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list OCI repositories: %w", err)
	}

	// Filter OCI repositories that reference the rollout through annotations
	filteredOCIRepositories := &sourcev1.OCIRepositoryList{}
	for _, ociRepository := range ociRepositories.Items {
		// Check for rollout.kuberik.com/rollout annotation
		if annotationValue, exists := ociRepository.Annotations["rollout.kuberik.com/rollout"]; exists && annotationValue == rolloutName {
			filteredOCIRepositories.Items = append(filteredOCIRepositories.Items, ociRepository)
		}
	}

	return filteredOCIRepositories, nil
}

func (c *Client) GetKustomization(ctx context.Context, namespace, name string) (*kustomizev1.Kustomization, error) {
	kustomization := &kustomizev1.Kustomization{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, kustomization); err != nil {
		return nil, fmt.Errorf("failed to get kustomization: %w", err)
	}
	return kustomization, nil
}

type ManagedResourceStatus struct {
	GroupVersionKind string                     `json:"groupVersionKind"`
	Name             string                     `json:"name"`
	Namespace        string                     `json:"namespace"`
	Status           string                     `json:"status"`
	Message          string                     `json:"message"`
	LastModified     time.Time                  `json:"lastModified"`
	Object           *unstructured.Unstructured `json:"object"`
}

func (c *Client) GetKustomizationManagedResources(ctx context.Context, namespace, name string) ([]ManagedResourceStatus, error) {
	// Get the Kustomization
	kustomization := &kustomizev1.Kustomization{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, kustomization); err != nil {
		return nil, fmt.Errorf("failed to get kustomization: %w", err)
	}

	// Get the inventory from the Kustomization status
	if kustomization.Status.Inventory == nil {
		fmt.Printf("Kustomization %s/%s has no inventory\n", namespace, name)
		return []ManagedResourceStatus{}, nil
	}

	fmt.Printf("Kustomization %s/%s inventory has %d entries\n", namespace, name, len(kustomization.Status.Inventory.Entries))

	var managedResources []ManagedResourceStatus

	// Process each entry in the inventory
	for i, entry := range kustomization.Status.Inventory.Entries {
		fmt.Printf("Processing inventory entry %d: %s\n", i, entry.ID)

		// Use Flux's object.ParseObjMetadata to parse the inventory ID
		objMetadata, err := object.ParseObjMetadata(entry.ID)
		if err != nil {
			fmt.Printf("Failed to parse inventory entry %s: %v\n", entry.ID, err)
			continue
		}

		fmt.Printf("Parsed: namespace=%s, name=%s, group=%s, kind=%s\n",
			objMetadata.Namespace, objMetadata.Name, objMetadata.GroupKind.Group, objMetadata.GroupKind.Kind)

		// Get the resource
		obj := &unstructured.Unstructured{}
		obj.SetGroupVersionKind(schema.GroupVersionKind{
			Group:   objMetadata.GroupKind.Group,
			Version: entry.Version,
			Kind:    objMetadata.GroupKind.Kind,
		})

		err = c.client.Get(ctx, client.ObjectKey{Namespace: objMetadata.Namespace, Name: objMetadata.Name}, obj)
		if err != nil {
			fmt.Printf("Failed to get resource %s/%s: %v\n", objMetadata.Namespace, objMetadata.Name, err)
			// Resource not found or error
			managedResources = append(managedResources, ManagedResourceStatus{
				GroupVersionKind: fmt.Sprintf("%s/%s/%s", objMetadata.GroupKind.Group, entry.Version, objMetadata.GroupKind.Kind),
				Name:             objMetadata.Name,
				Namespace:        objMetadata.Namespace,
				Status:           "NotFound",
				Message:          fmt.Sprintf("Resource not found: %v", err),
				LastModified:     time.Time{},
				Object:           nil, // Resource not found, so no object
			})
			continue
		}

		// Extract the latest time from managedFields
		lastModified := time.Time{}
		if managedFields := obj.GetManagedFields(); len(managedFields) > 0 {
			for _, field := range managedFields {
				if field.Time != nil && field.Time.Time.After(lastModified) {
					lastModified = field.Time.Time
				}
			}
		}

		// Compute status using kstatus
		result, err := status.Compute(obj)
		if err != nil {
			fmt.Printf("Failed to compute status for %s/%s: %v\n", objMetadata.Namespace, objMetadata.Name, err)
			managedResources = append(managedResources, ManagedResourceStatus{
				GroupVersionKind: fmt.Sprintf("%s/%s/%s", objMetadata.GroupKind.Group, entry.Version, objMetadata.GroupKind.Kind),
				Name:             objMetadata.Name,
				Namespace:        objMetadata.Namespace,
				Status:           "Error",
				Message:          fmt.Sprintf("Error computing status: %v", err),
				LastModified:     lastModified,
				Object:           obj, // Include the object even if status computation failed
			})
			continue
		}

		fmt.Printf("Successfully computed status for %s/%s: %s\n", objMetadata.Namespace, objMetadata.Name, result.Status)
		managedResources = append(managedResources, ManagedResourceStatus{
			GroupVersionKind: fmt.Sprintf("%s/%s/%s", objMetadata.GroupKind.Group, entry.Version, objMetadata.GroupKind.Kind),
			Name:             objMetadata.Name,
			Namespace:        objMetadata.Namespace,
			Status:           string(result.Status),
			Message:          result.Message,
			LastModified:     lastModified,
			Object:           obj, // Include the full object
		})
	}

	// Sort managed resources by LastModified time (most recent first)
	sort.Slice(managedResources, func(i, j int) bool {
		return managedResources[i].LastModified.After(managedResources[j].LastModified)
	})

	return managedResources, nil
}

// GetHealthChecksBySelector returns health checks that match the given selector
func (c *Client) GetHealthChecksBySelector(ctx context.Context, namespace string, selector *rolloutv1alpha1.HealthCheckSelectorConfig) ([]rolloutv1alpha1.HealthCheck, error) {
	var healthChecks []rolloutv1alpha1.HealthCheck

	// If no selector is provided, return empty list
	if selector == nil {
		return healthChecks, nil
	}

	// Determine which namespaces to search
	var namespaces []string

	if selector.NamespaceSelector != nil {
		// Parse the namespace selector to find matching namespaces
		nsSelector, err := metav1.LabelSelectorAsSelector(selector.NamespaceSelector)
		if err != nil {
			// If we can't parse the namespace selector, log the error and default to same namespace
			fmt.Printf("Failed to parse namespace selector: %v, defaulting to same namespace\n", err)
			namespaces = []string{namespace}
		} else {
			// Get all namespaces and filter by the selector
			namespaceList := &corev1.NamespaceList{}
			if err := c.client.List(ctx, namespaceList); err != nil {
				fmt.Printf("Failed to list namespaces: %v, defaulting to same namespace\n", err)
				namespaces = []string{namespace}
			} else {
				// Filter namespaces by the selector
				for _, ns := range namespaceList.Items {
					if nsSelector.Matches(labels.Set(ns.Labels)) {
						namespaces = append(namespaces, ns.Name)
					}
				}
			}
		}
	} else {
		// No namespace selector specified, search only in the rollout's namespace
		namespaces = []string{namespace}
	}

	// If no namespaces found, default to the rollout's namespace
	if len(namespaces) == 0 {
		namespaces = []string{namespace}
	}

	// Search in each namespace
	for _, ns := range namespaces {
		healthCheckList := &rolloutv1alpha1.HealthCheckList{}
		if err := c.client.List(ctx, healthCheckList, client.InNamespace(ns)); err != nil {
			fmt.Printf("Failed to list health checks in namespace %s: %v\n", ns, err)
			continue // Skip this namespace if there's an error
		}

		// Filter health checks based on the selector
		for _, hc := range healthCheckList.Items {
			if matchesSelector(&hc, selector) {
				healthChecks = append(healthChecks, hc)
			}
		}
	}

	return healthChecks, nil
}

// matchesSelector checks if a health check matches the given selector
func matchesSelector(hc *rolloutv1alpha1.HealthCheck, selector *rolloutv1alpha1.HealthCheckSelectorConfig) bool {
	if selector.Selector == nil {
		return true // No selector means match all
	}

	// Convert the selector to a usable selector
	sel, err := metav1.LabelSelectorAsSelector(selector.Selector)
	if err != nil {
		// If we can't parse the selector, log the error and return false
		fmt.Printf("Failed to parse label selector: %v\n", err)
		return false
	}

	// Handle nil labels case
	if hc.Labels == nil {
		hc.Labels = make(map[string]string)
	}

	// Check if the health check labels match the selector
	return sel.Matches(labels.Set(hc.Labels))
}

// ReconcileKustomization adds the reconcile annotation to trigger a reconciliation
func (c *Client) ReconcileKustomization(ctx context.Context, namespace, name string) error {
	kustomization := &kustomizev1.Kustomization{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, kustomization); err != nil {
		return fmt.Errorf("failed to get kustomization: %w", err)
	}

	// Add the reconcile annotation with current timestamp
	if kustomization.Annotations == nil {
		kustomization.Annotations = make(map[string]string)
	}
	kustomization.Annotations["reconcile.fluxcd.io/requestedAt"] = fmt.Sprintf("%d", time.Now().Unix())

	if err := c.client.Update(ctx, kustomization); err != nil {
		return fmt.Errorf("failed to update kustomization: %w", err)
	}

	return nil
}

// ReconcileOCIRepository adds the reconcile annotation to trigger a reconciliation
func (c *Client) ReconcileOCIRepository(ctx context.Context, namespace, name string) error {
	ociRepository := &sourcev1.OCIRepository{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, ociRepository); err != nil {
		return fmt.Errorf("failed to get OCI repository: %w", err)
	}

	// Add the reconcile annotation with current timestamp
	if ociRepository.Annotations == nil {
		ociRepository.Annotations = make(map[string]string)
	}
	ociRepository.Annotations["reconcile.fluxcd.io/requestedAt"] = fmt.Sprintf("%d", time.Now().Unix())

	if err := c.client.Update(ctx, ociRepository); err != nil {
		return fmt.Errorf("failed to update OCI repository: %w", err)
	}

	return nil
}

// ReconcileAllFluxResources reconciles all associated Flux resources for a rollout
func (c *Client) ReconcileAllFluxResources(ctx context.Context, namespace, rolloutName string) error {
	// Get associated Kustomizations
	kustomizations, err := c.GetKustomizationsByRolloutAnnotation(ctx, namespace, rolloutName)
	if err != nil {
		return fmt.Errorf("failed to get kustomizations: %w", err)
	}

	// Get associated OCIRepositories
	ociRepositories, err := c.GetOCIRepositoriesByRolloutAnnotation(ctx, namespace, rolloutName)
	if err != nil {
		return fmt.Errorf("failed to get OCI repositories: %w", err)
	}

	// Reconcile all Kustomizations
	for _, kustomization := range kustomizations.Items {
		if err := c.ReconcileKustomization(ctx, kustomization.Namespace, kustomization.Name); err != nil {
			return fmt.Errorf("failed to reconcile kustomization %s: %w", kustomization.Name, err)
		}
	}

	// Reconcile all OCIRepositories
	for _, ociRepository := range ociRepositories.Items {
		if err := c.ReconcileOCIRepository(ctx, ociRepository.Namespace, ociRepository.Name); err != nil {
			return fmt.Errorf("failed to reconcile OCI repository %s: %w", ociRepository.Name, err)
		}
	}

	return nil
}

// GetRolloutGatesByRolloutReference fetches RolloutGates that reference a specific rollout
func (c *Client) GetRolloutGatesByRolloutReference(ctx context.Context, namespace, rolloutName string) (*rolloutv1alpha1.RolloutGateList, error) {
	rolloutGates := &rolloutv1alpha1.RolloutGateList{}

	// List all RolloutGates in the namespace
	if err := c.client.List(ctx, rolloutGates, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list rollout gates: %w", err)
	}

	// Filter gates that reference the specific rollout
	var filteredGates []rolloutv1alpha1.RolloutGate
	for _, gate := range rolloutGates.Items {
		if gate.Spec.RolloutRef.Name == rolloutName {
			filteredGates = append(filteredGates, gate)
		}
	}

	rolloutGates.Items = filteredGates
	return rolloutGates, nil
}
