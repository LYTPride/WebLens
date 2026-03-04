package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

const (
	defaultHTTPAddr      = "0.0.0.0:8080"
	defaultKubeconfigDir = "./kubeconfigs"
	defaultWebDistDir    = "./web/dist"
)

// Load loads environment variables from .env if present.
func Load() {
	if err := godotenv.Load("config/weblens.env"); err != nil {
		// Fallback to default .env in current directory, ignore error if missing.
		_ = godotenv.Load()
	}
}

// HTTPAddr returns the listen address for the HTTP server.
func HTTPAddr() string {
	if v := os.Getenv("WEBLENS_HTTP_ADDR"); v != "" {
		return v
	}
	return defaultHTTPAddr
}

// KubeconfigDir returns directory that stores kubeconfig files.
func KubeconfigDir() string {
	if v := os.Getenv("WEBLENS_KUBECONFIG_DIR"); v != "" {
		return v
	}
	return defaultKubeconfigDir
}

// WebDistDir returns directory that stores frontend built assets (Vite dist).
func WebDistDir() string {
	if v := os.Getenv("WEBLENS_WEB_DIST_DIR"); v != "" {
		return v
	}
	return defaultWebDistDir
}

func init() {
	// best-effort auto load when imported
	if err := godotenv.Load("config/weblens.env"); err != nil {
		_ = godotenv.Load()
		log.Printf("config: no weblens.env found, using defaults/environment")
	}
}

