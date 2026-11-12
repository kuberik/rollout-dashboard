package kubernetes

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"

	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/util/retry"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// Manual approvals (docs: APPROVALS-API.md sections 4.3, 8.1, 9). The approve
// endpoint creates a RolloutApproval with the signed-in user's own client; the
// rollout-controller turns approvals into the allowedVersions of the
// policy-owned gate. Everything here is HTTP-free so it can be tested against
// a fake client.

// AnnotationApprovalBy records who approved. Admission (the
// kuberik-rolloutapproval-by policy) makes it equal to the requesting user, so
// it can be trusted only where that policy is enforced (see ApprovalByVerifier).
const AnnotationApprovalBy = "approval.kuberik.com/by"

const serviceAccountPrefix = "system:serviceaccount:"

// ErrApprovalCollision is returned when the deterministic RolloutApproval name
// is already taken by an object for a different rollout or version. The name
// rule is lossy (sanitising, truncation), so two distinct (rollout, version)
// pairs can map to one name.
var ErrApprovalCollision = errors.New("a RolloutApproval with this name already exists for a different rollout or version")

// ApprovalName returns the deterministic RolloutApproval name for a rollout and
// a version tag. The rule is binding on three implementations and MUST stay
// byte for byte identical with hack/migrate-approval-gates.sh in
// rollout-controller (see .work/approvals/CONTRACT.md "naming rule"):
//
//  1. s = lowercase(version), every character outside [a-z0-9-] becomes "-".
//  2. n = rollout + "-" + s, trailing "-" stripped.
//  3. len(n) <= 63: n.
//  4. otherwise: first 54 chars of n with trailing "-" and "." stripped, then
//     "-" + first 8 hex chars of sha256(version) (raw bytes).
func ApprovalName(rollout, version string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(version) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			b.WriteRune(r)
		} else {
			b.WriteByte('-')
		}
	}
	n := strings.TrimRight(rollout+"-"+b.String(), "-")
	if len(n) <= 63 {
		return n
	}
	sum := sha256.Sum256([]byte(version))
	h := hex.EncodeToString(sum[:])[:8]
	// n holds only ASCII here when rollout is a DNS name (the sanitiser maps
	// everything else to "-"); slice by bytes like the shell rule does.
	return strings.TrimRight(n[:54], "-.") + "-" + h
}

// ApproverIdentity is the `by` value for an approval: the username when it is
// known and not a service account (the same rule as rollout.kuberik.com/deploy-user).
func ApproverIdentity(username string, isServiceAccount bool) string {
	if isServiceAccount || username == "" || strings.HasPrefix(username, serviceAccountPrefix) {
		return ""
	}
	return username
}

// CandidateTags returns every tag that counts as a current release candidate
// for the rollout, mirroring what the dashboard frontend offers (frontend
// src/lib/releases/catalogue.ts rolloutReleases): releases newer than the
// deployed one from the catalogue (oldest to newest by sequence), plus the
// controller's own working set status.candidates, plus the deprecated
// status.releaseCandidates for rollouts the old controller still serves.
// catalogue may be nil (no ReleaseSource, CRD missing).
func CandidateTags(r *rolloutv1alpha1.Rollout, catalogue []string) map[string]struct{} {
	out := map[string]struct{}{}
	for _, c := range r.Status.Candidates {
		out[c.Tag] = struct{}{}
	}
	for _, v := range r.Status.ReleaseCandidates {
		out[v.Tag] = struct{}{}
	}
	deployed := ""
	if len(r.Status.History) > 0 {
		deployed = r.Status.History[0].Version.Tag
	}
	if deployed == "" {
		for _, t := range catalogue {
			out[t] = struct{}{}
		}
		return out
	}
	for i, t := range catalogue {
		if t == deployed {
			for _, n := range catalogue[i+1:] {
				out[n] = struct{}{}
			}
			break
		}
	}
	return out
}

// RolloutCatalogueTags reads the rollout's release catalogue tags, oldest to
// newest by sequence. A rollout without a releaseSourceRef, or a cluster
// without the release CRDs, yields nil and no error.
func (c *Client) RolloutCatalogueTags(ctx context.Context, r *rolloutv1alpha1.Rollout) ([]string, error) {
	if r.Spec.ReleaseSourceRef == nil || r.Spec.ReleaseSourceRef.Name == "" {
		return nil, nil
	}
	slices, err := c.GetReleaseSlices(ctx, r.Namespace)
	if err != nil {
		if IsCRDNotInstalled(err) || apierrors.IsNotFound(err) {
			return nil, nil
		}
		return nil, err
	}
	type seqTag struct {
		seq int64
		tag string
	}
	var all []seqTag
	for _, s := range slices.Items {
		if s.Source != r.Spec.ReleaseSourceRef.Name {
			continue
		}
		for _, rel := range s.Releases {
			all = append(all, seqTag{rel.Sequence, rel.Tag})
		}
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].seq < all[j].seq })
	tags := make([]string, len(all))
	for i, e := range all {
		tags[i] = e.tag
	}
	return tags, nil
}

// ApproveVersion creates the RolloutApproval for (rollout, version) and
// returns it. AlreadyExists with an identical spec is success (idempotent);
// with a different spec it is ErrApprovalCollision. by is the approver
// identity, already filtered through ApproverIdentity ("" omits the annotation).
// When legacy approval gates exist their allowedVersions gain the version too
// (migration dual-write, removed in the cleanup PR).
func (c *Client) ApproveVersion(ctx context.Context, rollout *rolloutv1alpha1.Rollout, version, by string) (*rolloutv1alpha1.RolloutApproval, error) {
	ap := &rolloutv1alpha1.RolloutApproval{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: rollout.Namespace,
			Name:      ApprovalName(rollout.Name, version),
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: rolloutv1alpha1.GroupVersion.String(),
				Kind:       "Rollout",
				Name:       rollout.Name,
				UID:        rollout.UID,
			}},
		},
		Spec: rolloutv1alpha1.RolloutApprovalSpec{
			RolloutRef: corev1LocalRef(rollout.Name),
			Version:    version,
		},
	}
	if by != "" {
		ap.Annotations = map[string]string{AnnotationApprovalBy: by}
	}
	if err := c.client.Create(ctx, ap); err != nil {
		if !apierrors.IsAlreadyExists(err) {
			return nil, fmt.Errorf("failed to create RolloutApproval %s/%s: %w", ap.Namespace, ap.Name, err)
		}
		existing := &rolloutv1alpha1.RolloutApproval{}
		if gerr := c.client.Get(ctx, client.ObjectKeyFromObject(ap), existing); gerr != nil {
			return nil, fmt.Errorf("failed to read existing RolloutApproval %s/%s: %w", ap.Namespace, ap.Name, gerr)
		}
		if existing.Spec.RolloutRef.Name != rollout.Name || existing.Spec.Version != version {
			return nil, fmt.Errorf("%w: %s/%s approves %q for %q", ErrApprovalCollision, ap.Namespace, ap.Name, existing.Spec.Version, existing.Spec.RolloutRef.Name)
		}
		ap = existing
	}
	if err := c.setLegacyGateVersion(ctx, rollout.Namespace, rollout.Name, version, true); err != nil {
		return nil, err
	}
	return ap, nil
}

// RevokeResult is what RevokeVersion found after deleting.
type RevokeResult struct {
	// Remaining are other RolloutApprovals (e.g. committed in git) for the same
	// rollout and version that keep the version approved.
	Remaining []rolloutv1alpha1.RolloutApproval
}

// RevokeVersion deletes the deterministic-name RolloutApproval (NotFound is
// success) and reports any other approval of the same rollout and version. It
// never deletes an approval it did not create under the deterministic name.
// Legacy gates lose the version only when nothing else still approves it.
func (c *Client) RevokeVersion(ctx context.Context, namespace, rolloutName, version string) (*RevokeResult, error) {
	name := ApprovalName(rolloutName, version)
	existing := &rolloutv1alpha1.RolloutApproval{}
	err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, existing)
	switch {
	case err == nil:
		// Only delete our own: a colliding name for another rollout/version is not ours.
		if existing.Spec.RolloutRef.Name == rolloutName && existing.Spec.Version == version {
			if derr := c.client.Delete(ctx, existing); derr != nil && !apierrors.IsNotFound(derr) {
				return nil, fmt.Errorf("failed to delete RolloutApproval %s/%s: %w", namespace, name, derr)
			}
		}
	case apierrors.IsNotFound(err):
	default:
		return nil, fmt.Errorf("failed to read RolloutApproval %s/%s: %w", namespace, name, err)
	}
	all, err := c.ListRolloutApprovals(ctx, namespace, rolloutName)
	if err != nil {
		return nil, err
	}
	res := &RevokeResult{}
	for _, a := range all {
		if a.Spec.Version == version {
			res.Remaining = append(res.Remaining, a)
		}
	}
	if len(res.Remaining) == 0 {
		if err := c.setLegacyGateVersion(ctx, namespace, rolloutName, version, false); err != nil {
			return nil, err
		}
	}
	return res, nil
}

// ListRolloutApprovals lists the RolloutApprovals of one rollout, sorted by
// creation time then name. A cluster without the CRD yields none.
func (c *Client) ListRolloutApprovals(ctx context.Context, namespace, rolloutName string) ([]rolloutv1alpha1.RolloutApproval, error) {
	list := &rolloutv1alpha1.RolloutApprovalList{}
	if err := c.client.List(ctx, list, client.InNamespace(namespace)); err != nil {
		if IsCRDNotInstalled(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to list RolloutApprovals: %w", err)
	}
	out := make([]rolloutv1alpha1.RolloutApproval, 0, len(list.Items))
	for _, a := range list.Items {
		if a.Spec.RolloutRef.Name == rolloutName {
			out = append(out, a)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		ti, tj := out[i].CreationTimestamp.Time, out[j].CreationTimestamp.Time
		if !ti.Equal(tj) {
			return ti.Before(tj)
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

// IsLegacyApprovalGate reports the ungraduated gate shape the approve action
// used to edit: ownerless, carrying no gate.kuberik.com marker label, with
// spec.allowedVersions set (non-nil, possibly empty). Same shape rule as
// GateKind's last case; removed together with it in the cleanup PR.
func IsLegacyApprovalGate(g *rolloutv1alpha1.RolloutGate) bool {
	if g == nil || len(g.OwnerReferences) != 0 || g.Spec.AllowedVersions == nil {
		return false
	}
	for k := range g.Labels {
		if strings.HasPrefix(k, "gate.kuberik.com/") && k != "gate.kuberik.com/pretty-name" {
			return false
		}
	}
	return GateKind(g) == GateKindApproval
}

// setLegacyGateVersion adds (add=true) or removes the version in the
// allowedVersions of every legacy approval gate of the rollout. Each gate is
// written with a resourceVersion-checked Update retried on conflict, so a
// concurrent edit is merged, never overwritten. An empty result stays [] (nil
// would mean "no opinion" and open the gate).
func (c *Client) setLegacyGateVersion(ctx context.Context, namespace, rolloutName, version string, add bool) error {
	gates, err := c.GetRolloutGatesByRolloutReference(ctx, namespace, rolloutName)
	if err != nil {
		if IsCRDNotInstalled(err) {
			return nil
		}
		return err
	}
	for i := range gates.Items {
		if !IsLegacyApprovalGate(&gates.Items[i]) {
			continue
		}
		key := client.ObjectKeyFromObject(&gates.Items[i])
		err := retry.RetryOnConflict(retry.DefaultRetry, func() error {
			g := &rolloutv1alpha1.RolloutGate{}
			if err := c.client.Get(ctx, key, g); err != nil {
				return err
			}
			if !IsLegacyApprovalGate(g) {
				return nil
			}
			cur := *g.Spec.AllowedVersions
			next := make([]string, 0, len(cur)+1)
			has := false
			for _, v := range cur {
				if v == version {
					has = true
					if !add {
						continue
					}
				}
				next = append(next, v)
			}
			if add == has {
				return nil // already in the wanted state
			}
			if add {
				next = append(next, version)
			}
			g.Spec.AllowedVersions = &next
			return c.client.Update(ctx, g)
		})
		if err != nil {
			if apierrors.IsNotFound(err) {
				continue
			}
			return fmt.Errorf("failed to update legacy approval gate %s/%s: %w", key.Namespace, key.Name, err)
		}
	}
	return nil
}

func corev1LocalRef(name string) corev1.LocalObjectReference {
	return corev1.LocalObjectReference{Name: name}
}
