package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"weblens/server/internal/cluster"

	"github.com/gin-gonic/gin"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const clusterCombosFile = "config/cluster-combos.json"

// ClusterCombo represents a preset of (clusterId + namespace) with optional alias.
type ClusterCombo struct {
	ID        string `json:"id"`
	ClusterID string `json:"clusterId"`
	Namespace string `json:"namespace"`
	Alias     string `json:"alias,omitempty"`
}

var (
	clusterCombosMu sync.RWMutex
)

func loadClusterCombos() ([]ClusterCombo, error) {
	clusterCombosMu.RLock()
	defer clusterCombosMu.RUnlock()

	b, err := os.ReadFile(clusterCombosFile)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []ClusterCombo{}, nil
		}
		return nil, err
	}
	var items []ClusterCombo
	if err := json.Unmarshal(b, &items); err != nil {
		return nil, err
	}
	return items, nil
}

func saveClusterCombos(items []ClusterCombo) error {
	clusterCombosMu.Lock()
	defer clusterCombosMu.Unlock()

	if err := os.MkdirAll(filepath.Dir(clusterCombosFile), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(items, "", "  ")
	if err != nil {
		return err
	}
	tmp := clusterCombosFile + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, clusterCombosFile)
}

func findClusterCombo(items []ClusterCombo, id string) (ClusterCombo, bool) {
	for _, it := range items {
		if it.ID == id {
			return it, true
		}
	}
	return ClusterCombo{}, false
}

// comboID generates a simple deterministic id from clusterId and namespace.
func comboID(clusterID, namespace string) string {
	return fmt.Sprintf("%s|%s", clusterID, namespace)
}

func registerClusterComboRoutes(r *gin.Engine, reg *cluster.Registry) {
	// List all combos
	r.GET("/api/cluster-combos", func(c *gin.Context) {
		items, err := loadClusterCombos()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"items": items})
	})

	// Add or upsert a combo
	r.POST("/api/cluster-combos", func(c *gin.Context) {
		var body struct {
			ClusterID string `json:"clusterId"`
			Namespace string `json:"namespace"`
			Alias     string `json:"alias"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求体不合法"})
			return
		}
		body.ClusterID = stringTrimSpace(body.ClusterID)
		body.Namespace = stringTrimSpace(body.Namespace)
		if body.ClusterID == "" || body.Namespace == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "clusterId 与 namespace 均不能为空"})
			return
		}
		if _, ok := reg.Cluster(body.ClusterID); !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "clusterId 无效，请先确认集群已加载"})
			return
		}
		items, err := loadClusterCombos()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		id := comboID(body.ClusterID, body.Namespace)
		found := false
		for i := range items {
			if items[i].ID == id {
				items[i].Alias = body.Alias
				found = true
				break
			}
		}
		if !found {
			items = append(items, ClusterCombo{
				ID:        id,
				ClusterID: body.ClusterID,
				Namespace: body.Namespace,
				Alias:     body.Alias,
			})
		}
		if err := saveClusterCombos(items); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"items": items})
	})

	// Update alias of a combo
	r.PUT("/api/cluster-combos/:id", func(c *gin.Context) {
		id := c.Param("id")
		var body struct {
			Alias string `json:"alias"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求体不合法"})
			return
		}
		items, err := loadClusterCombos()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		updated := false
		for i := range items {
			if items[i].ID == id {
				items[i].Alias = body.Alias
				updated = true
				break
			}
		}
		if !updated {
			c.JSON(http.StatusNotFound, gin.H{"error": "组合不存在"})
			return
		}
		if err := saveClusterCombos(items); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"items": items})
	})

	// Delete a combo
	r.DELETE("/api/cluster-combos/:id", func(c *gin.Context) {
		id := c.Param("id")
		items, err := loadClusterCombos()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		next := make([]ClusterCombo, 0, len(items))
		deleted := false
		for _, it := range items {
			if it.ID == id {
				deleted = true
				continue
			}
			next = append(next, it)
		}
		if !deleted {
			c.JSON(http.StatusNotFound, gin.H{"error": "组合不存在"})
			return
		}
		if err := saveClusterCombos(next); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"items": next})
	})

	// Test a combo by performing a lightweight Pods.List namespace-scoped call.
	r.POST("/api/cluster-combos/:id/test", func(c *gin.Context) {
		id := c.Param("id")
		items, err := loadClusterCombos()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		combo, ok := findClusterCombo(items, id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "组合不存在"})
			return
		}
		client, ok := reg.Client(combo.ClusterID)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "集群尚未加载或已失效"})
			return
		}
		ctx, cancel := contextWithTimeout(c, 5*time.Second)
		defer cancel()
		// 只取 1 条记录即可验证 namespace 及权限
		_, err = client.CoreV1().Pods(combo.Namespace).List(ctx, metav1.ListOptions{Limit: 1})
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"ok": false, "error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
}

// contextWithTimeout wraps gin.Context to derive a cancellable context.
func contextWithTimeout(c *gin.Context, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(c.Request.Context(), d)
}

func stringTrimSpace(s string) string {
	return strings.TrimSpace(s)
}

