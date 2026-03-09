package httpapi

import (
	"context"
	"log"
	"net/http"
	"strings"

	"weblens/server/internal/cluster"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/gin-gonic/gin"
	"sigs.k8s.io/yaml"
)

// isForbiddenClusterScope 判断是否为「无集群级权限」类错误
func isForbiddenClusterScope(err error) bool {
	s := err.Error()
	return strings.Contains(s, "forbidden") && strings.Contains(s, "cluster scope")
}

// defaultNamespaceForCluster 返回该集群在 kubeconfig 中的默认命名空间（无则空）
func defaultNamespaceForCluster(reg *cluster.Registry, id string) string {
	clu, ok := reg.Cluster(id)
	if !ok || clu == nil {
		return ""
	}
	return clu.DefaultNamespace
}

// listPodsAllNamespacesFallback 在无集群级 list pods 权限时：先 list namespaces，再按命名空间 list pods 并合并
func listPodsAllNamespacesFallback(ctx context.Context, client *kubernetes.Clientset) (*corev1.PodList, error) {
	nsList, err := client.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	var all corev1.PodList
	for i := range nsList.Items {
		name := nsList.Items[i].Name
		list, err := client.CoreV1().Pods(name).List(ctx, metav1.ListOptions{})
		if err != nil {
			log.Printf("pods list namespace=%s (fallback): %v", name, err)
			continue
		}
		all.Items = append(all.Items, list.Items...)
	}
	return &all, nil
}

// registerResourceRoutes adds resource-related routes (pods, deployments, etc.).
func registerResourceRoutes(r *gin.Engine, reg *cluster.Registry) {
	// Namespaces（无集群级 list namespaces 权限时返回 200 空列表，避免 500）
	r.GET("/api/clusters/:id/namespaces", func(c *gin.Context) {
		id := c.Param("id")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		list, err := client.CoreV1().Namespaces().List(c.Request.Context(), metav1.ListOptions{})
		if err != nil {
			if isForbiddenClusterScope(err) {
				c.JSON(http.StatusOK, gin.H{"items": []corev1.Namespace{}})
				return
			}
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

	// Pods（无集群级权限时：先按 ns 逐个合并；若 list namespaces 也被禁止则用 context 默认 namespace 或返回空）
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
			if ns == corev1.NamespaceAll && isForbiddenClusterScope(err) {
				list, err = listPodsAllNamespacesFallback(c.Request.Context(), client)
			}
			if err != nil {
				// 例如 list namespaces 也被禁止：用 kubeconfig context 的 defaultNamespace 再试一次
				if isForbiddenClusterScope(err) {
					if clu, ok := reg.Cluster(id); ok && clu.DefaultNamespace != "" {
						list, err = client.CoreV1().Pods(clu.DefaultNamespace).List(c.Request.Context(), metav1.ListOptions{})
					}
				}
				if err != nil {
					if isForbiddenClusterScope(err) {
						c.JSON(http.StatusOK, gin.H{"items": []corev1.Pod{}})
						return
					}
					log.Printf("pods list cluster=%s namespace=%s: %v", id, ns, err)
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
			}
		}
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// Get Pod YAML（用于编辑）
	r.GET("/api/clusters/:id/pods/:namespace/:pod/yaml", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("pod")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		pod, err := client.CoreV1().Pods(ns).Get(c.Request.Context(), name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		raw, err := yaml.Marshal(pod)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Data(http.StatusOK, "text/yaml; charset=utf-8", raw)
	})

	// Apply Pod（从 YAML 更新）
	r.PUT("/api/clusters/:id/pods/:namespace/:pod", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("pod")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		body, err := c.GetRawData()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		var pod corev1.Pod
		if err := yaml.Unmarshal(body, &pod); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid YAML: " + err.Error()})
			return
		}
		existing, err := client.CoreV1().Pods(ns).Get(c.Request.Context(), name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		pod.Namespace = ns
		pod.Name = name
		pod.ResourceVersion = existing.ResourceVersion
		_, err = client.CoreV1().Pods(ns).Update(c.Request.Context(), &pod, metav1.UpdateOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusOK)
	})

	// Delete Pod
	r.DELETE("/api/clusters/:id/pods/:namespace/:pod", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("pod")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		err := client.CoreV1().Pods(ns).Delete(c.Request.Context(), name, metav1.DeleteOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusOK)
	})

	// Deployments（无集群级权限时用 context 默认 namespace 或返回空）
	r.GET("/api/clusters/:id/deployments", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
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
			if ns == corev1.NamespaceAll && isForbiddenClusterScope(err) {
				if def := defaultNamespaceForCluster(reg, id); def != "" {
					list, err = client.AppsV1().Deployments(def).List(c.Request.Context(), metav1.ListOptions{})
				}
			}
			if err != nil {
				if isForbiddenClusterScope(err) {
					c.JSON(http.StatusOK, gin.H{"items": []interface{}{}})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// StatefulSets
	r.GET("/api/clusters/:id/statefulsets", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		list, err := client.AppsV1().StatefulSets(ns).List(c.Request.Context(), metav1.ListOptions{})
		if err != nil {
			if ns == corev1.NamespaceAll && isForbiddenClusterScope(err) {
				if def := defaultNamespaceForCluster(reg, id); def != "" {
					list, err = client.AppsV1().StatefulSets(def).List(c.Request.Context(), metav1.ListOptions{})
				}
			}
			if err != nil {
				if isForbiddenClusterScope(err) {
					c.JSON(http.StatusOK, gin.H{"items": []interface{}{}})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// DaemonSets
	r.GET("/api/clusters/:id/daemonsets", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		list, err := client.AppsV1().DaemonSets(ns).List(c.Request.Context(), metav1.ListOptions{})
		if err != nil {
			if ns == corev1.NamespaceAll && isForbiddenClusterScope(err) {
				if def := defaultNamespaceForCluster(reg, id); def != "" {
					list, err = client.AppsV1().DaemonSets(def).List(c.Request.Context(), metav1.ListOptions{})
				}
			}
			if err != nil {
				if isForbiddenClusterScope(err) {
					c.JSON(http.StatusOK, gin.H{"items": []interface{}{}})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// Jobs
	r.GET("/api/clusters/:id/jobs", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		list, err := client.BatchV1().Jobs(ns).List(c.Request.Context(), metav1.ListOptions{})
		if err != nil {
			if ns == corev1.NamespaceAll && isForbiddenClusterScope(err) {
				if def := defaultNamespaceForCluster(reg, id); def != "" {
					list, err = client.BatchV1().Jobs(def).List(c.Request.Context(), metav1.ListOptions{})
				}
			}
			if err != nil {
				if isForbiddenClusterScope(err) {
					c.JSON(http.StatusOK, gin.H{"items": []interface{}{}})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// CronJobs
	r.GET("/api/clusters/:id/cronjobs", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		list, err := client.BatchV1().CronJobs(ns).List(c.Request.Context(), metav1.ListOptions{})
		if err != nil {
			if ns == corev1.NamespaceAll && isForbiddenClusterScope(err) {
				if def := defaultNamespaceForCluster(reg, id); def != "" {
					list, err = client.BatchV1().CronJobs(def).List(c.Request.Context(), metav1.ListOptions{})
				}
			}
			if err != nil {
				if isForbiddenClusterScope(err) {
					c.JSON(http.StatusOK, gin.H{"items": []interface{}{}})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// Events
	r.GET("/api/clusters/:id/events", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		list, err := client.CoreV1().Events(ns).List(c.Request.Context(), metav1.ListOptions{})
		if err != nil {
			if ns == corev1.NamespaceAll && isForbiddenClusterScope(err) {
				if def := defaultNamespaceForCluster(reg, id); def != "" {
					list, err = client.CoreV1().Events(def).List(c.Request.Context(), metav1.ListOptions{})
				}
			}
			if err != nil {
				if isForbiddenClusterScope(err) {
					c.JSON(http.StatusOK, gin.H{"items": []corev1.Event{}})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// ConfigMaps
	r.GET("/api/clusters/:id/configmaps", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		list, err := client.CoreV1().ConfigMaps(ns).List(c.Request.Context(), metav1.ListOptions{})
		if err != nil {
			if ns == corev1.NamespaceAll && isForbiddenClusterScope(err) {
				if def := defaultNamespaceForCluster(reg, id); def != "" {
					list, err = client.CoreV1().ConfigMaps(def).List(c.Request.Context(), metav1.ListOptions{})
				}
			}
			if err != nil {
				if isForbiddenClusterScope(err) {
					c.JSON(http.StatusOK, gin.H{"items": []corev1.ConfigMap{}})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// Secrets
	r.GET("/api/clusters/:id/secrets", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		list, err := client.CoreV1().Secrets(ns).List(c.Request.Context(), metav1.ListOptions{})
		if err != nil {
			if ns == corev1.NamespaceAll && isForbiddenClusterScope(err) {
				if def := defaultNamespaceForCluster(reg, id); def != "" {
					list, err = client.CoreV1().Secrets(def).List(c.Request.Context(), metav1.ListOptions{})
				}
			}
			if err != nil {
				if isForbiddenClusterScope(err) {
					c.JSON(http.StatusOK, gin.H{"items": []corev1.Secret{}})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// Services
	r.GET("/api/clusters/:id/services", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		list, err := client.CoreV1().Services(ns).List(c.Request.Context(), metav1.ListOptions{})
		if err != nil {
			if ns == corev1.NamespaceAll && isForbiddenClusterScope(err) {
				if def := defaultNamespaceForCluster(reg, id); def != "" {
					list, err = client.CoreV1().Services(def).List(c.Request.Context(), metav1.ListOptions{})
				}
			}
			if err != nil {
				if isForbiddenClusterScope(err) {
					c.JSON(http.StatusOK, gin.H{"items": []corev1.Service{}})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// Ingresses
	r.GET("/api/clusters/:id/ingresses", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		list, err := client.NetworkingV1().Ingresses(ns).List(c.Request.Context(), metav1.ListOptions{})
		if err != nil {
			if ns == corev1.NamespaceAll && isForbiddenClusterScope(err) {
				if def := defaultNamespaceForCluster(reg, id); def != "" {
					list, err = client.NetworkingV1().Ingresses(def).List(c.Request.Context(), metav1.ListOptions{})
				}
			}
			if err != nil {
				if isForbiddenClusterScope(err) {
					c.JSON(http.StatusOK, gin.H{"items": []interface{}{}})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})
}

