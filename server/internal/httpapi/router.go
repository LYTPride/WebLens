package httpapi

import (
	"net/http"
	"os"
	"path/filepath"

	"weblens/server/internal/cluster"
	"weblens/server/internal/config"

	"github.com/gin-gonic/gin"
)

// NewRouter builds the HTTP router.
func NewRouter(reg *cluster.Registry) *gin.Engine {
	r := gin.Default()

	// Optional Basic Auth (when WEBLENS_AUTH_USER and WEBLENS_AUTH_PASSWORD are set)
	if user, pass := config.BasicAuth(); user != "" && pass != "" {
		r.Use(gin.BasicAuth(gin.Accounts{user: pass}))
	}

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

	// platform config: get/set kubeconfig directory (no need to export on server)
	r.GET("/api/config", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"kubeconfigDir": config.KubeconfigDir(),
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
		if err := config.SetKubeconfigDirOverride(dir); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存配置失败: " + err.Error()})
			return
		}
		if err := reg.LoadFromDir(config.KubeconfigDir()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"kubeconfigDir": config.KubeconfigDir(),
			"items":         reg.List(),
		})
	})

	// resource routes (pods, deployments, namespaces, nodes, etc.)
	registerResourceRoutes(r, reg)

	// pod logs
	registerLogRoutes(r, reg)

	// pod exec (WebSocket)
	registerExecRoutes(r, reg)

	// cluster combos (preset cluster + namespace)
	registerClusterComboRoutes(r, reg)

	return r
}
