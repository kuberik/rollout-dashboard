package kubernetes

import (
	"context"
	"errors"
	"fmt"

	imagereflectorv1 "github.com/fluxcd/image-reflector-controller/api/v1"
	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	releasev1alpha1 "github.com/kuberik/rollout-dashboard/pkg/apis/release/v1alpha1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// ErrNoReleaseImage means a rollout names no source of releases at all.
var ErrNoReleaseImage = errors.New("rollout has no releaseSourceRef or releasesImagePolicy")

// ReleaseImage is the OCI repository a rollout's releases come from.
type ReleaseImage struct {
	// Image is the repository, e.g. ghcr.io/org/app.
	Image string
	// SecretName is the dockerconfigjson Secret (same namespace) or "".
	SecretName string
	// Repository is the Flux ImageRepository when the image came from one
	// (imagePolicyRef or releasesImagePolicy); nil for a plain oci.image.
	Repository *imagereflectorv1.ImageRepository
}

// releaseSourceRefName reads spec.releaseSourceRef.name from the live Rollout
// as unstructured, because the pinned rollout-controller API has no such field.
func (c *Client) releaseSourceRefName(ctx context.Context, rollout *rolloutv1alpha1.Rollout) (string, error) {
	u := &unstructured.Unstructured{}
	u.SetGroupVersionKind(rolloutv1alpha1.GroupVersion.WithKind("Rollout"))
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: rollout.Namespace, Name: rollout.Name}, u); err != nil {
		return "", fmt.Errorf("failed to get rollout %s: %w", rollout.Name, err)
	}
	name, _, err := unstructured.NestedString(u.Object, "spec", "releaseSourceRef", "name")
	if err != nil {
		return "", fmt.Errorf("rollout %s has a malformed spec.releaseSourceRef: %w", rollout.Name, err)
	}
	return name, nil
}

// ResolveReleaseImage resolves the image repository of a rollout:
//  1. spec.releaseSourceRef -> ReleaseSource spec.oci.image, or
//     spec.oci.imagePolicyRef -> ImagePolicy -> ImageRepository;
//  2. otherwise the legacy spec.releasesImagePolicy.
//
// Missing objects are returned as wrapped NotFound errors (apierrors.IsNotFound
// is true); a rollout with no source at all returns ErrNoReleaseImage.
func (c *Client) ResolveReleaseImage(ctx context.Context, rollout *rolloutv1alpha1.Rollout) (*ReleaseImage, error) {
	if rollout == nil {
		return nil, ErrNoReleaseImage
	}
	ns := rollout.Namespace
	refName, err := c.releaseSourceRefName(ctx, rollout)
	if err != nil {
		return nil, err
	}
	if refName != "" {
		ref := struct{ Name string }{refName}
		src := &releasev1alpha1.ReleaseSource{}
		if err := c.client.Get(ctx, client.ObjectKey{Namespace: ns, Name: ref.Name}, src); err != nil {
			return nil, fmt.Errorf("failed to get release source %s: %w", ref.Name, err)
		}
		oci := src.Spec.OCI
		switch {
		case oci == nil:
			return nil, fmt.Errorf("release source %s has no oci source", ref.Name)
		case oci.Image != "":
			ri := &ReleaseImage{Image: oci.Image}
			if oci.SecretRef != nil {
				ri.SecretName = oci.SecretRef.Name
			}
			return ri, nil
		case oci.ImagePolicyRef != nil && oci.ImagePolicyRef.Name != "":
			return c.releaseImageFromPolicy(ctx, ns, oci.ImagePolicyRef.Name)
		default:
			return nil, fmt.Errorf("release source %s sets neither oci.image nor oci.imagePolicyRef", ref.Name)
		}
	}
	if name := rollout.Spec.ReleasesImagePolicy.Name; name != "" {
		return c.releaseImageFromPolicy(ctx, ns, name)
	}
	return nil, ErrNoReleaseImage
}

func (c *Client) releaseImageFromPolicy(ctx context.Context, ns, policyName string) (*ReleaseImage, error) {
	policy, err := c.GetImagePolicy(ctx, ns, policyName)
	if err != nil {
		return nil, err
	}
	repoName := policy.Spec.ImageRepositoryRef.Name
	if repoName == "" {
		return nil, fmt.Errorf("image policy %s has no imageRepositoryRef", policyName)
	}
	repo, err := c.GetImageRepository(ctx, ns, repoName)
	if err != nil {
		return nil, err
	}
	ri := &ReleaseImage{Image: repo.Spec.Image, Repository: repo}
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
	case errors.Is(err, ErrNoReleaseImage):
		return 422, true
	case apierrors.IsNotFound(err):
		return 404, true
	}
	return 0, false
}
