package httpapi

import (
	"context"
	"log"
	"net/http"
	"sort"
	"time"

	"weblens/server/internal/cluster"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/client-go/kubernetes"

	"github.com/gin-gonic/gin"
	"sigs.k8s.io/yaml"
)

// invalidateStatefulSetListCache 在 StatefulSet 变更后丢弃 list 短缓存
func invalidateStatefulSetListCache(clusterID, ns string) {
	listCacheMu.Lock()
	defer listCacheMu.Unlock()
	delete(listCache, listCacheKey("statefulsets", clusterID, ns))
	delete(listCache, listCacheKey("statefulsets", clusterID, corev1.NamespaceAll))
}

// StatefulSetDescribeView 结构化 StatefulSet 信息（实例表由前端用 Pods 缓存拼装）
type StatefulSetDescribeView struct {
	Name                     string            `json:"name"`
	Namespace                string            `json:"namespace"`
	ServiceName              string            `json:"serviceName,omitempty"`
	CreationTimestamp        string            `json:"creationTimestamp,omitempty"`
	Labels                   map[string]string `json:"labels,omitempty"`
	Annotations              map[string]string `json:"annotations,omitempty"`
	Replicas                 int32             `json:"replicas"`
	ReadyReplicas            int32             `json:"readyReplicas"`
	CurrentReplicas          int32             `json:"currentReplicas"`
	UpdatedReplicas          int32             `json:"updatedReplicas"`
	VolumeClaimTemplateNames []string          `json:"volumeClaimTemplateNames,omitempty"`
	StrategyType             string            `json:"strategyType"`
	RollingPartition         *int32            `json:"rollingPartition,omitempty"`
	PodManagementPolicy      string            `json:"podManagementPolicy,omitempty"`
}

// StatefulSetDescribeResponse 供前端分块渲染
type StatefulSetDescribeResponse struct {
	View   StatefulSetDescribeView `json:"view"`
	Events []corev1.Event          `json:"events"`
}

func buildStatefulSetDescribeView(sts *appsv1.StatefulSet) StatefulSetDescribeView {
	spec := sts.Spec
	st := sts.Status
	desired := int32(1)
	if spec.Replicas != nil {
		desired = *spec.Replicas
	}
	view := StatefulSetDescribeView{
		Name:                sts.Name,
		Namespace:           sts.Namespace,
		ServiceName:         spec.ServiceName,
		Labels:              sts.Labels,
		Annotations:         sts.Annotations,
		Replicas:            desired,
		ReadyReplicas:       st.ReadyReplicas,
		CurrentReplicas:     st.CurrentReplicas,
		UpdatedReplicas:     st.UpdatedReplicas,
		StrategyType:        string(spec.UpdateStrategy.Type),
		PodManagementPolicy: string(spec.PodManagementPolicy),
	}
	if !sts.CreationTimestamp.IsZero() {
		view.CreationTimestamp = sts.CreationTimestamp.Time.UTC().Format(time.RFC3339)
	}
	for _, v := range spec.VolumeClaimTemplates {
		view.VolumeClaimTemplateNames = append(view.VolumeClaimTemplateNames, v.Name)
	}
	if spec.UpdateStrategy.Type == appsv1.RollingUpdateStatefulSetStrategyType && spec.UpdateStrategy.RollingUpdate != nil {
		p := spec.UpdateStrategy.RollingUpdate.Partition
		if p != nil {
			view.RollingPartition = p
		}
	}
	return view
}

func listStatefulSetRelatedEvents(ctx context.Context, client *kubernetes.Clientset, sts *appsv1.StatefulSet) ([]corev1.Event, error) {
	ns := sts.Namespace
	selector := fields.AndSelectors(
		fields.OneTermEqualSelector("involvedObject.kind", "StatefulSet"),
		fields.OneTermEqualSelector("involvedObject.namespace", ns),
		fields.OneTermEqualSelector("involvedObject.name", sts.Name),
	).String()
	evCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	evList, err := client.CoreV1().Events(ns).List(evCtx, metav1.ListOptions{FieldSelector: selector})
	if err != nil {
		return nil, err
	}
	var related []corev1.Event
	for i := range evList.Items {
		ev := evList.Items[i]
		if ev.InvolvedObject.UID == sts.UID {
			related = append(related, ev)
		}
	}
	sort.Slice(related, func(i, j int) bool {
		return related[i].LastTimestamp.Time.Before(related[j].LastTimestamp.Time)
	})
	return related, nil
}

// RegisterStatefulSetRoutes 注册 StatefulSet describe / YAML / scale / restart / delete
func RegisterStatefulSetRoutes(r *gin.Engine, reg *cluster.Registry) {
	r.GET("/api/clusters/:id/statefulsets/:namespace/:name/describe", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		ctx := c.Request.Context()
		sts, err := client.AppsV1().StatefulSets(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		view := buildStatefulSetDescribeView(sts)
		related, err := listStatefulSetRelatedEvents(ctx, client, sts)
		if err != nil {
			log.Printf("describe statefulset=%s/%s list events error: %v", ns, name, err)
			c.JSON(http.StatusOK, StatefulSetDescribeResponse{View: view, Events: nil})
			return
		}
		c.JSON(http.StatusOK, StatefulSetDescribeResponse{View: view, Events: related})
	})

	r.GET("/api/clusters/:id/statefulsets/:namespace/:name/yaml", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		sts, err := client.AppsV1().StatefulSets(ns).Get(c.Request.Context(), name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		sts.ManagedFields = nil
		raw, err := yaml.Marshal(sts)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Data(http.StatusOK, "text/yaml; charset=utf-8", raw)
	})

	r.PUT("/api/clusters/:id/statefulsets/:namespace/:name", func(c *gin.Context) {
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
		var sts appsv1.StatefulSet
		if err := yaml.Unmarshal(body, &sts); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid YAML: " + err.Error()})
			return
		}
		existing, err := client.AppsV1().StatefulSets(ns).Get(c.Request.Context(), name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		sts.Namespace = ns
		sts.Name = name
		sts.ResourceVersion = existing.ResourceVersion
		updated, err := client.AppsV1().StatefulSets(ns).Update(c.Request.Context(), &sts, metav1.UpdateOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		invalidateStatefulSetListCache(id, ns)
		c.JSON(http.StatusOK, updated)
	})

	type scaleReq struct {
		Replicas int32 `json:"replicas"`
	}
	r.PATCH("/api/clusters/:id/statefulsets/:namespace/:name/scale", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		var req scaleReq
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if req.Replicas < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "replicas must be >= 0"})
			return
		}
		ctx := c.Request.Context()
		scale, err := client.AppsV1().StatefulSets(ns).GetScale(ctx, name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		scale.Spec.Replicas = req.Replicas
		_, err = client.AppsV1().StatefulSets(ns).UpdateScale(ctx, name, scale, metav1.UpdateOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		sts, err := client.AppsV1().StatefulSets(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		invalidateStatefulSetListCache(id, ns)
		c.JSON(http.StatusOK, sts)
	})

	r.POST("/api/clusters/:id/statefulsets/:namespace/:name/restart", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		ctx := c.Request.Context()
		sts, err := client.AppsV1().StatefulSets(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if sts.Spec.Template.Annotations == nil {
			sts.Spec.Template.Annotations = make(map[string]string)
		}
		sts.Spec.Template.Annotations["kubectl.kubernetes.io/restartedAt"] = time.Now().Format(time.RFC3339)
		updated, err := client.AppsV1().StatefulSets(ns).Update(ctx, sts, metav1.UpdateOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		invalidateStatefulSetListCache(id, ns)
		c.JSON(http.StatusOK, updated)
	})

	r.DELETE("/api/clusters/:id/statefulsets/:namespace/:name", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		err := client.AppsV1().StatefulSets(ns).Delete(c.Request.Context(), name, metav1.DeleteOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		invalidateStatefulSetListCache(id, ns)
		c.Status(http.StatusNoContent)
	})
}
