package kubernetes

import (
	"context"
	"fmt"
	"log"
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
	log.Printf("[User Identity Debug] Starting GetCurrentUserIdentity")

	if c.config == nil {
		log.Printf("[User Identity Debug] ERROR: REST config is nil")
		return "", false, fmt.Errorf("REST config is nil - client was not properly initialized")
	}

	log.Printf("[User Identity Debug] Config exists, creating clientset...")

	// Create clientset using the stored config (which includes the OIDC token)
	clientset, err := kubernetes.NewForConfig(c.config)
	if err != nil {
		log.Printf("[User Identity Debug] ERROR: Failed to create clientset: %v", err)
		return "", false, fmt.Errorf("failed to create clientset: %w", err)
	}
	log.Printf("[User Identity Debug] Clientset created successfully")

	// Use SelfSubjectReview API (same as kubectl auth whoami)
	// Try v1 first, then fallback to v1beta1, then v1alpha1
	var userInfo authenticationv1.UserInfo

	log.Printf("[User Identity Debug] Trying SelfSubjectReview v1...")
	res, err := clientset.AuthenticationV1().SelfSubjectReviews().Create(ctx, &authenticationv1.SelfSubjectReview{}, metav1.CreateOptions{})
	if err != nil && errors.IsNotFound(err) {
		log.Printf("[User Identity Debug] v1 not found, trying v1beta1...")
		// Fallback to Beta API if v1 is not enabled
		resBeta, errBeta := clientset.AuthenticationV1beta1().SelfSubjectReviews().Create(ctx, &authenticationv1beta1.SelfSubjectReview{}, metav1.CreateOptions{})
		if errBeta != nil && errors.IsNotFound(errBeta) {
			log.Printf("[User Identity Debug] v1beta1 not found, trying v1alpha1...")
			// Fallback to Alpha API if Beta is not enabled
			resAlpha, errAlpha := clientset.AuthenticationV1alpha1().SelfSubjectReviews().Create(ctx, &authenticationv1alpha1.SelfSubjectReview{}, metav1.CreateOptions{})
			if errAlpha != nil {
				log.Printf("[User Identity Debug] ERROR: All SelfSubjectReview API versions failed. Last error: %v", errAlpha)
				if errors.IsForbidden(errAlpha) {
					return "", false, fmt.Errorf("selfsubjectreviews API is not enabled in the cluster or you do not have permission to call it")
				}
				if errors.IsNotFound(errAlpha) {
					return "", false, fmt.Errorf("selfsubjectreviews API is not enabled in the cluster")
				}
				return "", false, fmt.Errorf("failed to get user identity: %w", errAlpha)
			}
			userInfo = resAlpha.Status.UserInfo
			log.Printf("[User Identity Debug] Successfully used v1alpha1 SelfSubjectReview")
		} else if errBeta != nil {
			log.Printf("[User Identity Debug] ERROR: v1beta1 SelfSubjectReview failed: %v", errBeta)
			if errors.IsForbidden(errBeta) {
				return "", false, fmt.Errorf("selfsubjectreviews API is not enabled in the cluster or you do not have permission to call it")
			}
			return "", false, fmt.Errorf("failed to get user identity: %w", errBeta)
		} else {
			userInfo = resBeta.Status.UserInfo
			log.Printf("[User Identity Debug] Successfully used v1beta1 SelfSubjectReview")
		}
	} else if err != nil {
		log.Printf("[User Identity Debug] ERROR: v1 SelfSubjectReview failed: %v", err)
		if errors.IsForbidden(err) {
			return "", false, fmt.Errorf("selfsubjectreviews API is not enabled in the cluster or you do not have permission to call it")
		}
		return "", false, fmt.Errorf("failed to get user identity: %w", err)
	} else {
		userInfo = res.Status.UserInfo
		log.Printf("[User Identity Debug] Successfully used v1 SelfSubjectReview")
	}

	log.Printf("[User Identity Debug] SelfSubjectReview response received")
	log.Printf("[User Identity Debug] User.Username: %s", userInfo.Username)
	log.Printf("[User Identity Debug] User.UID: %s", userInfo.UID)
	log.Printf("[User Identity Debug] User.Groups: %v", userInfo.Groups)
	if len(userInfo.Extra) > 0 {
		log.Printf("[User Identity Debug] User.Extra: %v", userInfo.Extra)
	}

	if userInfo.Username == "" {
		log.Printf("[User Identity Debug] ERROR: Username is empty in response")
		return "", false, fmt.Errorf("username not available in SelfSubjectReview response")
	}

	username := userInfo.Username
	isServiceAccount := strings.HasPrefix(username, "system:serviceaccount:")

	log.Printf("[User Identity Debug] Final result - Username: %s, IsServiceAccount: %v", username, isServiceAccount)

	return username, isServiceAccount, nil
}

// FormatUserInfo formats user information for appending to deploy messages
// Returns empty string if user is a service account
func (c *Client) FormatUserInfo(ctx context.Context) (string, error) {
	log.Printf("[User Identity Debug] FormatUserInfo called")
	username, isServiceAccount, err := c.GetCurrentUserIdentity(ctx)
	if err != nil {
		log.Printf("[User Identity Debug] FormatUserInfo: GetCurrentUserIdentity failed: %v", err)
		return "", err
	}

	log.Printf("[User Identity Debug] FormatUserInfo: username=%s, isServiceAccount=%v", username, isServiceAccount)

	if isServiceAccount {
		log.Printf("[User Identity Debug] FormatUserInfo: User is a service account, returning empty string")
		return "", nil
	}

	// Format: "Triggered by: <username>"
	formatted := fmt.Sprintf("Triggered by: %s", username)
	log.Printf("[User Identity Debug] FormatUserInfo: Returning formatted string: %s", formatted)
	return formatted, nil
}
