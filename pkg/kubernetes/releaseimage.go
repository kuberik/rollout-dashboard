package kubernetes

import (
	"context"
	"errors"
	"fmt"
	"time"

	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	releasev1alpha1 "github.com/kuberik/rollout-dashboard/pkg/apis/release/v1alpha1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

// ErrNoReleaseImage means a rollout names no release source.
var ErrNoReleaseImage = errors.New("rollout has no releaseSourceRef")

// ErrReleaseSourceNotUsable means the rollout's ReleaseSource exists but cannot
// give an image: it is not Ready or its oci spec is missing or incomplete.
var ErrReleaseSourceNotUsable = errors.New("release source is not usable")

// ReleaseImage is the OCI repository a rollout's releases come from.
type ReleaseImage struct {
	// Image is the repository, e.g. ghcr.io/org/app.
	Image string
	// SecretName is the dockerconfigjson Secret (same namespace) or "".
	SecretName string
	// LastSync is when the ReleaseSource last read the registry (RFC 3339), or "".
	LastSync string
}

// ResolveReleaseImage resolves the image repository of a rollout from the
// ReleaseSource named by spec.releaseSourceRef: oci.image directly, or
// oci.imagePolicyRef through its Flux ImagePolicy and ImageRepository (the
// source names the image only through them). A rollout with no source returns
// ErrNoReleaseImage; a source that is not Ready or has no usable oci spec
// returns ErrReleaseSourceNotUsable with the reason; a missing object is a
// wrapped NotFound.
func (c *Client) ResolveReleaseImage(ctx context.Context, rollout *rolloutv1alpha1.Rollout) (*ReleaseImage, error) {
	src, err := c.GetRolloutReleaseSource(ctx, rollout)
	if err != nil {
		return nil, err
	}
	for _, cond := range src.Status.Conditions {
		if cond.Type == releasev1alpha1.ReadyCondition && cond.Status == "False" {
			return nil, fmt.Errorf("%w: %s is not Ready: %s %s", ErrReleaseSourceNotUsable, src.Name, cond.Reason, cond.Message)
		}
	}
	ri := &ReleaseImage{}
	if src.Status.LastSyncTime != nil {
		ri.LastSync = src.Status.LastSyncTime.Format(time.RFC3339)
	}
	oci := src.Spec.OCI
	switch {
	case oci == nil:
		return nil, fmt.Errorf("%w: %s has no oci source", ErrReleaseSourceNotUsable, src.Name)
	case oci.Image != "":
		ri.Image = oci.Image
		if oci.SecretRef != nil {
			ri.SecretName = oci.SecretRef.Name
		}
		return ri, nil
	case oci.ImagePolicyRef != nil && oci.ImagePolicyRef.Name != "":
		return c.releaseImageFromPolicy(ctx, rollout.Namespace, oci.ImagePolicyRef.Name, ri)
	default:
		return nil, fmt.Errorf("%w: %s sets neither oci.image nor oci.imagePolicyRef", ErrReleaseSourceNotUsable, src.Name)
	}
}

func (c *Client) releaseImageFromPolicy(ctx context.Context, ns, policyName string, ri *ReleaseImage) (*ReleaseImage, error) {
	policy, err := c.GetImagePolicy(ctx, ns, policyName)
	if err != nil {
		return nil, err
	}
	repoName := policy.Spec.ImageRepositoryRef.Name
	if repoName == "" {
		return nil, fmt.Errorf("%w: image policy %s has no imageRepositoryRef", ErrReleaseSourceNotUsable, policyName)
	}
	repo, err := c.GetImageRepository(ctx, ns, repoName)
	if err != nil {
		return nil, err
	}
	ri.Image = repo.Spec.Image
	if repo.Spec.SecretRef != nil {
		ri.SecretName = repo.Spec.SecretRef.Name
	}
	return ri, nil
}

// IsReleaseImageUnresolvable reports whether err means the rollout's release
// source is absent or misconfigured (a client-visible 404/422 condition).
func IsReleaseImageUnresolvable(err error) (status int, ok bool) {
	switch {
	case err == nil:
		return 0, false
	case errors.Is(err, ErrNoReleaseImage), errors.Is(err, ErrReleaseSourceNotUsable):
		return 422, true
	case apierrors.IsNotFound(err):
		return 404, true
	}
	return 0, false
}
