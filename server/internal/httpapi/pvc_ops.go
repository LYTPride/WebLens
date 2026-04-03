package httpapi

import (
	"context"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	"weblens/server/internal/cluster"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/client-go/kubernetes"

	"github.com/gin-gonic/gin"
	"sigs.k8s.io/yaml"
)

func invalidatePVCListCache(clusterID, ns string) {
	listCacheMu.Lock()
	defer listCacheMu.Unlock()
	delete(listCache, listCacheKey("persistentvolumeclaims", clusterID, ns))
	delete(listCache, listCacheKey("persistentvolumeclaims", clusterID, corev1.NamespaceAll))
}

// PvcDescribeView 结构化 PVC 信息（Used By 由前端用 Pods 缓存拼装）
type PvcDescribeView struct {
	Name              string            `json:"name"`
	Namespace         string            `json:"namespace"`
	StatusPhase       string            `json:"statusPhase"`
	VolumeName        string            `json:"volumeName"`
	StorageClass      string            `json:"storageClass"`
	CreationTimestamp string            `json:"creationTimestamp,omitempty"`
	Labels            map[string]string `json:"labels,omitempty"`
	Annotations       map[string]string `json:"annotations,omitempty"`
	RequestedStorage  string            `json:"requestedStorage"`
	Capacity          string            `json:"capacity"`
	AccessModes       string            `json:"accessModes"`
	VolumeMode        string            `json:"volumeMode"`
	IsTerminating     bool              `json:"isTerminating"`
}

type PvcDescribeResponse struct {
	View   PvcDescribeView `json:"view"`
	Events []corev1.Event  `json:"events"`
}

func formatAccessModes(modes []corev1.PersistentVolumeAccessMode) string {
	if len(modes) == 0 {
		return "—"
	}
	var parts []string
	for _, m := range modes {
		parts = append(parts, string(m))
	}
	return strings.Join(parts, ", ")
}

func buildPvcDescribeView(pvc *corev1.PersistentVolumeClaim) PvcDescribeView {
	spec := pvc.Spec
	st := pvc.Status
	view := PvcDescribeView{
		Name:         pvc.Name,
		Namespace:    pvc.Namespace,
		StatusPhase:  string(st.Phase),
		Labels:       pvc.Labels,
		Annotations:  pvc.Annotations,
		IsTerminating: pvc.DeletionTimestamp != nil && !pvc.DeletionTimestamp.IsZero(),
	}
	if spec.VolumeName != "" {
		view.VolumeName = spec.VolumeName
	} else {
		view.VolumeName = "—"
	}
	if spec.StorageClassName != nil && *spec.StorageClassName != "" {
		view.StorageClass = *spec.StorageClassName
	} else {
		view.StorageClass = "—"
	}
	if !pvc.CreationTimestamp.IsZero() {
		view.CreationTimestamp = pvc.CreationTimestamp.Time.UTC().Format(time.RFC3339)
	}
	if spec.Resources.Requests != nil {
		view.RequestedStorage = spec.Resources.Requests.Storage().String()
	}
	if view.RequestedStorage == "" {
		view.RequestedStorage = "—"
	}
	if st.Capacity != nil {
		if q, ok := st.Capacity[corev1.ResourceStorage]; ok {
			view.Capacity = q.String()
		}
	}
	if view.Capacity == "" {
		view.Capacity = "—"
	}
	view.AccessModes = formatAccessModes(spec.AccessModes)
	if spec.VolumeMode != nil {
		view.VolumeMode = string(*spec.VolumeMode)
	} else {
		view.VolumeMode = "Filesystem"
	}
	return view
}

func listPVCRelatedEvents(ctx context.Context, client *kubernetes.Clientset, pvc *corev1.PersistentVolumeClaim) ([]corev1.Event, error) {
	ns := pvc.Namespace
	selector := fields.AndSelectors(
		fields.OneTermEqualSelector("involvedObject.kind", "PersistentVolumeClaim"),
		fields.OneTermEqualSelector("involvedObject.namespace", ns),
		fields.OneTermEqualSelector("involvedObject.name", pvc.Name),
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
		if ev.InvolvedObject.UID == pvc.UID {
			related = append(related, ev)
		}
	}
	sort.Slice(related, func(i, j int) bool {
		return related[i].LastTimestamp.Time.Before(related[j].LastTimestamp.Time)
	})
	return related, nil
}

// RegisterPVCRoutes PVC describe / YAML / update / delete
func RegisterPVCRoutes(r *gin.Engine, reg *cluster.Registry) {
	r.GET("/api/clusters/:id/persistentvolumeclaims/:namespace/:name/describe", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		ctx := c.Request.Context()
		pvc, err := client.CoreV1().PersistentVolumeClaims(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		view := buildPvcDescribeView(pvc)
		related, err := listPVCRelatedEvents(ctx, client, pvc)
		if err != nil {
			log.Printf("describe pvc=%s/%s list events error: %v", ns, name, err)
			c.JSON(http.StatusOK, PvcDescribeResponse{View: view, Events: nil})
			return
		}
		c.JSON(http.StatusOK, PvcDescribeResponse{View: view, Events: related})
	})

	r.GET("/api/clusters/:id/persistentvolumeclaims/:namespace/:name/yaml", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		pvc, err := client.CoreV1().PersistentVolumeClaims(ns).Get(c.Request.Context(), name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		pvc.ManagedFields = nil
		raw, err := yaml.Marshal(pvc)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Data(http.StatusOK, "text/yaml; charset=utf-8", raw)
	})

	r.PUT("/api/clusters/:id/persistentvolumeclaims/:namespace/:name", func(c *gin.Context) {
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
		var pvc corev1.PersistentVolumeClaim
		if err := yaml.Unmarshal(body, &pvc); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid YAML: " + err.Error()})
			return
		}
		existing, err := client.CoreV1().PersistentVolumeClaims(ns).Get(c.Request.Context(), name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		pvc.Namespace = ns
		pvc.Name = name
		pvc.ResourceVersion = existing.ResourceVersion
		updated, err := client.CoreV1().PersistentVolumeClaims(ns).Update(c.Request.Context(), &pvc, metav1.UpdateOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		invalidatePVCListCache(id, ns)
		c.JSON(http.StatusOK, updated)
	})

	r.DELETE("/api/clusters/:id/persistentvolumeclaims/:namespace/:name", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		err := client.CoreV1().PersistentVolumeClaims(ns).Delete(c.Request.Context(), name, metav1.DeleteOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		invalidatePVCListCache(id, ns)
		c.Status(http.StatusNoContent)
	})
}
