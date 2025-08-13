package kubernetes

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

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
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
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

func (c *Client) UpdateRolloutVersion(ctx context.Context, namespace, name string, version *string) (*rolloutv1alpha1.Rollout, error) {
	// Create an unstructured patch object with only the spec.wantedVersion field
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

	// Use server-side apply to update only the wantedVersion field
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
		// Check for rollout.kuberik.com/{rolloutName}.substitute annotation
		annotationKey := fmt.Sprintf("rollout.kuberik.com/%s.substitute", rolloutName)
		if _, exists := kustomization.Annotations[annotationKey]; exists {
			filteredKustomizations.Items = append(filteredKustomizations.Items, kustomization)
			continue
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
	GroupVersionKind string `json:"groupVersionKind"`
	Name             string `json:"name"`
	Namespace        string `json:"namespace"`
	Status           string `json:"status"`
	Message          string `json:"message"`
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
			})
			continue
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
		})
	}

	fmt.Printf("Returning %d managed resources\n", len(managedResources))
	return managedResources, nil
}
