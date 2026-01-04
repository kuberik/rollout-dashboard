package logs

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
)

// LogTarget represents a target to stream logs from (e.g., a Deployment or Job)
type LogTarget struct {
	ID            string          `json:"id"` // Unique ID for the stream manager
	Namespace     string          `json:"namespace"`
	LabelSelector labels.Selector `json:"labelSelector"` // Selector for Stern
	Type          string          `json:"type"`          // "pod" or "test"
	ContainerName string          `json:"containerName"` // Optional concrete container name
}

// PodDiscovery handles discovering streaming targets
type PodDiscovery struct {
	client            *kubernetes.Client
	namespace         string
	rolloutName       string
	currentVersionTag string
	filterType        string
}

// NewPodDiscovery creates a new PodDiscovery instance
func NewPodDiscovery(client *kubernetes.Client, namespace, rolloutName, currentVersionTag, filterType string) *PodDiscovery {
	return &PodDiscovery{
		client:            client,
		namespace:         namespace,
		rolloutName:       rolloutName,
		currentVersionTag: currentVersionTag,
		filterType:        filterType,
	}
}

// Discover finds all targets that should have their logs streamed
func (pd *PodDiscovery) Discover(ctx context.Context) ([]LogTarget, error) {
	var targets []LogTarget

	if pd.filterType == "" || pd.filterType == "pod" {
		deploymentTargets, err := pd.discoverDeployments(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to discover deployments: %w", err)
		}
		targets = append(targets, deploymentTargets...)
	}

	if pd.filterType == "" || pd.filterType == "test" {
		testTargets, err := pd.discoverJobs(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to discover test jobs: %w", err)
		}
		targets = append(targets, testTargets...)
	}

	return targets, nil
}

// discoverDeployments finds deployments and creates LogTargets for them
// It now discovers ReplicaSets for the deployment and targets them via pod-template-hash
func (pd *PodDiscovery) discoverDeployments(ctx context.Context) ([]LogTarget, error) {
	var targets []LogTarget

	// filters

	kustomizations, err := pd.client.GetKustomizationsByRolloutAnnotation(ctx, pd.namespace, pd.rolloutName)
	if err != nil {
		fmt.Printf("Error getting kustomizations for rollout %s: %v\n", pd.rolloutName, err)
		return targets, err
	}
	if kustomizations == nil {
		fmt.Printf("No kustomizations found for rollout %s\n", pd.rolloutName)
		return targets, nil
	}
	fmt.Printf("Found %d kustomizations for rollout %s\n", len(kustomizations.Items), pd.rolloutName)

	for _, kustomization := range kustomizations.Items {
		managedResources, err := pd.client.GetKustomizationManagedResources(ctx, kustomization.Namespace, kustomization.Name)
		if err != nil {
			fmt.Printf("Error getting managed resources for kustomization %s: %v\n", kustomization.Name, err)
			continue
		}
		fmt.Printf("Found %d managed resources in kustomization %s\n", len(managedResources), kustomization.Name)

		for _, resource := range managedResources {
			if !strings.Contains(resource.GroupVersionKind, "apps/v1/Deployment") {
				continue
			}

			// Parse Deployment
			var deployment appsv1.Deployment
			if err := runtime.DefaultUnstructuredConverter.FromUnstructured(resource.Object.Object, &deployment); err != nil {
				fmt.Printf("Error converting deployment: %v\n", err)
				continue
			}
			fmt.Printf("Found Deployment %s\n", deployment.Name)

			// Find ReplicaSets for this Deployment
			replicaSets, err := pd.client.GetReplicaSets(ctx, deployment.Namespace)
			if err != nil {
				fmt.Printf("Error listing ReplicaSets: %v\n", err)
				continue
			}
			fmt.Printf("Found %d ReplicaSets in namespace %s\n", len(replicaSets.Items), deployment.Namespace)

			// Deployment selector to match ReplicaSets
			deploymentSelector, err := metav1LabelSelectorAsSelector(deployment.Spec.Selector)
			if err != nil {
				continue
			}

			for _, rs := range replicaSets.Items {
				// Check if ReplicaSet is owned by or matches the Deployment
				// 1. Check OwnerReferences (strongest link)
				isOwned := false
				for _, ref := range rs.OwnerReferences {
					if ref.Kind == "Deployment" && ref.Name == deployment.Name {
						isOwned = true
						break
					}
				}

				// 2. Check Label Selector if not explicitly owned (though RS usually owned by Deploy)
				if !isOwned {
					if deploymentSelector.Matches(labels.Set(rs.Labels)) {
						isOwned = true
					}
				}

				if !isOwned {
					continue
				}

				// Filter by Version Tag if set
				// We assume the version is in the labels, e.g., app.kubernetes.io/version or similar standard label
				// Or check if the user provided specific logic.
				// For now, let's assume we filter if 'currentVersionTag' is passed and matches 'app.kubernetes.io/version'
				if pd.currentVersionTag != "" {
					rsBytes, err := json.Marshal(rs)
					if err != nil {
						continue
					}
					rsStr := string(rsBytes)

					// Apply Kustomization substitutions if available
					if kustomization.Spec.PostBuild != nil && kustomization.Spec.PostBuild.Substitute != nil {
						for k, v := range kustomization.Spec.PostBuild.Substitute {
							rsStr = strings.ReplaceAll(rsStr, fmt.Sprintf("${%s}", k), v)
							rsStr = strings.ReplaceAll(rsStr, fmt.Sprintf("$(%s)", k), v) // Also handle $() format if used
						}
					}

					if !strings.Contains(rsStr, pd.currentVersionTag) {
						continue
					}
				}

				// Create Target for this ReplicaSet using pod-template-hash
				// This ensures we only get logs from pods belonging to this specific RS version
				if hash, ok := rs.Labels["pod-template-hash"]; ok {
					selector, err := labels.Parse(fmt.Sprintf("pod-template-hash=%s", hash))
					if err != nil {
						continue
					}

					targets = append(targets, LogTarget{
						ID:            fmt.Sprintf("rs/%s/%s", rs.Namespace, rs.Name),
						Namespace:     rs.Namespace,
						LabelSelector: selector,
						Type:          "pod",
					})
				}
			}
		}
	}

	return targets, nil
}

// discoverJobs finds RolloutTest jobs and creates LogTargets for them
func (pd *PodDiscovery) discoverJobs(ctx context.Context) ([]LogTarget, error) {
	var targets []LogTarget

	rolloutTests, err := pd.client.GetRolloutTests(ctx, pd.namespace)
	if err != nil {
		fmt.Printf("Error listing RolloutTests: %v\n", err)
		return targets, err
	}

	// fmt.Printf("DEBUG: Found %d RolloutTests in namespace %s\n", len(rolloutTests.Items), pd.namespace)

	for _, rt := range rolloutTests.Items {
		match := false
		if rt.Spec.RolloutName == pd.rolloutName {
			match = true
		} else if appLabel := rt.Labels["app"]; appLabel != "" && strings.Contains(pd.rolloutName, appLabel) {
			match = true // Fallback: match if rollout name contains app label (e.g. hello-world-app contains hello-world)
		}

		if !match {
			continue
		}

		if rt.Status.JobName == "" {
			continue
		}

		selector, err := labels.Parse(fmt.Sprintf("batch.kubernetes.io/job-name=%s", rt.Status.JobName))
		if err != nil {
			fmt.Printf("Failed to parse label selector for job %s: %v\n", rt.Status.JobName, err)
			continue
		}

		targets = append(targets, LogTarget{
			ID:            fmt.Sprintf("job/%s/%s", pd.namespace, rt.Status.JobName),
			Namespace:     pd.namespace,
			LabelSelector: selector,
			Type:          "test",
		})
	}

	return targets, nil
}

// Helper to convert metav1.LabelSelector to labels.Selector
func metav1LabelSelectorAsSelector(ls *metav1.LabelSelector) (labels.Selector, error) {
	if ls == nil {
		return labels.Nothing(), nil
	}
	return metav1.LabelSelectorAsSelector(ls)
}
