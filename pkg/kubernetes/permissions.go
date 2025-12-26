package kubernetes

import (
	"context"
	"fmt"

	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// CheckPermission checks if the current user has permission to perform an action
// using SelfSubjectAccessReview API
// Uses the stored REST config which includes the user's OIDC token
func (c *Client) CheckPermission(ctx context.Context, apiGroup, resource, verb, namespace, name string) (bool, error) {
	if c.config == nil {
		return false, fmt.Errorf("REST config is nil - client was not properly initialized")
	}

	// Create clientset using the stored config (which includes the OIDC token)
	clientset, err := kubernetes.NewForConfig(c.config)
	if err != nil {
		return false, fmt.Errorf("failed to create clientset: %w", err)
	}

	// Create SelfSubjectAccessReview
	review := &authorizationv1.SelfSubjectAccessReview{
		Spec: authorizationv1.SelfSubjectAccessReviewSpec{
			ResourceAttributes: &authorizationv1.ResourceAttributes{
				Group:     apiGroup,
				Namespace: namespace,
				Verb:      verb,
				Resource:  resource,
				Name:      name,
			},
		},
	}

	result, err := clientset.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, review, metav1.CreateOptions{})
	if err != nil {
		return false, fmt.Errorf("failed to create SelfSubjectAccessReview: %w", err)
	}

	return result.Status.Allowed, nil
}

// CheckRolloutPermission checks if the current user has permission to perform an action on a Rollout
func (c *Client) CheckRolloutPermission(ctx context.Context, verb, namespace, name string) (bool, error) {
	// Rollout resource in the kuberik.com API group
	return c.CheckPermission(ctx, "kuberik.com", "rollouts", verb, namespace, name)
}
