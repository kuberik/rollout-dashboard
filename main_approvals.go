package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
)

// Manual approvals API (docs: APPROVALS-API.md section 8.1; wire contract in
// .work/approvals/CONTRACT.md). Handlers stay thin: the work is in
// pkg/kubernetes/approvals.go.

// approverIdentityFn resolves the signed-in user's identity with their own
// client (SelfSubjectReview). A seam for tests; the real *Client has no fake.
var approverIdentityFn = func(ctx context.Context, c *kubernetes.Client) (string, bool, error) {
	return c.GetCurrentUserIdentity(ctx)
}

// approvalsListClientFn returns the client the approvals LIST runs on: the
// dashboard's own service account, live (RolloutApproval is not in the
// informer cache, whose CRD set is fixed at startup). Callers must have passed
// requireRolloutVisibility. A seam for tests.
var approvalsListClientFn = func() (*kubernetes.Client, error) { return kubernetes.GetDefaultClient() }

// approvalByVerified reports whether the `by` annotation can be trusted on
// this cluster. A seam for tests.
var approvalByVerified = func(ctx context.Context) bool { return kubernetes.DefaultApprovalByVerifier.Verified(ctx) }

type approvalJSON struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	By        string `json:"by,omitempty"`
	CreatedAt string `json:"createdAt,omitempty"`
}

func registerApprovalRoutes(api *gin.RouterGroup) {
	api.POST("/rollouts/:namespace/:name/approve", handleApprove)
	api.GET("/rollouts/:namespace/:name/approvals", handleListApprovals)
}

func handleApprove(c *gin.Context) {
	namespace, name := c.Param("namespace"), c.Param("name")
	var req struct {
		Version string `json:"version"`
		Revoke  bool   `json:"revoke"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body", "details": err.Error()})
		return
	}
	if strings.TrimSpace(req.Version) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "version is required"})
		return
	}
	wc, ok := getK8sWriteClient(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()

	if req.Revoke {
		res, err := wc.RevokeVersion(ctx, namespace, name, req.Version)
		if err != nil {
			log.Printf("approve: revoke %s/%s %q: %v", namespace, name, req.Version, err)
			writeUpstreamError(c, "Failed to revoke approval", err)
			return
		}
		if len(res.Remaining) == 0 {
			c.JSON(http.StatusOK, gin.H{})
			return
		}
		verified := approvalByVerified(ctx)
		out := make([]approvalJSON, 0, len(res.Remaining))
		for _, a := range res.Remaining {
			out = append(out, toApprovalJSON(&a, verified))
		}
		c.JSON(http.StatusOK, gin.H{"stillApproved": true, "approvals": revokeEntries(out)})
		return
	}

	rollout, err := wc.GetRollout(ctx, namespace, name)
	if err != nil {
		log.Printf("approve: get rollout %s/%s: %v", namespace, name, err)
		writeUpstreamError(c, "Failed to get rollout", err)
		return
	}
	rc, ok := getK8sReadClient(c)
	if !ok {
		return
	}
	catalogue, err := rc.RolloutCatalogueTags(ctx, rollout)
	if err != nil {
		log.Printf("approve: catalogue for %s/%s: %v", namespace, name, err)
		writeUpstreamError(c, "Failed to read the release catalogue", err)
		return
	}
	if _, isCandidate := kubernetes.CandidateTags(rollout, catalogue)[req.Version]; !isCandidate {
		c.JSON(http.StatusConflict, gin.H{"error": "version " + req.Version + " is not a current release candidate of " + name})
		return
	}

	by := ""
	if username, isSA, err := approverIdentityFn(ctx, wc); err == nil {
		by = kubernetes.ApproverIdentity(username, isSA)
	} else {
		log.Printf("approve: identity for %s/%s: %v (approval is created without by)", namespace, name, err)
	}
	ap, err := wc.ApproveVersion(ctx, rollout, req.Version, by)
	if err != nil {
		if errors.Is(err, kubernetes.ErrApprovalCollision) {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		log.Printf("approve: %s/%s %q: %v", namespace, name, req.Version, err)
		writeUpstreamError(c, "Failed to approve version", err)
		return
	}
	// A freshly written by is the caller's own; one found on an existing
	// object is only shown when admission enforces it.
	verified := approvalByVerified(ctx) || (by != "" && ap.Annotations[kubernetes.AnnotationApprovalBy] == by)
	a := toApprovalJSON(ap, verified)
	body := gin.H{"name": a.Name, "version": a.Version}
	if a.By != "" {
		body["by"] = a.By
	}
	c.JSON(http.StatusOK, gin.H{"approval": body})
}

func handleListApprovals(c *gin.Context) {
	namespace, name := c.Param("namespace"), c.Param("name")
	if !requireRolloutVisibility(c, namespace) {
		return
	}
	lc, err := approvalsListClientFn()
	if err != nil {
		log.Printf("approvals: client: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to initialize Kubernetes client", "details": err.Error()})
		return
	}
	items, err := lc.ListRolloutApprovals(c.Request.Context(), namespace, name)
	if err != nil {
		log.Printf("approvals: list %s/%s: %v", namespace, name, err)
		writeUpstreamError(c, "Failed to list approvals", err)
		return
	}
	verified := approvalByVerified(c.Request.Context())
	out := make([]approvalJSON, 0, len(items))
	for i := range items {
		out = append(out, toApprovalJSON(&items[i], verified))
	}
	c.JSON(http.StatusOK, gin.H{"byVerified": verified, "approvals": out})
}

func toApprovalJSON(a *rolloutv1alpha1.RolloutApproval, verified bool) approvalJSON {
	j := approvalJSON{Name: a.Name, Version: a.Spec.Version, CreatedAt: a.CreationTimestamp.UTC().Format("2006-01-02T15:04:05Z")}
	if verified {
		j.By = a.Annotations[kubernetes.AnnotationApprovalBy]
	}
	return j
}

// revokeEntries is the stillApproved shape: name and by only.
func revokeEntries(in []approvalJSON) []gin.H {
	out := make([]gin.H, 0, len(in))
	for _, a := range in {
		e := gin.H{"name": a.Name}
		if a.By != "" {
			e["by"] = a.By
		}
		out = append(out, e)
	}
	return out
}
