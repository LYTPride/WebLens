package httpapi

import (
	"net/http"

	"weblens/server/internal/cluster"
	"weblens/server/internal/config"

	"github.com/gin-gonic/gin"
)

// NewRouter builds the HTTP router.
func NewRouter(reg *cluster.Registry) *gin.Engine {
	r := gin.Default()

	// Serve frontend (web/dist) from the same port to avoid CORS issues.
	registerStaticFrontend(r, config.WebDistDir())

	// healthz
	r.GET("/healthz", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	// list clusters
	r.GET("/api/clusters", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"items": reg.List(),
		})
	})

	// reload clusters from kubeconfig dir (manual refresh)
	r.POST("/api/clusters/reload", func(c *gin.Context) {
		if err := reg.LoadFromDir(config.KubeconfigDir()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": err.Error(),
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"items": reg.List(),
		})
	})

	// resource routes (pods, deployments, namespaces, nodes, etc.)
	registerResourceRoutes(r, reg)

	// pod logs
	registerLogRoutes(r, reg)

	return r
}
