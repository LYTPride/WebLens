package httpapi

import (
	"net/http"
	"os"
	"path/filepath"

	"weblens/server/internal/auth"
	"weblens/server/internal/cluster"
	"weblens/server/internal/config"

	"github.com/gin-gonic/gin"
)

// NewRouter builds the HTTP router.
func NewRouter(reg *cluster.Registry, store *auth.Store) *gin.Engine {
	r := gin.Default()

	// Serve frontend (web/dist) from the same port to avoid CORS issues.
	registerStaticFrontend(r, config.WebDistDir())

	// healthz
	r.GET("/healthz", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	registerAuthPublicRoutes(r, store)
	r.Use(authRequired(store))
	registerAuthProtectedRoutes(r, store)

	registerAccessV2Routes(r, store)
	// list clusters
	r.GET("/api/clusters", func(c *gin.Context) {
		items, err := filterClustersForUser(c, store, reg.List())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"items": items,
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

	// platform config: get/set kubeconfig directory (no need to export on server)
	r.GET("/api/config", func(c *gin.Context) {
		dir, err := store.GetConfig(c.Request.Context(), "kubeconfig_dir")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if dir == "" {
			dir = config.KubeconfigDir()
		}
		c.JSON(http.StatusOK, gin.H{
			"kubeconfigDir": dir,
		})
	})
	r.POST("/api/config", func(c *gin.Context) {
		var body struct {
			KubeconfigDir string `json:"kubeconfigDir"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 kubeconfigDir"})
			return
		}
		dir := body.KubeconfigDir
		if dir == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请填写 kubeconfig 存放目录"})
			return
		}
		if !filepath.IsAbs(dir) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "仅支持绝对路径，请填写以 / 开头的完整路径"})
			return
		}
		info, err := os.Stat(dir)
		if err != nil {
			if os.IsNotExist(err) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "目录不存在"})
				return
			}
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if !info.IsDir() {
			c.JSON(http.StatusBadRequest, gin.H{"error": "路径不是目录"})
			return
		}
		if err := store.SetConfig(c.Request.Context(), "kubeconfig_dir", dir); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存配置失败: " + err.Error()})
			return
		}
		config.SetKubeconfigDirRuntime(dir)
		if err := reg.LoadFromDir(config.KubeconfigDir()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"kubeconfigDir": config.KubeconfigDir(),
			"items":         reg.List(),
		})
	})

	// resource routes (pods, deployments, nodes, etc.)
	registerResourceRoutes(r, reg, store)

	// pod logs
	registerLogRoutes(r, reg)

	// pod exec (WebSocket)
	registerExecRoutes(r, reg, store)

	// container files (exec based)
	registerFileRoutes(r, reg)

	// cluster combos (preset cluster + namespace)
	registerClusterComboRoutes(r, reg, store)

	registerAnalyticsRoutes(r)

	return r
}
