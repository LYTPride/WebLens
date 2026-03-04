package httpapi

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// registerStaticFrontend serves Vite dist directory on "/".
// It keeps "/api" and "/healthz" routes for backend.
func registerStaticFrontend(r *gin.Engine, distDir string) {
	if distDir == "" {
		return
	}

	info, err := os.Stat(distDir)
	if err != nil || !info.IsDir() {
		return
	}

	// Serve assets and any static files under dist.
	r.StaticFS("/assets", http.Dir(filepath.Join(distDir, "assets")))
	r.StaticFile("/favicon.ico", filepath.Join(distDir, "favicon.ico"))

	indexPath := filepath.Join(distDir, "index.html")

	// Root page
	r.GET("/", func(c *gin.Context) {
		c.File(indexPath)
	})

	// SPA fallback for client-side routing
	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if strings.HasPrefix(path, "/api/") || path == "/api" || path == "/healthz" || path == "/healthz/" {
			c.Status(http.StatusNotFound)
			return
		}
		c.File(indexPath)
	})
}

