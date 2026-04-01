package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"weblens/server/internal/cluster"

	appsv1 "k8s.io/api/apps/v1"
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

// listCacheEntry / listCache：针对各类 **HTTP List** 结果做一个极短 TTL（1 秒）的软缓存，
// 用于吸收多个前端在同一时间段对同一资源的并发 list 请求，降低对 kube-apiserver 的压力。
// Watch 流不走此缓存；实时增量仅依赖 watch + 前端 raw state reducer。
type listCacheEntry struct {
	ts   time.Time
	data interface{}
}

var (
	listCache   = make(map[string]listCacheEntry)
	listCacheMu sync.Mutex
	listTTL     = time.Second
)

// PodHealth 描述单个 Pod 的健康评分及标签（仅返回给前端做展示与解释）
type PodHealth struct {
	HealthLabel   string   `json:"healthLabel"`
	HealthReasons []string `json:"healthReasons,omitempty"`
	HealthScore   int      `json:"healthScore"`
}

// PodWithHealth 在原生 corev1.Pod 基础上附加健康信息。
// 通过匿名字段保证现有前端字段路径不变，同时新增 health* 字段。
type PodWithHealth struct {
	corev1.Pod `json:",inline"`
	PodHealth  `json:",inline"`
}

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

// invalidateDeploymentListCache 在 Deployment 变更后丢弃 list 短缓存，避免列表长时间陈旧
func invalidateDeploymentListCache(clusterID, deploymentNS string) {
	listCacheMu.Lock()
	defer listCacheMu.Unlock()
	delete(listCache, listCacheKey("deployments", clusterID, deploymentNS))
	delete(listCache, listCacheKey("deployments", clusterID, corev1.NamespaceAll))
}

// computePodHealth 根据 Pod 当前状态计算 0~100 的健康分并映射为四档标签。
// 第一版仅依赖现有 Pod 字段，不引入额外存储或跨轮次状态。
func computePodHealth(p *corev1.Pod, now time.Time) PodHealth {
	score := 100
	var reasons []string

	// 1. STATUS 扣分
	phase := ""
	if p.Status.Phase != "" {
		phase = string(p.Status.Phase)
	}
	overallReason := p.Status.Reason

	// 容器/Init 容器的 waiting/terminated reason，尽量贴近 kubectl get pods 的展示
	var waitingReason string
	var allStatuses []corev1.ContainerStatus
	allStatuses = append(allStatuses, p.Status.ContainerStatuses...)
	allStatuses = append(allStatuses, p.Status.InitContainerStatuses...)
	for i := range allStatuses {
		st := allStatuses[i].State
		if st.Waiting != nil && st.Waiting.Reason != "" {
			waitingReason = st.Waiting.Reason
			break
		}
		if st.Terminated != nil && st.Terminated.Reason != "" {
			waitingReason = st.Terminated.Reason
			break
		}
	}

	statusText := phase
	if waitingReason != "" {
		statusText = waitingReason
	} else if overallReason != "" {
		statusText = overallReason
	}
	if statusText == "" {
		statusText = "-"
	}

	statusKey := strings.ToLower(statusText)
	forceSevere := false
	switch {
	case statusKey == "running":
		// Running => 0
	case statusKey == "completed" || statusKey == "succeeded":
		// Completed/Succeeded => 0
	case statusKey == "pending":
		score -= 20
		reasons = append(reasons, "STATUS=Pending")
	case statusKey == "containercreating":
		score -= 10
		reasons = append(reasons, "STATUS=ContainerCreating")
	case statusKey == "terminating":
		score -= 10
		reasons = append(reasons, "STATUS=Terminating")
	case statusKey == "crashloopbackoff":
		score -= 60
		reasons = append(reasons, "STATUS=CrashLoopBackOff")
		forceSevere = true
	case statusKey == "errimagepull":
		score -= 70
		reasons = append(reasons, "STATUS=ErrImagePull")
		forceSevere = true
	case statusKey == "imagepullbackoff":
		score -= 70
		reasons = append(reasons, "STATUS=ImagePullBackOff")
		forceSevere = true
	case statusKey == "error":
		score -= 60
		reasons = append(reasons, "STATUS=Error")
		forceSevere = true
	case statusKey == "unknown":
		score -= 80
		reasons = append(reasons, "STATUS=Unknown")
		forceSevere = true
	case strings.HasPrefix(statusKey, "init:crashloopbackoff"):
		score -= 60
		reasons = append(reasons, "STATUS=Init:CrashLoopBackOff")
		forceSevere = true
	case strings.HasPrefix(statusKey, "init:error"):
		score -= 50
		reasons = append(reasons, "STATUS=Init:Error")
	default:
		// 其他未知状态 => 20
		if statusKey != "-" {
			score -= 20
			reasons = append(reasons, "STATUS="+statusText)
		}
	}

	// 2. READY 扣分（Completed/Succeeded 的 Job 型 Pod 不再因为 READY 额外扣分）
	totalContainers := len(p.Status.ContainerStatuses)
	readyContainers := 0
	for i := range p.Status.ContainerStatuses {
		if p.Status.ContainerStatuses[i].Ready {
			readyContainers++
		}
	}

	isCompletedPhase := p.Status.Phase == corev1.PodSucceeded
	if totalContainers > 0 && !isCompletedPhase {
		switch {
		case readyContainers == totalContainers:
			// 全部 ready => 0
		case readyContainers > 0:
			score -= 20
			reasons = append(reasons, "READY 部分未就绪")
		default:
			score -= 40
			reasons = append(reasons, "READY=0/全部未就绪")
		}
	}

	// 3. RESTARTS 扣分（所有容器 restartCount 之和）
	restarts := 0
	for i := range p.Status.ContainerStatuses {
		restarts += int(p.Status.ContainerStatuses[i].RestartCount)
	}
	switch {
	case restarts == 0:
		// 0 => 0
	case restarts >= 1 && restarts <= 5:
		score -= 5
		reasons = append(reasons, "RESTARTS="+itoa(restarts))
	case restarts >= 6 && restarts <= 20:
		score -= 15
		reasons = append(reasons, "RESTARTS="+itoa(restarts)+"，存在重启")
	case restarts >= 21 && restarts <= 100:
		score -= 30
		reasons = append(reasons, "RESTARTS="+itoa(restarts)+"，存在频繁重启")
	case restarts > 100:
		score -= 45
		reasons = append(reasons, "RESTARTS="+itoa(restarts)+"，历史重启次数过高")
	}

	// 4. 长时间卡住额外扣分（Pending / ContainerCreating / Terminating / Init:*）
	if !p.CreationTimestamp.IsZero() {
		age := now.Sub(p.CreationTimestamp.Time)
		lower := statusKey
		if lower == "" {
			lower = strings.ToLower(overallReason)
		}
		isStuckStatus :=
			lower == "pending" ||
				lower == "containercreating" ||
				lower == "terminating" ||
				strings.HasPrefix(lower, "init:")
		if isStuckStatus {
			if age >= 2*time.Minute && age < 10*time.Minute {
				score -= 15
				reasons = append(reasons, "Pod 处于 "+statusText+" 超过 2 分钟")
			} else if age >= 10*time.Minute {
				score -= 30
				reasons = append(reasons, "Pod 处于 "+statusText+" 超过 10 分钟")
			}
		}
	}

	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}

	label := "健康"
	switch {
	case score >= 90:
		label = "健康"
	case score >= 70:
		label = "关注"
	case score >= 40:
		label = "警告"
	default:
		label = "严重"
	}
	// 硬性覆盖：关键故障状态在第一版直接视为“严重”，满足运维直觉与验收场景
	if forceSevere {
		label = "严重"
	}

	return PodHealth{
		HealthLabel:   label,
		HealthReasons: reasons,
		HealthScore:   score,
	}
}

// itoa 使用 fmt.Sprint 避免在该文件额外引入 strconv，保持依赖简单。
func itoa(v int) string {
	return fmt.Sprint(v)
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
	// 关闭常见反向代理对响应体的缓冲，避免 watch 事件被攒批延迟（运维体感「一分钟才更新」）
	c.Writer.Header().Set("X-Accel-Buffering", "no")
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
				Type         watch.EventType `json:"type"`
				Object       interface{}     `json:"object"`
				ServerTimeMs int64           `json:"serverTimeMs"`
			}{
				Type:         ev.Type,
				Object:       ev.Object,
				ServerTimeMs: time.Now().UnixMilli(),
			}
			if err := enc.Encode(&out); err != nil {
				log.Printf("watch encode error cluster=%s namespace=%s: %v", id, ns, err)
				return
			}
			flusher.Flush()
		}
	}
}

// watchPodsStream 与 watchAndStream 相同协议，但对每个事件中的 Pod 调用 computePodHealth，
// 输出结构与 GET /pods 列表一致（PodWithHealth），避免前端用 watch 增量覆盖后丢失 healthLabel 而回退为「健康」。
func watchPodsStream(c *gin.Context, id, ns string, w watch.Interface) {
	defer w.Stop()

	c.Writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(http.StatusOK)

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		log.Printf("watch pods cluster=%s namespace=%s: response writer does not support flush", id, ns)
		return
	}

	enc := json.NewEncoder(c.Writer)
	enc.SetEscapeHTML(false)

	for {
		select {
		case <-c.Request.Context().Done():
			return
		case ev, ok := <-w.ResultChan():
			if !ok {
				return
			}
			var outObj interface{} = ev.Object
			if pod, ok := ev.Object.(*corev1.Pod); ok {
				if os.Getenv("WEBLENS_DEBUG_POD_WATCH") == "1" {
					var age time.Duration
					ct := ""
					if !pod.CreationTimestamp.IsZero() {
						age = time.Since(pod.CreationTimestamp.Time).Round(time.Second)
						ct = pod.CreationTimestamp.UTC().Format(time.RFC3339Nano)
					}
					log.Printf(
						"weblens watch pod cluster=%s ns=%s type=%v name=%s uid=%s creationTimestamp=%s serverAge=%v",
						id, ns, ev.Type, pod.Name, pod.UID, ct, age,
					)
				}
				p := *pod
				h := computePodHealth(pod, time.Now())
				outObj = PodWithHealth{Pod: p, PodHealth: h}
			}
			out := struct {
				Type         watch.EventType `json:"type"`
				Object       interface{}     `json:"object"`
				ServerTimeMs int64           `json:"serverTimeMs"`
			}{
				Type:         ev.Type,
				Object:       outObj,
				ServerTimeMs: time.Now().UnixMilli(),
			}
			if err := enc.Encode(&out); err != nil {
				log.Printf("watch pods encode error cluster=%s namespace=%s: %v", id, ns, err)
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
				c.JSON(http.StatusOK, gin.H{"items": []corev1.Namespace{}, "serverTimeMs": time.Now().UnixMilli()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"items": list.Items, "serverTimeMs": time.Now().UnixMilli()})
	})

	// Nodes
	r.GET("/api/clusters/:id/nodes", func(c *gin.Context) {
		id := c.Param("id")
		cacheKey := listCacheKey("nodes", id)
		if data, ok := getListFromCache(cacheKey); ok {
			c.JSON(http.StatusOK, gin.H{"items": data, "serverTimeMs": time.Now().UnixMilli()})
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
		c.JSON(http.StatusOK, gin.H{"items": list.Items, "serverTimeMs": time.Now().UnixMilli()})
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
			c.JSON(http.StatusOK, gin.H{"items": data, "serverTimeMs": time.Now().UnixMilli()})
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
						c.JSON(http.StatusOK, gin.H{"items": []corev1.Pod{}, "serverTimeMs": time.Now().UnixMilli()})
						return
					}
					log.Printf("pods list cluster=%s namespace=%s: %v", id, ns, err)
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
			}
		}

		// 为每个 Pod 计算健康信息并返回扩展后的结构
		now := time.Now()
		withHealth := make([]PodWithHealth, 0, len(list.Items))
		for i := range list.Items {
			p := list.Items[i]
			h := computePodHealth(&p, now)
			withHealth = append(withHealth, PodWithHealth{
				Pod:       p,
				PodHealth: h,
			})
		}

		setListCache(cacheKey, withHealth)
		c.JSON(http.StatusOK, gin.H{"items": withHealth, "serverTimeMs": time.Now().UnixMilli()})
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

		// 不固定 ResourceVersion=0：与 apiserver「当前版本」对齐持续增量；AllowWatchBookmarks 利于长连接书签
		w, err := client.CoreV1().Pods(ns).Watch(c.Request.Context(), metav1.ListOptions{
			Watch:               true,
			AllowWatchBookmarks: true,
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
		watchPodsStream(c, id, ns, w)
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

		cacheKey := podDescribeCacheKey(id, ns, name)
		if data, ok := getPodDescribeFromCache(cacheKey); ok {
			c.JSON(http.StatusOK, &data)
			return
		}

		ctx := c.Request.Context()

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

		// Events 相比单个 Pod 获取更容易受命名空间体量影响，这里单独加一个较短的超时，
		// 保证 Describe 最长等待时间有限：超时时仍然返回 Pod 基本信息。
		evCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()

		evList, err := client.CoreV1().Events(ns).List(evCtx, metav1.ListOptions{
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
			c.JSON(http.StatusOK, gin.H{"items": data, "serverTimeMs": time.Now().UnixMilli()})
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
					c.JSON(http.StatusOK, gin.H{"items": []interface{}{}, "serverTimeMs": time.Now().UnixMilli()})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items, "serverTimeMs": time.Now().UnixMilli()})
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
			Watch:               true,
			AllowWatchBookmarks: true,
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

	// Get Deployment YAML
	r.GET("/api/clusters/:id/deployments/:namespace/:name/yaml", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		dep, err := client.AppsV1().Deployments(ns).Get(c.Request.Context(), name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		dep.ManagedFields = nil
		raw, err := yaml.Marshal(dep)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Data(http.StatusOK, "text/yaml; charset=utf-8", raw)
	})

	registerDeploymentDescribeRoute(r, reg)

	// Apply Deployment（YAML 更新）
	r.PUT("/api/clusters/:id/deployments/:namespace/:name", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
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
		var dep appsv1.Deployment
		if err := yaml.Unmarshal(body, &dep); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid YAML: " + err.Error()})
			return
		}
		existing, err := client.AppsV1().Deployments(ns).Get(c.Request.Context(), name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		dep.Namespace = ns
		dep.Name = name
		dep.ResourceVersion = existing.ResourceVersion
		updated, err := client.AppsV1().Deployments(ns).Update(c.Request.Context(), &dep, metav1.UpdateOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		invalidateDeploymentListCache(id, ns)
		c.JSON(http.StatusOK, updated)
	})

	type deploymentScaleRequest struct {
		Replicas int32 `json:"replicas"`
	}

	// Scale Deployment（副本数）
	r.PATCH("/api/clusters/:id/deployments/:namespace/:name/scale", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		var req deploymentScaleRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if req.Replicas < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "replicas must be >= 0"})
			return
		}
		ctx := c.Request.Context()
		scale, err := client.AppsV1().Deployments(ns).GetScale(ctx, name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		scale.Spec.Replicas = req.Replicas
		_, err = client.AppsV1().Deployments(ns).UpdateScale(ctx, name, scale, metav1.UpdateOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		dep, err := client.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		invalidateDeploymentListCache(id, ns)
		c.JSON(http.StatusOK, dep)
	})

	// Restart Deployment（rollout：更新 PodTemplate annotation）
	r.POST("/api/clusters/:id/deployments/:namespace/:name/restart", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		ctx := c.Request.Context()
		dep, err := client.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if dep.Spec.Template.Annotations == nil {
			dep.Spec.Template.Annotations = make(map[string]string)
		}
		dep.Spec.Template.Annotations["kubectl.kubernetes.io/restartedAt"] = time.Now().Format(time.RFC3339)
		updated, err := client.AppsV1().Deployments(ns).Update(ctx, dep, metav1.UpdateOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		invalidateDeploymentListCache(id, ns)
		c.JSON(http.StatusOK, updated)
	})

	// Delete Deployment
	r.DELETE("/api/clusters/:id/deployments/:namespace/:name", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		err := client.AppsV1().Deployments(ns).Delete(c.Request.Context(), name, metav1.DeleteOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		invalidateDeploymentListCache(id, ns)
		c.Status(http.StatusNoContent)
	})

	// StatefulSets
	r.GET("/api/clusters/:id/statefulsets", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		cacheKey := listCacheKey("statefulsets", id, ns)
		if data, ok := getListFromCache(cacheKey); ok {
			c.JSON(http.StatusOK, gin.H{"items": data, "serverTimeMs": time.Now().UnixMilli()})
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
					c.JSON(http.StatusOK, gin.H{"items": []interface{}{}, "serverTimeMs": time.Now().UnixMilli()})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items, "serverTimeMs": time.Now().UnixMilli()})
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
			Watch:               true,
			AllowWatchBookmarks: true,
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
			c.JSON(http.StatusOK, gin.H{"items": data, "serverTimeMs": time.Now().UnixMilli()})
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
					c.JSON(http.StatusOK, gin.H{"items": []interface{}{}, "serverTimeMs": time.Now().UnixMilli()})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items, "serverTimeMs": time.Now().UnixMilli()})
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
			c.JSON(http.StatusOK, gin.H{"items": data, "serverTimeMs": time.Now().UnixMilli()})
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
					c.JSON(http.StatusOK, gin.H{"items": []interface{}{}, "serverTimeMs": time.Now().UnixMilli()})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items, "serverTimeMs": time.Now().UnixMilli()})
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
			c.JSON(http.StatusOK, gin.H{"items": data, "serverTimeMs": time.Now().UnixMilli()})
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
					c.JSON(http.StatusOK, gin.H{"items": []interface{}{}, "serverTimeMs": time.Now().UnixMilli()})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items, "serverTimeMs": time.Now().UnixMilli()})
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
			c.JSON(http.StatusOK, gin.H{"items": data, "serverTimeMs": time.Now().UnixMilli()})
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
					c.JSON(http.StatusOK, gin.H{"items": []corev1.Event{}, "serverTimeMs": time.Now().UnixMilli()})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items, "serverTimeMs": time.Now().UnixMilli()})
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
			c.JSON(http.StatusOK, gin.H{"items": data, "serverTimeMs": time.Now().UnixMilli()})
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
					c.JSON(http.StatusOK, gin.H{"items": []corev1.ConfigMap{}, "serverTimeMs": time.Now().UnixMilli()})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items, "serverTimeMs": time.Now().UnixMilli()})
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
			c.JSON(http.StatusOK, gin.H{"items": data, "serverTimeMs": time.Now().UnixMilli()})
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
					c.JSON(http.StatusOK, gin.H{"items": []corev1.Secret{}, "serverTimeMs": time.Now().UnixMilli()})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items, "serverTimeMs": time.Now().UnixMilli()})
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
			c.JSON(http.StatusOK, gin.H{"items": data, "serverTimeMs": time.Now().UnixMilli()})
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
					c.JSON(http.StatusOK, gin.H{"items": []corev1.Service{}, "serverTimeMs": time.Now().UnixMilli()})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items, "serverTimeMs": time.Now().UnixMilli()})
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

	// Endpoints（供 Services 页关联展示；不单独做 UI 资源类型）
	r.GET("/api/clusters/:id/endpoints", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		cacheKey := listCacheKey("endpoints", id, ns)
		if data, ok := getListFromCache(cacheKey); ok {
			c.JSON(http.StatusOK, gin.H{"items": data, "serverTimeMs": time.Now().UnixMilli()})
			return
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		list, err := client.CoreV1().Endpoints(ns).List(c.Request.Context(), metav1.ListOptions{})
		if err != nil {
			if ns == corev1.NamespaceAll && isForbiddenClusterScope(err) {
				if def := defaultNamespaceForCluster(reg, id); def != "" {
					list, err = client.CoreV1().Endpoints(def).List(c.Request.Context(), metav1.ListOptions{})
				}
			}
			if err != nil {
				if isForbiddenClusterScope(err) {
					c.JSON(http.StatusOK, gin.H{"items": []corev1.Endpoints{}, "serverTimeMs": time.Now().UnixMilli()})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items, "serverTimeMs": time.Now().UnixMilli()})
	})

	r.GET("/api/clusters/:id/endpoints/watch", func(c *gin.Context) {
		id, ns := c.Param("id"), c.Query("namespace")
		if ns == "" {
			ns = corev1.NamespaceAll
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		w, err := client.CoreV1().Endpoints(ns).Watch(c.Request.Context(), metav1.ListOptions{
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
			c.JSON(http.StatusOK, gin.H{"items": data, "serverTimeMs": time.Now().UnixMilli()})
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
					c.JSON(http.StatusOK, gin.H{"items": []interface{}{}, "serverTimeMs": time.Now().UnixMilli()})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		setListCache(cacheKey, list.Items)
		c.JSON(http.StatusOK, gin.H{"items": list.Items, "serverTimeMs": time.Now().UnixMilli()})
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

	RegisterStatefulSetRoutes(r, reg)
	RegisterIngressRoutes(r, reg)
	RegisterServiceRoutes(r, reg)
}

