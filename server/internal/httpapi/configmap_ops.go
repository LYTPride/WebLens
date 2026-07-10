package httpapi

import (
	"bytes"
	"context"
	"log"
	"net/http"
	"sort"
	"time"

	"weblens/server/internal/auth"
	"weblens/server/internal/cluster"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/client-go/kubernetes"

	"github.com/gin-gonic/gin"
	"sigs.k8s.io/yaml"
)

func invalidateConfigMapListCache(clusterID, ns string) {
	listCacheMu.Lock()
	defer listCacheMu.Unlock()
	delete(listCache, listCacheKey("configmaps", clusterID, ns))
	delete(listCache, listCacheKey("configmaps", clusterID, corev1.NamespaceAll))
}

// ConfigMapDescribeView keeps Describe structured while reference analysis is derived in the frontend from raw Pods.
type ConfigMapDescribeView struct {
	Name              string            `json:"name"`
	Namespace         string            `json:"namespace"`
	UID               string            `json:"uid,omitempty"`
	CreationTimestamp string            `json:"creationTimestamp,omitempty"`
	ResourceVersion   string            `json:"resourceVersion,omitempty"`
	Labels            map[string]string `json:"labels,omitempty"`
	Annotations       map[string]string `json:"annotations,omitempty"`
	Data              map[string]string `json:"data,omitempty"`
	BinaryData        map[string][]byte `json:"binaryData,omitempty"`
}

type ConfigMapDescribeResponse struct {
	View   ConfigMapDescribeView `json:"view"`
	Events []corev1.Event        `json:"events"`
}

type configMapBatchItem struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

type configMapBatchRequest struct {
	Items []configMapBatchItem `json:"items"`
}

func writeConfigMapK8sError(c *gin.Context, err error) {
	status := http.StatusInternalServerError
	msg := err.Error()
	if statusErr, ok := err.(*apierrors.StatusError); ok {
		if statusErr.ErrStatus.Code > 0 {
			status = int(statusErr.ErrStatus.Code)
		}
		if statusErr.ErrStatus.Message != "" {
			msg = statusErr.ErrStatus.Message
		}
	}
	switch {
	case apierrors.IsForbidden(err):
		status = http.StatusForbidden
	case apierrors.IsNotFound(err):
		status = http.StatusNotFound
	case apierrors.IsConflict(err):
		status = http.StatusConflict
	case apierrors.IsBadRequest(err), apierrors.IsInvalid(err):
		status = http.StatusBadRequest
	}
	c.JSON(status, gin.H{"error": msg})
}

func marshalConfigMapYAML(cm *corev1.ConfigMap) ([]byte, error) {
	out := cm.DeepCopy()
	out.ManagedFields = nil
	if out.APIVersion == "" {
		out.APIVersion = "v1"
	}
	if out.Kind == "" {
		out.Kind = "ConfigMap"
	}
	return yaml.Marshal(out)
}

func buildConfigMapDescribeView(cm *corev1.ConfigMap) ConfigMapDescribeView {
	view := ConfigMapDescribeView{
		Name:            cm.Name,
		Namespace:       cm.Namespace,
		UID:             string(cm.UID),
		ResourceVersion: cm.ResourceVersion,
		Labels:          cm.Labels,
		Annotations:     cm.Annotations,
		Data:            cm.Data,
		BinaryData:      cm.BinaryData,
	}
	if !cm.CreationTimestamp.IsZero() {
		view.CreationTimestamp = cm.CreationTimestamp.Time.UTC().Format(time.RFC3339)
	}
	return view
}

func listConfigMapRelatedEvents(ctx context.Context, client *kubernetes.Clientset, cm *corev1.ConfigMap) ([]corev1.Event, error) {
	selector := fields.AndSelectors(
		fields.OneTermEqualSelector("involvedObject.kind", "ConfigMap"),
		fields.OneTermEqualSelector("involvedObject.namespace", cm.Namespace),
		fields.OneTermEqualSelector("involvedObject.name", cm.Name),
	).String()
	evCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	evList, err := client.CoreV1().Events(cm.Namespace).List(evCtx, metav1.ListOptions{FieldSelector: selector})
	if err != nil {
		return nil, err
	}
	var related []corev1.Event
	for i := range evList.Items {
		ev := evList.Items[i]
		if ev.InvolvedObject.UID == cm.UID || ev.InvolvedObject.UID == "" {
			related = append(related, ev)
		}
	}
	sort.Slice(related, func(i, j int) bool {
		return related[i].LastTimestamp.Time.Before(related[j].LastTimestamp.Time)
	})
	return related, nil
}

// RegisterConfigMapRoutes adds ConfigMap describe / YAML / update / delete operations.
func RegisterConfigMapRoutes(r *gin.Engine, reg *cluster.Registry, store *auth.Store) {
	r.GET("/api/clusters/:id/configmaps/:namespace/:name/describe", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		ctx := c.Request.Context()
		cm, err := client.CoreV1().ConfigMaps(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			log.Printf("configmap describe get cluster=%s namespace=%s name=%s error: %v", id, ns, name, err)
			writeConfigMapK8sError(c, err)
			return
		}
		view := buildConfigMapDescribeView(cm)
		related, err := listConfigMapRelatedEvents(ctx, client, cm)
		if err != nil {
			log.Printf("describe configmap=%s/%s list events error: %v", ns, name, err)
			c.JSON(http.StatusOK, ConfigMapDescribeResponse{View: view, Events: nil})
			return
		}
		c.JSON(http.StatusOK, ConfigMapDescribeResponse{View: view, Events: related})
	})

	r.GET("/api/clusters/:id/configmaps/:namespace/:name/yaml", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		cm, err := client.CoreV1().ConfigMaps(ns).Get(c.Request.Context(), name, metav1.GetOptions{})
		if err != nil {
			log.Printf("configmap yaml get cluster=%s namespace=%s name=%s error: %v", id, ns, name, err)
			writeConfigMapK8sError(c, err)
			return
		}
		raw, err := marshalConfigMapYAML(cm)
		if err != nil {
			log.Printf("configmap yaml marshal cluster=%s namespace=%s name=%s error: %v", id, ns, name, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "marshal ConfigMap YAML failed: " + err.Error()})
			return
		}
		c.Data(http.StatusOK, "text/yaml; charset=utf-8", raw)
	})

	r.PUT("/api/clusters/:id/configmaps/:namespace/:name", func(c *gin.Context) {
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
		var cm corev1.ConfigMap
		if err := yaml.Unmarshal(body, &cm); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid YAML: " + err.Error()})
			return
		}
		existing, err := client.CoreV1().ConfigMaps(ns).Get(c.Request.Context(), name, metav1.GetOptions{})
		if err != nil {
			log.Printf("configmap yaml update preflight get cluster=%s namespace=%s name=%s error: %v", id, ns, name, err)
			writeConfigMapK8sError(c, err)
			return
		}
		cm.Namespace = ns
		cm.Name = name
		cm.ResourceVersion = existing.ResourceVersion
		updated, err := client.CoreV1().ConfigMaps(ns).Update(c.Request.Context(), &cm, metav1.UpdateOptions{})
		if err != nil {
			log.Printf("configmap yaml update cluster=%s namespace=%s name=%s error: %v", id, ns, name, err)
			writeConfigMapK8sError(c, err)
			return
		}
		invalidateConfigMapListCache(id, ns)
		c.JSON(http.StatusOK, updated)
	})

	r.DELETE("/api/clusters/:id/configmaps/:namespace/:name", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		if err := client.CoreV1().ConfigMaps(ns).Delete(c.Request.Context(), name, metav1.DeleteOptions{}); err != nil {
			log.Printf("configmap delete cluster=%s namespace=%s name=%s error: %v", id, ns, name, err)
			writeConfigMapK8sError(c, err)
			return
		}
		invalidateConfigMapListCache(id, ns)
		c.Status(http.StatusNoContent)
	})

	r.POST("/api/clusters/:id/configmaps/batch-delete", func(c *gin.Context) {
		id := c.Param("id")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		var req configMapBatchRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		for _, item := range req.Items {
			if item.Namespace == "" || item.Name == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "namespace and name are required"})
				return
			}
		}
		if !requireBatchConfigMapScopes(c, store, id, req.Items) {
			return
		}
		for _, item := range req.Items {
			if err := client.CoreV1().ConfigMaps(item.Namespace).Delete(c.Request.Context(), item.Name, metav1.DeleteOptions{}); err != nil {
				log.Printf("configmap batch delete cluster=%s namespace=%s name=%s error: %v", id, item.Namespace, item.Name, err)
				writeConfigMapK8sError(c, err)
				return
			}
			invalidateConfigMapListCache(id, item.Namespace)
		}
		c.JSON(http.StatusOK, gin.H{"deleted": len(req.Items)})
	})

	r.POST("/api/clusters/:id/configmaps/export", func(c *gin.Context) {
		id := c.Param("id")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		var req configMapBatchRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		for _, item := range req.Items {
			if item.Namespace == "" || item.Name == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "namespace and name are required"})
				return
			}
		}
		if !requireBatchConfigMapScopes(c, store, id, req.Items) {
			return
		}
		var out bytes.Buffer
		for i, item := range req.Items {
			cm, err := client.CoreV1().ConfigMaps(item.Namespace).Get(c.Request.Context(), item.Name, metav1.GetOptions{})
			if err != nil {
				log.Printf("configmap export get cluster=%s namespace=%s name=%s error: %v", id, item.Namespace, item.Name, err)
				writeConfigMapK8sError(c, err)
				return
			}
			raw, err := marshalConfigMapYAML(cm)
			if err != nil {
				log.Printf("configmap export marshal cluster=%s namespace=%s name=%s error: %v", id, item.Namespace, item.Name, err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "marshal ConfigMap YAML failed: " + err.Error()})
				return
			}
			if i > 0 {
				out.WriteString("---\n")
			}
			out.Write(raw)
			if !bytes.HasSuffix(raw, []byte("\n")) {
				out.WriteByte('\n')
			}
		}
		c.Data(http.StatusOK, "text/yaml; charset=utf-8", out.Bytes())
	})
}
