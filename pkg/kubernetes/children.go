package kubernetes

import (
	"context"
	"errors"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// CHILDREN-2026-09-04 / DERIVED-2026-09-04: this file is the single source
// of truth for "what does GET /namespaces/:namespace/deployments/:name/children
// return for this Deployment" — extracted out of main.go's handler (which
// used to inline all of this as anonymous types and a closure) so
// eventhub.go's derived-data computation can produce the byte-identical
// response body for a Deployment/ReplicaSet ChangeEvent, without a second
// HTTP round trip through the handler itself. main.go's handler and
// eventhub.go's attachDerived both call BuildDeploymentChildren; neither
// duplicates this logic anymore.

// ErrDeploymentNotFound wraps a failed Deployment lookup so callers (the
// HTTP handler) can tell "the deployment itself is missing" (404) apart from
// every other failure mode here (500) via errors.Is, without parsing an
// error string.
var ErrDeploymentNotFound = errors.New("deployment not found")

// PodInfo is one Pod's display-ready summary within a ReplicaSet's child
// list — restart count, readiness, first meaningful waiting/terminated
// message, image list, and a human-rendered age string, computed once here
// instead of separately in every place a caller might otherwise recompute
// them from a raw corev1.Pod.
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

// RSInfo is one ReplicaSet owned by the Deployment, plus the Pods owned by
// that ReplicaSet.
type RSInfo struct {
	Name            string    `json:"name"`
	Namespace       string    `json:"namespace"`
	Replicas        int32     `json:"replicas"`
	ReadyReplicas   int32     `json:"readyReplicas"`
	DesiredReplicas int32     `json:"desiredReplicas"`
	IsCurrentRS     bool      `json:"isCurrentRS"`
	Pods            []PodInfo `json:"pods"`
}

// DeploymentInfo is the small subset of Deployment status the children
// response echoes back alongside its ReplicaSets, matching the shape the
// handler has always returned (a map[string]interface{} before this file
// existed).
type DeploymentInfo struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	Replicas          int32  `json:"replicas"`
	ReadyReplicas     int32  `json:"readyReplicas"`
	UpdatedReplicas   int32  `json:"updatedReplicas"`
	AvailableReplicas int32  `json:"availableReplicas"`
}

// DeploymentChildren is the exact JSON body GET
// /namespaces/:namespace/deployments/:name/children returns.
type DeploymentChildren struct {
	ReplicaSets []RSInfo       `json:"replicaSets"`
	Deployment  DeploymentInfo `json:"deployment"`
}

// BuildDeploymentChildren fetches the Deployment, its owned ReplicaSets, and
// their Pods, and assembles them into the same response shape the
// /namespaces/:namespace/deployments/:name/children handler has always
// returned. Both that handler (main.go) and eventhub.go's derived-data
// computation call this — the only difference between them is who pays for
// it and how often (see eventhub.go's attachDerived doc comment for the
// once-per-batch, debounced version of that story).
//
// The Deployment and its ReplicaSets are read via k8sClient's
// controller-runtime client (GetDeployment/GetReplicaSetsBySelector) — an
// informer-cache hit for the InitReadCache-backed client both call sites use
// in production. Pods stay a live, namespaced LIST through k8sClient's
// clientset (GetClientset) — cache.go's cachedByObject deliberately excludes
// cluster-wide Pods, so this is unavoidably a real apiserver round trip,
// same as before this function existed.
//
// Returns an error wrapping ErrDeploymentNotFound (errors.Is) if the
// Deployment itself can't be fetched; any other error is a ReplicaSet/Pod
// LIST or selector-parse failure with its own detail in err.Error().
func BuildDeploymentChildren(ctx context.Context, k8sClient *Client, namespace, name string) (*DeploymentChildren, error) {
	// Get the Deployment to get its UID and selector. Served from the
	// informer cache (cache.go's cachedByObject includes apps/v1 Deployment)
	// rather than a live apiserver GET, which is what makes the refetch the
	// frontend does on a Deployment/ReplicaSet stream event cheap.
	deployment, err := k8sClient.GetDeployment(ctx, namespace, name)
	if err != nil {
		return nil, fmt.Errorf("%w: %s/%s: %v", ErrDeploymentNotFound, namespace, name, err)
	}

	deploymentUID := string(deployment.UID)

	// Narrow LIST scope: deployment selector matches all RS + Pods belonging
	// to this deployment. (RS adds pod-template-hash on top, but base labels
	// still match.)
	labelSelector, err := metav1.LabelSelectorAsSelector(deployment.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("failed to parse deployment selector for %s/%s: %w", namespace, name, err)
	}

	// ReplicaSets — same cache-backed read as the Deployment above.
	allRS, err := k8sClient.GetReplicaSetsBySelector(ctx, namespace, labelSelector)
	if err != nil {
		return nil, fmt.Errorf("failed to list ReplicaSets for %s/%s: %w", namespace, name, err)
	}

	// Pods stay a live, namespaced LIST with the same selector as before —
	// cluster-wide Pods are deliberately excluded from the informer cache
	// (cache.go's cachedByObject doc comment: too heavy, and nothing else
	// here needs them).
	clientset := k8sClient.GetClientset()
	if clientset == nil {
		return nil, fmt.Errorf("clientset not initialized for %s/%s", namespace, name)
	}
	listOpts := metav1.ListOptions{LabelSelector: metav1.FormatLabelSelector(deployment.Spec.Selector)}
	allPods, err := clientset.CoreV1().Pods(namespace).List(ctx, listOpts)
	if err != nil {
		return nil, fmt.Errorf("failed to list Pods for %s/%s: %w", namespace, name, err)
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
			for _, container := range pod.Spec.Containers {
				images = append(images, container.Image)
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

	return &DeploymentChildren{
		ReplicaSets: replicaSets,
		Deployment: DeploymentInfo{
			Name:              deployment.Name,
			Namespace:         deployment.Namespace,
			Replicas:          deployment.Status.Replicas,
			ReadyReplicas:     deployment.Status.ReadyReplicas,
			UpdatedReplicas:   deployment.Status.UpdatedReplicas,
			AvailableReplicas: deployment.Status.AvailableReplicas,
		},
	}, nil
}
