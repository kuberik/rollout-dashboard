package kubernetes

import (
	"context"
	"fmt"
	"strings"

	authenticationv1 "k8s.io/api/authentication/v1"
	authenticationv1alpha1 "k8s.io/api/authentication/v1alpha1"
	authenticationv1beta1 "k8s.io/api/authentication/v1beta1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// GetCurrentUserIdentity gets the current user's identity using SelfSubjectReview API
// This is the same API that kubectl auth whoami uses
// Returns the username and a boolean indicating if it's a service account
// Returns empty string and false if unable to determine identity
func (c *Client) GetCurrentUserIdentity(ctx context.Context) (string, bool, error) {
	if c.config == nil {
		return "", false, fmt.Errorf("REST config is nil - client was not properly initialized")
	}

	// Create clientset using the stored config (which includes the OIDC token)
	clientset, err := kubernetes.NewForConfig(c.config)
	if err != nil {
		return "", false, fmt.Errorf("failed to create clientset: %w", err)
	}

	// Use SelfSubjectReview API (same as kubectl auth whoami)
	// Try v1 first, then fallback to v1beta1, then v1alpha1
	var userInfo authenticationv1.UserInfo

	res, err := clientset.AuthenticationV1().SelfSubjectReviews().Create(ctx, &authenticationv1.SelfSubjectReview{}, metav1.CreateOptions{})
	if err != nil && errors.IsNotFound(err) {
		// Fallback to Beta API if v1 is not enabled
		resBeta, errBeta := clientset.AuthenticationV1beta1().SelfSubjectReviews().Create(ctx, &authenticationv1beta1.SelfSubjectReview{}, metav1.CreateOptions{})
		if errBeta != nil && errors.IsNotFound(errBeta) {
			// Fallback to Alpha API if Beta is not enabled
			resAlpha, errAlpha := clientset.AuthenticationV1alpha1().SelfSubjectReviews().Create(ctx, &authenticationv1alpha1.SelfSubjectReview{}, metav1.CreateOptions{})
			if errAlpha != nil {
				if errors.IsForbidden(errAlpha) {
					return "", false, fmt.Errorf("selfsubjectreviews API is not enabled in the cluster or you do not have permission to call it")
				}
				if errors.IsNotFound(errAlpha) {
					return "", false, fmt.Errorf("selfsubjectreviews API is not enabled in the cluster")
				}
				return "", false, fmt.Errorf("failed to get user identity: %w", errAlpha)
			}
			userInfo = resAlpha.Status.UserInfo
		} else if errBeta != nil {
			if errors.IsForbidden(errBeta) {
				return "", false, fmt.Errorf("selfsubjectreviews API is not enabled in the cluster or you do not have permission to call it")
			}
			return "", false, fmt.Errorf("failed to get user identity: %w", errBeta)
		} else {
			userInfo = resBeta.Status.UserInfo
		}
	} else if err != nil {
		if errors.IsForbidden(err) {
			return "", false, fmt.Errorf("selfsubjectreviews API is not enabled in the cluster or you do not have permission to call it")
		}
		return "", false, fmt.Errorf("failed to get user identity: %w", err)
	} else {
		userInfo = res.Status.UserInfo
	}

	if userInfo.Username == "" {
		return "", false, fmt.Errorf("username not available in SelfSubjectReview response")
	}

	username := userInfo.Username
	isServiceAccount := strings.HasPrefix(username, "system:serviceaccount:")

	return username, isServiceAccount, nil
}

// FormatUserInfo formats user information for appending to deploy messages
// Returns empty string if user is a service account
func (c *Client) FormatUserInfo(ctx context.Context) (string, error) {
	username, isServiceAccount, err := c.GetCurrentUserIdentity(ctx)
	if err != nil {
		return "", err
	}

	if isServiceAccount {
		return "", nil
	}

	// Format: "Triggered by: <username>"
	return fmt.Sprintf("Triggered by: %s", username), nil
}
