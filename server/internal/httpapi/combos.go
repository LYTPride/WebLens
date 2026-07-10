package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"weblens/server/internal/auth"
	"weblens/server/internal/cluster"

	"github.com/gin-gonic/gin"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func registerClusterComboRoutes(r *gin.Engine, reg *cluster.Registry, store *auth.Store) {
	// List combos. Admin sees all scopes; normal users see only scopes granted to them.
	r.GET("/api/cluster-combos", func(c *gin.Context) {
		user, ok := currentUser(c)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
			return
		}
		items, err := store.ListCombosForUser(c.Request.Context(), user)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"items": items})
	})

	// Add or upsert a combo. Admin only by auth middleware.
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
		body.ClusterID = strings.TrimSpace(body.ClusterID)
		body.Namespace = strings.TrimSpace(body.Namespace)
		if body.ClusterID == "" || body.Namespace == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "clusterId 与 namespace 均不能为空"})
			return
		}
		if _, ok := reg.Cluster(body.ClusterID); !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "clusterId 无效，请先确认集群已加载"})
			return
		}
		items, err := store.UpsertCombo(c.Request.Context(), body.ClusterID, body.Namespace, body.Alias)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"items": items})
	})

	r.PUT("/api/cluster-combos/:id", func(c *gin.Context) {
		id := c.Param("id")
		var body struct {
			Alias string `json:"alias"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求体不合法"})
			return
		}
		items, err := store.UpdateComboAlias(c.Request.Context(), id, body.Alias)
		if err != nil {
			if errors.Is(err, auth.ErrForbidden) {
				c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
				return
			}
			if status := errorStatus(err); status == http.StatusNotFound {
				c.JSON(status, gin.H{"error": "作用域不存在"})
			} else {
				c.JSON(status, gin.H{"error": err.Error()})
			}
			return
		}
		c.JSON(http.StatusOK, gin.H{"items": items})
	})

	r.DELETE("/api/cluster-combos/:id", func(c *gin.Context) {
		id := c.Param("id")
		items, err := store.DeleteCombo(c.Request.Context(), id)
		if err != nil {
			if status := errorStatus(err); status == http.StatusNotFound {
				c.JSON(status, gin.H{"error": "作用域不存在"})
			} else {
				c.JSON(status, gin.H{"error": err.Error()})
			}
			return
		}
		c.JSON(http.StatusOK, gin.H{"items": items})
	})

	// Test a combo by performing a lightweight Pods.List namespace-scoped call.
	r.POST("/api/cluster-combos/:id/test", func(c *gin.Context) {
		id := c.Param("id")
		combo, err := store.ComboByID(c.Request.Context(), id)
		if err != nil {
			if status := errorStatus(err); status == http.StatusNotFound {
				c.JSON(status, gin.H{"error": "作用域不存在"})
			} else {
				c.JSON(status, gin.H{"error": err.Error()})
			}
			return
		}
		client, ok := reg.Client(combo.ClusterID)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "集群尚未加载或已失效"})
			return
		}
		ctx, cancel := contextWithTimeout(c, 5*time.Second)
		defer cancel()
		_, err = client.CoreV1().Pods(combo.Namespace).List(ctx, metav1.ListOptions{Limit: 1})
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"ok": false, "error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
}

func contextWithTimeout(c *gin.Context, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(c.Request.Context(), d)
}
