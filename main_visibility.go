package main

import (
	"fmt"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
)

// requireRolloutVisibility gates a namespace/object-scoped READ route: it
// checks whether the signed-in operator behind c may list Rollouts in ns
// (see pkg/kubernetes/visibility.go) and writes 403 + returns false if not.
// No-op (always true) when the request carries no OIDC token, matching
// today's service-account-only behavior.
//
// Call this once, right after extracting the namespace path param, before any
// read against the shared read client — it is the per-object-route half of
// the visibility boundary described in pkg/kubernetes/context.go; the
// cluster-wide half (filtering an already-fetched list, e.g. GET /api/rollouts)
// lives inline in that handler using kubernetes.AllowedNamespaces /
// kubernetes.FilterByNamespace instead, since there's no single namespace to
// gate on.
//
// Deliberately NOT applied to mutating (POST) routes: those already get
// real per-user RBAC enforcement at the apiserver via the write client's own
// bearer token (getK8sWriteClient), which is authoritative and uses the verb
// the mutation actually needs (update/patch), not "list".
func requireRolloutVisibility(c *gin.Context, namespace string) bool {
	allowed, err := kubernetes.CanListRolloutsInNamespace(c, namespace)
	if err != nil {
		log.Printf("Error checking namespace visibility for %q: %v", namespace, err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to check namespace visibility",
			"details": err.Error(),
		})
		return false
	}
	if !allowed {
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "forbidden",
			"details": fmt.Sprintf("not permitted to list rollouts in namespace %q", namespace),
		})
		return false
	}
	return true
}
