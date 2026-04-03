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

func invalidateNodeListCache(clusterID string) {
	listCacheMu.Lock()
	defer listCacheMu.Unlock()
	delete(listCache, listCacheKey("nodes", clusterID))
}

// NodeConditionRow 供 Describe 结构化展示
type NodeConditionRow struct {
	Type    string `json:"type"`
	Status  string `json:"status"`
	Reason  string `json:"reason,omitempty"`
	Message string `json:"message,omitempty"`
}

// NodeDescribeView 节点 Describe 结构化字段（Pod 数量等由前端用 Pods 缓存计算）
type NodeDescribeView struct {
	Name               string            `json:"name"`
	StatusDisplay      string            `json:"statusDisplay"`
	Roles              string            `json:"roles"`
	KubeletVersion     string            `json:"kubeletVersion"`
	CreationTimestamp  string            `json:"creationTimestamp,omitempty"`
	Labels             map[string]string `json:"labels,omitempty"`
	Annotations        map[string]string `json:"annotations,omitempty"`
	InternalIP         string            `json:"internalIP"`
	Hostname           string            `json:"hostname"`
	OtherAddresses     []string          `json:"otherAddresses,omitempty"`
	CPUCapacity        string            `json:"cpuCapacity"`
	MemoryCapacity     string            `json:"memoryCapacity"`
	EphemeralStorage   string            `json:"ephemeralStorage"`
	MaxPods            string            `json:"maxPods"`
	AllocatableCPU     string            `json:"allocatableCPU"`
	AllocatableMemory  string            `json:"allocatableMemory"`
	Unschedulable      bool              `json:"unschedulable"`
	Taints             []string          `json:"taints,omitempty"`
	Conditions         []NodeConditionRow `json:"conditions,omitempty"`
	OSImage            string            `json:"osImage"`
	KernelVersion      string            `json:"kernelVersion"`
	ContainerRuntime   string            `json:"containerRuntime"`
}

type NodeDescribeResponse struct {
	View   NodeDescribeView `json:"view"`
	Events []corev1.Event   `json:"events"`
}

func buildNodeDescribeView(n *corev1.Node) NodeDescribeView {
	v := NodeDescribeView{
		Name:           n.Name,
		Labels:         n.Labels,
		Annotations:    n.Annotations,
		Unschedulable:  n.Spec.Unschedulable,
		OSImage:            n.Status.NodeInfo.OSImage,
		KernelVersion:      n.Status.NodeInfo.KernelVersion,
		ContainerRuntime:   n.Status.NodeInfo.ContainerRuntimeVersion,
		KubeletVersion:     n.Status.NodeInfo.KubeletVersion,
	}
	if !n.CreationTimestamp.IsZero() {
		v.CreationTimestamp = n.CreationTimestamp.Time.UTC().Format(time.RFC3339)
	}
	v.Roles = formatNodeRolesFromLabels(n.Labels)
	if n.Spec.Unschedulable {
		v.StatusDisplay = "SchedulingDisabled"
	} else {
		var ready *corev1.NodeCondition
		for i := range n.Status.Conditions {
			if n.Status.Conditions[i].Type == corev1.NodeReady {
				ready = &n.Status.Conditions[i]
				break
			}
		}
		if ready == nil {
			v.StatusDisplay = "Unknown"
		} else if ready.Status == corev1.ConditionTrue {
			v.StatusDisplay = "Ready"
		} else {
			v.StatusDisplay = "NotReady"
		}
	}
	v.Roles = formatNodeRolesFromLabels(n.Labels)
	for _, a := range n.Status.Addresses {
		switch a.Type {
		case corev1.NodeInternalIP:
			if v.InternalIP == "" {
				v.InternalIP = a.Address
			}
		case corev1.NodeHostName:
			if v.Hostname == "" {
				v.Hostname = a.Address
			}
		default:
			v.OtherAddresses = append(v.OtherAddresses, string(a.Type)+": "+a.Address)
		}
	}
	if cap := n.Status.Capacity; cap != nil {
		if q, ok := cap[corev1.ResourceCPU]; ok {
			v.CPUCapacity = q.String()
		}
		if q, ok := cap[corev1.ResourceMemory]; ok {
			v.MemoryCapacity = q.String()
		}
		if q, ok := cap[corev1.ResourceEphemeralStorage]; ok {
			v.EphemeralStorage = q.String()
		}
		if q, ok := cap[corev1.ResourcePods]; ok {
			v.MaxPods = q.String()
		}
	}
	if al := n.Status.Allocatable; al != nil {
		if q, ok := al[corev1.ResourceCPU]; ok {
			v.AllocatableCPU = q.String()
		}
		if q, ok := al[corev1.ResourceMemory]; ok {
			v.AllocatableMemory = q.String()
		}
	}
	for _, t := range n.Spec.Taints {
		v.Taints = append(v.Taints, formatTaint(t))
	}
	for _, c := range n.Status.Conditions {
		v.Conditions = append(v.Conditions, NodeConditionRow{
			Type:    string(c.Type),
			Status:  string(c.Status),
			Reason:  c.Reason,
			Message: c.Message,
		})
	}
	sort.Slice(v.Conditions, func(i, j int) bool {
		return v.Conditions[i].Type < v.Conditions[j].Type
	})
	return v
}

func formatNodeRolesFromLabels(labels map[string]string) string {
	if labels == nil {
		return "worker"
	}
	var roles []string
	if _, ok := labels["node-role.kubernetes.io/control-plane"]; ok {
		roles = append(roles, "control-plane")
	}
	if _, ok := labels["node-role.kubernetes.io/master"]; ok {
		roles = append(roles, "master")
	}
	if r, ok := labels["kubernetes.io/role"]; ok && r != "" {
		if r == "worker" && len(roles) > 0 {
			// skip duplicate worker when already control plane
		} else if r != "worker" || len(roles) == 0 {
			roles = append(roles, r)
		}
	}
	if len(roles) == 0 {
		return "worker"
	}
	return strings.Join(roles, ", ")
}

func formatTaint(t corev1.Taint) string {
	if t.Key == "" {
		return "—"
	}
	s := t.Key
	if t.Value != "" {
		s += "=" + t.Value
	}
	s += ":" + string(t.Effect)
	return s
}

func listNodeRelatedEvents(ctx context.Context, client *kubernetes.Clientset, nodeName string) ([]corev1.Event, error) {
	selector := fields.AndSelectors(
		fields.OneTermEqualSelector("involvedObject.kind", "Node"),
		fields.OneTermEqualSelector("involvedObject.name", nodeName),
	).String()
	evCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	// Node 相关 Event 多数在 default；再补 kube-system
	namespaces := []string{metav1.NamespaceDefault, metav1.NamespaceSystem}
	seen := make(map[string]struct{})
	var related []corev1.Event
	for _, ns := range namespaces {
		evList, err := client.CoreV1().Events(ns).List(evCtx, metav1.ListOptions{FieldSelector: selector})
		if err != nil {
			continue
		}
		for i := range evList.Items {
			ev := evList.Items[i]
			if ev.InvolvedObject.Kind != "Node" || ev.InvolvedObject.Name != nodeName {
				continue
			}
			uid := string(ev.UID)
			if uid == "" {
				uid = ev.Name + "/" + ns
			}
			if _, ok := seen[uid]; ok {
				continue
			}
			seen[uid] = struct{}{}
			related = append(related, ev)
		}
	}
	sort.Slice(related, func(i, j int) bool {
		return related[i].LastTimestamp.Time.Before(related[j].LastTimestamp.Time)
	})
	return related, nil
}

// RegisterNodeRoutes Node describe / YAML / update（不提供 delete，避免误删节点）
func RegisterNodeRoutes(r *gin.Engine, reg *cluster.Registry) {
	r.GET("/api/clusters/:id/nodes/:name/describe", func(c *gin.Context) {
		id, name := c.Param("id"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		ctx := c.Request.Context()
		node, err := client.CoreV1().Nodes().Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		view := buildNodeDescribeView(node)
		related, err := listNodeRelatedEvents(ctx, client, name)
		if err != nil {
			log.Printf("describe node=%s list events error: %v", name, err)
			c.JSON(http.StatusOK, NodeDescribeResponse{View: view, Events: nil})
			return
		}
		c.JSON(http.StatusOK, NodeDescribeResponse{View: view, Events: related})
	})

	r.GET("/api/clusters/:id/nodes/:name/yaml", func(c *gin.Context) {
		id, name := c.Param("id"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		node, err := client.CoreV1().Nodes().Get(c.Request.Context(), name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		node.ManagedFields = nil
		raw, err := yaml.Marshal(node)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Data(http.StatusOK, "text/yaml; charset=utf-8", raw)
	})

	r.PUT("/api/clusters/:id/nodes/:name", func(c *gin.Context) {
		id, name := c.Param("id"), c.Param("name")
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
		var node corev1.Node
		if err := yaml.Unmarshal(body, &node); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid YAML: " + err.Error()})
			return
		}
		existing, err := client.CoreV1().Nodes().Get(c.Request.Context(), name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		node.Name = name
		node.ResourceVersion = existing.ResourceVersion
		updated, err := client.CoreV1().Nodes().Update(c.Request.Context(), &node, metav1.UpdateOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		invalidateNodeListCache(id)
		c.JSON(http.StatusOK, updated)
	})
}
