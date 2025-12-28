package logs

import (
	"context"
	"fmt"
	"strings"

	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
	openkruisev1alpha1 "github.com/kuberik/openkruise-controller/api/v1alpha1"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
)

// PodInfo represents a pod that should have its logs streamed
type PodInfo struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Type      string `json:"type"` // "pod" or "test"
}

// PodDiscovery handles discovering pods for log streaming
type PodDiscovery struct {
	client           *kubernetes.Client
	namespace        string
	rolloutName      string
	currentVersionTag string
	filterType       string
}

// NewPodDiscovery creates a new PodDiscovery instance
func NewPodDiscovery(client *kubernetes.Client, namespace, rolloutName, currentVersionTag, filterType string) *PodDiscovery {
	return &PodDiscovery{
		client:           client,
		namespace:        namespace,
		rolloutName:      rolloutName,
		currentVersionTag: currentVersionTag,
		filterType:       filterType,
	}
}

// Discover finds all pods that should have their logs streamed
func (pd *PodDiscovery) Discover(ctx context.Context) ([]PodInfo, error) {
	var pods []PodInfo

	if pd.filterType == "" || pd.filterType == "pod" {
		deploymentPods, err := pd.discoverDeploymentPods(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to discover deployment pods: %w", err)
		}
		pods = append(pods, deploymentPods...)
	}

	if pd.filterType == "" || pd.filterType == "test" {
		testPods, err := pd.discoverTestPods(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to discover test pods: %w", err)
		}
		pods = append(pods, testPods...)
	}

	return pods, nil
}

// discoverDeploymentPods finds pods from deployments in kustomize inventory
func (pd *PodDiscovery) discoverDeploymentPods(ctx context.Context) ([]PodInfo, error) {
	var pods []PodInfo

	kustomizations, err := pd.client.GetKustomizationsByRolloutAnnotation(ctx, pd.namespace, pd.rolloutName)
	if err != nil || kustomizations == nil {
		return pods, err
	}

	for _, kustomization := range kustomizations.Items {
		managedResources, err := pd.client.GetKustomizationManagedResources(ctx, kustomization.Namespace, kustomization.Name)
		if err != nil {
			continue
		}

		for _, resource := range managedResources {
			if !strings.Contains(resource.GroupVersionKind, "apps/v1/Deployment") {
				continue
			}

			var deployment appsv1.Deployment
			if err := runtime.DefaultUnstructuredConverter.FromUnstructured(resource.Object.Object, &deployment); err != nil {
				continue
			}

			deploymentPods, err := pd.findPodsForDeployment(ctx, &deployment)
			if err != nil {
				continue
			}
			pods = append(pods, deploymentPods...)
		}
	}

	return pods, nil
}

// discoverTestPods finds pods from RolloutTest jobs
func (pd *PodDiscovery) discoverTestPods(ctx context.Context) ([]PodInfo, error) {
	var pods []PodInfo

	kustomizations, err := pd.client.GetKustomizationsByRolloutAnnotation(ctx, pd.namespace, pd.rolloutName)
	if err != nil || kustomizations == nil {
		return pods, err
	}

	for _, kustomization := range kustomizations.Items {
		managedResources, err := pd.client.GetKustomizationManagedResources(ctx, kustomization.Namespace, kustomization.Name)
		if err != nil {
			continue
		}

		for _, resource := range managedResources {
			if !strings.Contains(resource.GroupVersionKind, "RolloutTest") {
				continue
			}

			var rolloutTest openkruisev1alpha1.RolloutTest
			if err := runtime.DefaultUnstructuredConverter.FromUnstructured(resource.Object.Object, &rolloutTest); err != nil {
				continue
			}

			if rolloutTest.Status.JobName == "" {
				continue
			}

			testPods, err := pd.findPodsForJob(ctx, rolloutTest.Status.JobName)
			if err != nil {
				continue
			}
			pods = append(pods, testPods...)
		}
	}

	return pods, nil
}

// findPodsForDeployment finds pods matching a deployment's selector and version tag
func (pd *PodDiscovery) findPodsForDeployment(ctx context.Context, deployment *appsv1.Deployment) ([]PodInfo, error) {
	var pods []PodInfo

	selectorLabels := deployment.Spec.Selector.MatchLabels
	allPodsList, err := pd.client.GetAllPods(ctx, deployment.Namespace)
	if err != nil {
		return pods, err
	}

	for _, pod := range allPodsList.Items {
		if !pd.podMatchesSelector(&pod, selectorLabels) {
			continue
		}

		if !pd.containsVersionTag(&pod) {
			continue
		}

		pods = append(pods, PodInfo{
			Name:      pod.Name,
			Namespace: pod.Namespace,
			Type:      "pod",
		})
	}

	return pods, nil
}

// findPodsForJob finds pods for a job by label selector
func (pd *PodDiscovery) findPodsForJob(ctx context.Context, jobName string) ([]PodInfo, error) {
	var pods []PodInfo

	selector, err := labels.Parse(fmt.Sprintf("batch.kubernetes.io/job-name=%s", jobName))
	if err != nil {
		return pods, err
	}

	jobPods, err := pd.client.GetPodsBySelector(ctx, pd.namespace, selector)
	if err != nil || jobPods == nil {
		return pods, err
	}

	for _, pod := range jobPods.Items {
		pods = append(pods, PodInfo{
			Name:      pod.Name,
			Namespace: pod.Namespace,
			Type:      "test",
		})
	}

	return pods, nil
}

// podMatchesSelector checks if a pod matches the given label selector
func (pd *PodDiscovery) podMatchesSelector(pod *corev1.Pod, selectorLabels map[string]string) bool {
	for key, value := range selectorLabels {
		if pod.Labels[key] != value {
			return false
		}
	}
	return true
}

// containsVersionTag checks if a pod contains the current version tag
func (pd *PodDiscovery) containsVersionTag(pod *corev1.Pod) bool {
	if pd.currentVersionTag == "" {
		return true
	}

	// Check labels
	for key, value := range pod.Labels {
		if strings.Contains(key, pd.currentVersionTag) || strings.Contains(value, pd.currentVersionTag) {
			return true
		}
	}

	// Check annotations
	for key, value := range pod.Annotations {
		if strings.Contains(key, pd.currentVersionTag) || strings.Contains(value, pd.currentVersionTag) {
			return true
		}
	}

	// Check container images
	for _, container := range pod.Spec.Containers {
		if strings.Contains(container.Image, pd.currentVersionTag) {
			return true
		}
	}

	return false
}

