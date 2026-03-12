package httpapi

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"weblens/server/internal/cluster"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"

	"github.com/gin-gonic/gin"
	"sigs.k8s.io/yaml"
)

// isForbiddenClusterScope 判断是否为「无集群级权限」类错误
func isForbiddenClusterScope(err error) bool {
	s := err.Error()
	return strings.Contains(s, "forbidden") && strings.Contains(s, "cluster scope")
}

// listCacheEntry / listCache：针对各类 List 结果做一个极短 TTL（1 秒）的软缓存，
// 用于吸收多个前端在同一时间段对同一资源的并发轮询请求，降低对 kube-apiserver 的压力。
type listCacheEntry struct {
	ts   time.Time
	data interface{}
}

var (
	listCache   = make(map[string]listCacheEntry)
	listCacheMu sync.Mutex
	listTTL     = time.Second
)

// Pod Describe 缓存：极短 TTL，用于吸收用户连续刷新 Describe 的请求，保护 apiserver
type podDescribeCacheEntry struct {
	ts   time.Time
	data PodDescribeResponse
}

var (
	podDescribeCache   = make(map[string]podDescribeCacheEntry)
	podDescribeCacheMu sync.Mutex
	podDescribeTTL     = 3 * time.Second
)

func listCacheKey(parts ...string) string {
	return strings.Join(parts, "|")
}

func getListFromCache(key string) (interface{}, bool) {
	listCacheMu.Lock()
	defer listCacheMu.Unlock()
	entry, ok := listCache[key]
	if !ok {
		return nil, false
	}
	if time.Since(entry.ts) > listTTL {
		delete(listCache, key)
		return nil, false
	}
	return entry.data, true
}

func setListCache(key string, data interface{}) {
	listCacheMu.Lock()
	listCache[key] = listCacheEntry{ts: time.Now(), data: data}
	listCacheMu.Unlock()
}

// PodDescribeResponse 封装 Pod 及其相关 Events，用于前端做「Describe Pod」视图
type PodDescribeResponse struct {
	Pod    *corev1.Pod    `json:"pod"`
	Events []corev1.Event `json:"events"`
}

func podDescribeCacheKey(clusterID, ns, name string) string {
	return strings.Join([]string{clusterID, ns, name}, "|")
}

func getPodDescribeFromCache(key string) (PodDescribeResponse, bool) {
	podDescribeCacheMu.Lock()
	defer podDescribeCacheMu.Unlock()
	entry, ok := podDescribeCache[key]
	if !ok {
		return PodDescribeResponse{}, false
	}
	if time.Since(entry.ts) > podDescribeTTL {
		delete(podDescribeCache, key)
		return PodDescribeResponse{}, false
	}
	return entry.data, true
}

func setPodDescribeCache(key string, data PodDescribeResponse) {
	podDescribeCacheMu.Lock()
	podDescribeCache[key] = podDescribeCacheEntry{ts: time.Now(), data: data}
	podDescribeCacheMu.Unlock()
}

// watchAndStream 是通用的 Kubernetes Watch 封装：将 watch.Interface 输出为按行 JSON 事件流
func watchAndStream(c *gin.Context, id, ns string, w watch.Interface) {
	defer w.Stop()

	c.Writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.WriteHeader(http.StatusOK)

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		log.Printf("watch cluster=%s namespace=%s: response writer does not support flush", id, ns)
		return
	}

	enc := json.NewEncoder(c.Writer)

	for {
		select {
		case <-c.Request.Context().Done():
			return
		case ev, ok := <-w.ResultChan():
			if !ok {
				return
			}
			out := struct {
				Type   watch.EventType `json:"type"`
				Object interface{}     `json:"object"`
			}{
				Type:   ev.Type,
				Object: ev.Object,
			}
			if err := enc.Encode(&out); err != nil {
				log.Printf("watch encode error cluster=%s namespace=%s: %v", id, ns, err)
				return
			}
			flusher.Flush()
		}
	}
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
		cacheKey := listCacheKey("nodes", id)
		if data, ok := getListFromCache(cacheKey); ok {
			c.JSON(http.StatusOK, gin.H{"items": data})
			return
		}
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
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// Pods（无集群级权限时：先按 ns 逐个合并；若 list namespaces 也被禁止则用 context 默认 namespace 或返回空）
	r.GET("/api/clusters/:id/pods", func(c *gin.Context) {
		id := c.Param("id")
		ns := c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		cacheKey := listCacheKey("pods", id, ns)
		if data, ok := getListFromCache(cacheKey); ok {
			c.JSON(http.StatusOK, gin.H{"items": data})
			return
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
					// 任意「forbidden」类型错误（无论 cluster-scope 还是 namespace 级）都视为无权限：
					// 返回 200 + 空列表，避免前端持续重试导致 UI 卡死。
					if strings.Contains(err.Error(), "forbidden") {
						log.Printf("pods list cluster=%s namespace=%s forbidden: %v", id, ns, err)
						c.JSON(http.StatusOK, gin.H{"items": []corev1.Pod{}})
						return
					}
					log.Printf("pods list cluster=%s namespace=%s: %v", id, ns, err)
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
			}
		}
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// Pods Watch：基于 Kubernetes Watch API 的实时变更流（用于前端 Resource Watch）
	r.GET("/api/clusters/:id/pods/watch", func(c *gin.Context) {
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

		// 使用 resourceVersion=0：从当前状态开始发送 ADDED 事件，然后持续推送变更
		w, err := client.CoreV1().Pods(ns).Watch(c.Request.Context(), metav1.ListOptions{
			Watch:           true,
			ResourceVersion: "0",
		})
		if err != nil {
			// 没有 watch 权限时返回 403，由前端决定是否回退到轮询
			if isForbiddenClusterScope(err) {
				c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		watchAndStream(c, id, ns, w)
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
		// 去掉 ManagedFields 等极大字段，避免 YAML 过大影响前端加载速度
		pod.ManagedFields = nil
		raw, err := yaml.Marshal(pod)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Data(http.StatusOK, "text/yaml; charset=utf-8", raw)
	})

	// Describe Pod：返回 Pod 及其相关 Events，供前端做分区展示（带极短 TTL 的本地缓存）
	r.GET("/api/clusters/:id/pods/:namespace/:pod/describe", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("pod")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}

		ctx := c.Request.Context()

		cacheKey := podDescribeCacheKey(id, ns, name)
		if data, ok := getPodDescribeFromCache(cacheKey); ok {
			c.JSON(http.StatusOK, &data)
			return
		}

		pod, err := client.CoreV1().Pods(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// 使用 FieldSelector 只拉取与该 Pod 相关的 Events，减少无关数据和传输量
		selector := fields.AndSelectors(
			fields.OneTermEqualSelector("involvedObject.kind", "Pod"),
			fields.OneTermEqualSelector("involvedObject.namespace", ns),
			fields.OneTermEqualSelector("involvedObject.name", name),
		).String()

		evList, err := client.CoreV1().Events(ns).List(ctx, metav1.ListOptions{
			FieldSelector: selector,
		})
		if err != nil {
			// describe 里 Events 不是强依赖，失败时仅返回 Pod
			log.Printf("describe pod=%s/%s list events error: %v", ns, name, err)
			c.JSON(http.StatusOK, &PodDescribeResponse{Pod: pod, Events: nil})
			return
		}

		var related []corev1.Event
		for i := range evList.Items {
			ev := evList.Items[i]
			if ev.InvolvedObject.UID == pod.UID {
				related = append(related, ev)
			}
		}
		// 事件按时间排序（最旧在前）
		sort.Slice(related, func(i, j int) bool {
			ti := related[i].LastTimestamp
			tj := related[j].LastTimestamp
			return ti.Time.Before(tj.Time)
		})

		resp := PodDescribeResponse{
			Pod:    pod,
			Events: related,
		}
		setPodDescribeCache(cacheKey, resp)
		c.JSON(http.StatusOK, &resp)
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
		cacheKey := listCacheKey("deployments", id, ns)
		if data, ok := getListFromCache(cacheKey); ok {
			c.JSON(http.StatusOK, gin.H{"items": data})
			return
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
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// Deployments Watch
	r.GET("/api/clusters/:id/deployments/watch", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		w, err := client.AppsV1().Deployments(ns).Watch(c.Request.Context(), metav1.ListOptions{
			Watch:           true,
			ResourceVersion: "0",
		})
		if err != nil {
			if isForbiddenClusterScope(err) {
				c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		watchAndStream(c, id, ns, w)
	})

	// StatefulSets
	r.GET("/api/clusters/:id/statefulsets", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		cacheKey := listCacheKey("statefulsets", id, ns)
		if data, ok := getListFromCache(cacheKey); ok {
			c.JSON(http.StatusOK, gin.H{"items": data})
			return
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
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// StatefulSets Watch
	r.GET("/api/clusters/:id/statefulsets/watch", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		w, err := client.AppsV1().StatefulSets(ns).Watch(c.Request.Context(), metav1.ListOptions{
			Watch:           true,
			ResourceVersion: "0",
		})
		if err != nil {
			if isForbiddenClusterScope(err) {
				c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		watchAndStream(c, id, ns, w)
	})

	// DaemonSets
	r.GET("/api/clusters/:id/daemonsets", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		cacheKey := listCacheKey("daemonsets", id, ns)
		if data, ok := getListFromCache(cacheKey); ok {
			c.JSON(http.StatusOK, gin.H{"items": data})
			return
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
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// DaemonSets Watch
	r.GET("/api/clusters/:id/daemonsets/watch", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		w, err := client.AppsV1().DaemonSets(ns).Watch(c.Request.Context(), metav1.ListOptions{
			Watch:           true,
			ResourceVersion: "0",
		})
		if err != nil {
			if isForbiddenClusterScope(err) {
				c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		watchAndStream(c, id, ns, w)
	})

	// Jobs
	r.GET("/api/clusters/:id/jobs", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		cacheKey := listCacheKey("jobs", id, ns)
		if data, ok := getListFromCache(cacheKey); ok {
			c.JSON(http.StatusOK, gin.H{"items": data})
			return
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
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// Jobs Watch
	r.GET("/api/clusters/:id/jobs/watch", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		w, err := client.BatchV1().Jobs(ns).Watch(c.Request.Context(), metav1.ListOptions{
			Watch:           true,
			ResourceVersion: "0",
		})
		if err != nil {
			if isForbiddenClusterScope(err) {
				c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		watchAndStream(c, id, ns, w)
	})

	// CronJobs
	r.GET("/api/clusters/:id/cronjobs", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		cacheKey := listCacheKey("cronjobs", id, ns)
		if data, ok := getListFromCache(cacheKey); ok {
			c.JSON(http.StatusOK, gin.H{"items": data})
			return
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
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// CronJobs Watch
	r.GET("/api/clusters/:id/cronjobs/watch", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		w, err := client.BatchV1().CronJobs(ns).Watch(c.Request.Context(), metav1.ListOptions{
			Watch:           true,
			ResourceVersion: "0",
		})
		if err != nil {
			if isForbiddenClusterScope(err) {
				c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		watchAndStream(c, id, ns, w)
	})

	// Events
	r.GET("/api/clusters/:id/events", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		cacheKey := listCacheKey("events", id, ns)
		if data, ok := getListFromCache(cacheKey); ok {
			c.JSON(http.StatusOK, gin.H{"items": data})
			return
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
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// Events Watch
	r.GET("/api/clusters/:id/events/watch", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		w, err := client.CoreV1().Events(ns).Watch(c.Request.Context(), metav1.ListOptions{
			Watch:           true,
			ResourceVersion: "0",
		})
		if err != nil {
			if isForbiddenClusterScope(err) {
				c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		watchAndStream(c, id, ns, w)
	})

	// ConfigMaps
	r.GET("/api/clusters/:id/configmaps", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		cacheKey := listCacheKey("configmaps", id, ns)
		if data, ok := getListFromCache(cacheKey); ok {
			c.JSON(http.StatusOK, gin.H{"items": data})
			return
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
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// ConfigMaps Watch
	r.GET("/api/clusters/:id/configmaps/watch", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		w, err := client.CoreV1().ConfigMaps(ns).Watch(c.Request.Context(), metav1.ListOptions{
			Watch:           true,
			ResourceVersion: "0",
		})
		if err != nil {
			if isForbiddenClusterScope(err) {
				c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		watchAndStream(c, id, ns, w)
	})

	// Secrets
	r.GET("/api/clusters/:id/secrets", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		cacheKey := listCacheKey("secrets", id, ns)
		if data, ok := getListFromCache(cacheKey); ok {
			c.JSON(http.StatusOK, gin.H{"items": data})
			return
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
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// Secrets Watch
	r.GET("/api/clusters/:id/secrets/watch", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		w, err := client.CoreV1().Secrets(ns).Watch(c.Request.Context(), metav1.ListOptions{
			Watch:           true,
			ResourceVersion: "0",
		})
		if err != nil {
			if isForbiddenClusterScope(err) {
				c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		watchAndStream(c, id, ns, w)
	})

	// Services
	r.GET("/api/clusters/:id/services", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		cacheKey := listCacheKey("services", id, ns)
		if data, ok := getListFromCache(cacheKey); ok {
			c.JSON(http.StatusOK, gin.H{"items": data})
			return
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
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// Services Watch
	r.GET("/api/clusters/:id/services/watch", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		w, err := client.CoreV1().Services(ns).Watch(c.Request.Context(), metav1.ListOptions{
			Watch:           true,
			ResourceVersion: "0",
		})
		if err != nil {
			if isForbiddenClusterScope(err) {
				c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		watchAndStream(c, id, ns, w)
	})

	// Ingresses
	r.GET("/api/clusters/:id/ingresses", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		cacheKey := listCacheKey("ingresses", id, ns)
		if data, ok := getListFromCache(cacheKey); ok {
			c.JSON(http.StatusOK, gin.H{"items": data})
			return
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
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items})
	})

	// Ingresses Watch
	r.GET("/api/clusters/:id/ingresses/watch", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		w, err := client.NetworkingV1().Ingresses(ns).Watch(c.Request.Context(), metav1.ListOptions{
			Watch:           true,
			ResourceVersion: "0",
		})
		if err != nil {
			if isForbiddenClusterScope(err) {
				c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		watchAndStream(c, id, ns, w)
	})

	// Nodes Watch（节点无 namespace）
	r.GET("/api/clusters/:id/nodes/watch", func(c *gin.Context) {
		id := c.Param("id")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		ns := corev1.NamespaceAll
		w, err := client.CoreV1().Nodes().Watch(c.Request.Context(), metav1.ListOptions{
			Watch:           true,
			ResourceVersion: "0",
		})
		if err != nil {
			if isForbiddenClusterScope(err) {
				c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		watchAndStream(c, id, ns, w)
	})

	// Namespaces Watch
	r.GET("/api/clusters/:id/namespaces/watch", func(c *gin.Context) {
		id := c.Param("id")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		ns := corev1.NamespaceAll
		w, err := client.CoreV1().Namespaces().Watch(c.Request.Context(), metav1.ListOptions{
			Watch:           true,
			ResourceVersion: "0",
		})
		if err != nil {
			if isForbiddenClusterScope(err) {
				c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		watchAndStream(c, id, ns, w)
	})
}

