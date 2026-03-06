package config

import (
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/joho/godotenv"
)

const (
	defaultHTTPAddr       = "0.0.0.0:8080"
	defaultKubeconfigDir  = "./kubeconfigs"
	defaultWebDistDir     = "./web/dist"
	kubeconfigDirOverride = "config/kubeconfig-dir.override"
)

var (
	kubeconfigDirOverrideVal string
	kubeconfigDirMu          sync.RWMutex
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
// If a path was set via SetKubeconfigDirOverride (e.g. from UI), that is returned; otherwise env or default.
func KubeconfigDir() string {
	kubeconfigDirMu.RLock()
	override := kubeconfigDirOverrideVal
	kubeconfigDirMu.RUnlock()
	if override != "" {
		return override
	}
	if v := os.Getenv("WEBLENS_KUBECONFIG_DIR"); v != "" {
		return v
	}
	return defaultKubeconfigDir
}

// SetKubeconfigDirOverride sets the kubeconfig directory override and persists it to config/kubeconfig-dir.override.
// Pass "" to clear the override (use env/default again). Caller should validate that dir exists before calling.
func SetKubeconfigDirOverride(dir string) error {
	kubeconfigDirMu.Lock()
	defer kubeconfigDirMu.Unlock()
	dir = strings.TrimSpace(dir)
	kubeconfigDirOverrideVal = dir
	// Persist: write to override file so next startup keeps it
	if dir == "" {
		_ = os.Remove(kubeconfigDirOverride)
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(kubeconfigDirOverride), 0755); err != nil {
		return err
	}
	return os.WriteFile(kubeconfigDirOverride, []byte(dir+"\n"), 0600)
}

// WebDistDir returns directory that stores frontend built assets (Vite dist).
func WebDistDir() string {
	if v := os.Getenv("WEBLENS_WEB_DIST_DIR"); v != "" {
		return v
	}
	return defaultWebDistDir
}

// DefaultNamespace returns the default namespace for clusters whose kubeconfig context has no namespace set.
// Set WEBLENS_DEFAULT_NAMESPACE in env or config/weblens.env when kubeconfig cannot be modified.
func DefaultNamespace() string {
	return os.Getenv("WEBLENS_DEFAULT_NAMESPACE")
}

// BasicAuth returns (user, password) if both WEBLENS_AUTH_USER and WEBLENS_AUTH_PASSWORD are set; otherwise ("", "").
func BasicAuth() (user, password string) {
	user = os.Getenv("WEBLENS_AUTH_USER")
	password = os.Getenv("WEBLENS_AUTH_PASSWORD")
	if user == "" || password == "" {
		return "", ""
	}
	return user, password
}

func init() {
	// best-effort auto load when imported
	if err := godotenv.Load("config/weblens.env"); err != nil {
		_ = godotenv.Load()
		log.Printf("config: no weblens.env found, using defaults/environment")
	}
	// Load UI-overridden kubeconfig dir if present
	if b, err := os.ReadFile(kubeconfigDirOverride); err == nil {
		if s := strings.TrimSpace(string(b)); s != "" {
			kubeconfigDirOverrideVal = s
			log.Printf("config: using kubeconfig dir from override file: %s", s)
		}
	}
}

