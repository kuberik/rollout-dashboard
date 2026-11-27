package main

import (
	"context"
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
	"github.com/kuberik/rollout-dashboard/pkg/rollbackcheck"
)

// handleRollbackCheck serves GET /api/rollouts/:namespace/:name/rollback-check?tag=<tag>:
// the dependency breaks a manual rollback to that history entry would cause.
// It is a warning source for the Roll back dialog, never a refusal. Spoke
// rollouts reach it through the usual cluster routing, so consumers are only
// ever looked up in the provider's own cluster.
func handleRollbackCheck(c *gin.Context) {
	k8sClient, ok := getK8sReadClient(c)
	if !ok {
		return
	}
	namespace := c.Param("namespace")
	if !requireRolloutVisibility(c, namespace) {
		return
	}
	name := c.Param("name")
	tag := c.Query("tag")
	if tag == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tag query parameter is required"})
		return
	}
	ctx := c.Request.Context()

	rollout, err := k8sClient.GetRollout(ctx, namespace, name)
	if err != nil {
		log.Printf("rollback-check: fetching rollout %s/%s: %v", namespace, name, err)
		writeUpstreamError(c, "Failed to fetch rollout", err)
		return
	}

	deps := listDependenciesForCheck(ctx, k8sClient)
	breaks, err := rollbackcheck.Check(rollout, tag, deps, memoRollouts(ctx, k8sClient))
	if errors.Is(err, rollbackcheck.ErrUnknownTag) {
		c.JSON(http.StatusNotFound, gin.H{"error": "tag " + tag + " is not in the deployment history of " + namespace + "/" + name})
		return
	}
	if err != nil {
		log.Printf("rollback-check: %s/%s tag %s: %v", namespace, name, tag, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check rollback", "details": err.Error()})
		return
	}
	// Never reveal a rollout in a namespace the viewer cannot list: drop those
	// breaks and report how many distinct rollouts were left out.
	nsList := make([]string, 0, len(breaks))
	for _, b := range breaks {
		nsList = append(nsList, b.Namespace)
	}
	allowedNS, err := kubernetes.AllowedNamespaces(c, nsList)
	if err != nil {
		log.Printf("rollback-check: checking namespace visibility: %v", err)
		writeUpstreamError(c, "Failed to check namespace visibility", err)
		return
	}
	visible := make([]rolloutv1alpha1.DependencyBreak, 0, len(breaks))
	hidden := map[string]struct{}{}
	for _, b := range breaks {
		if allowedNS[b.Namespace] {
			visible = append(visible, b)
		} else {
			// Only a hidden consumer a rollback would really break is worth a
			// warning: Allow edges and provider-side rows are trimmed silently.
			if b.Kind == "ConsumerRequires" && !b.Allowed {
				hidden[b.Namespace+"/"+b.Rollout] = struct{}{}
			}
		}
	}
	resp := gin.H{"tag": tag, "breaks": visible}
	if len(hidden) > 0 {
		resp["hiddenConsumers"] = len(hidden)
	}
	c.JSON(http.StatusOK, resp)
}

// listDependenciesForCheck lists RolloutDependencies cluster-wide. A cluster
// without the CRD (or a failed list) yields no dependencies, so the dialog
// simply shows no warning, matching how the rollout list treats the same error.
func listDependenciesForCheck(ctx context.Context, k *kubernetes.Client) []rolloutv1alpha1.RolloutDependency {
	list, err := k.GetRolloutDependenciesAllNamespaces(ctx)
	if err != nil || list == nil {
		if err != nil {
			log.Printf("rollback-check: listing rollout dependencies: %v", err)
		}
		return nil
	}
	return list.Items
}

// memoRollouts looks Rollouts up by key, once each; a missing or unreadable
// one is nil, which rollbacksafety treats as "not running anything".
func memoRollouts(ctx context.Context, k *kubernetes.Client) func(ns, name string) *rolloutv1alpha1.Rollout {
	cache := map[[2]string]*rolloutv1alpha1.Rollout{}
	return func(ns, name string) *rolloutv1alpha1.Rollout {
		key := [2]string{ns, name}
		if r, ok := cache[key]; ok {
			return r
		}
		r, err := k.GetRollout(ctx, ns, name)
		if err != nil {
			r = nil
		}
		cache[key] = r
		return r
	}
}
