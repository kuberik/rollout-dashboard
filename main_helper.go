package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
)

// getK8sClient is a helper function to get Kubernetes client from context
// It returns an error response if the client cannot be obtained
func getK8sClient(c *gin.Context) (*kubernetes.Client, bool) {
	k8sClient, err := kubernetes.GetClientFromContext(c)
	if err != nil {
		log.Printf("Failed to get Kubernetes client: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to initialize Kubernetes client",
			"details": err.Error(),
		})
		return nil, false
	}
	return k8sClient, true
}
