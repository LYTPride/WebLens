package httpapi

import (
	"net/http"

	"weblens/server/internal/cluster"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/gin-gonic/gin"
)

// registerResourceRoutes adds resource-related routes (pods, deployments, etc.).
func registerResourceRoutes(r *gin.Engine, reg *cluster.Registry) {
	// Namespaces
	r.GET("/api/clusters/:id/namespaces", func(c *gin.Context) {
		id := c.Param("id")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		list, err := client.CoreV1().Namespaces().List(c.Request.Context(), metav1.ListOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// Nodes
	r.GET("/api/clusters/:id/nodes", func(c *gin.Context) {
		id := c.Param("id")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		list, err := client.CoreV1().Nodes().List(c.Request.Context(), metav1.ListOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// Pods
	r.GET("/api/clusters/:id/pods", func(c *gin.Context) {
		id := c.Param("id")
		ns := c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		list, err := client.CoreV1().Pods(ns).List(c.Request.Context(), metav1.ListOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// Deployments
	r.GET("/api/clusters/:id/deployments", func(c *gin.Context) {
		id := c.Param("id")
		ns := c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		list, err := client.AppsV1().Deployments(ns).List(c.Request.Context(), metav1.ListOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})
}

