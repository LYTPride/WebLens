package httpapi

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"weblens/server/internal/cluster"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/client-go/kubernetes"

	"github.com/gin-gonic/gin"
)

// DeploymentDescribeResponse 供前端分块渲染，避免整段 kubectl describe 文本
type DeploymentDescribeResponse struct {
	View   DeploymentDescribeView `json:"view"`
	Events []corev1.Event         `json:"events"`
}

// DeploymentDescribeView 结构化 Deployment 信息
type DeploymentDescribeView struct {
	Name                    string                       `json:"name"`
	Namespace               string                       `json:"namespace"`
	CreationTimestamp       string                       `json:"creationTimestamp,omitempty"`
	Labels                  map[string]string            `json:"labels,omitempty"`
	Annotations             map[string]string            `json:"annotations,omitempty"`
	Selector                string                       `json:"selector,omitempty"`
	Replicas                DeploymentReplicaStatusView  `json:"replicas"`
	Conditions              []appsv1.DeploymentCondition `json:"conditions,omitempty"`
	PodTemplate             DeploymentPodTemplateView    `json:"podTemplate"`
	StrategyType            string                       `json:"strategyType"`
	RollingUpdate           *RollingUpdateDescribeView   `json:"rollingUpdate,omitempty"`
	ProgressDeadlineSeconds *int32                       `json:"progressDeadlineSeconds,omitempty"`
}

// DeploymentReplicaStatusView 副本与状态摘要
type DeploymentReplicaStatusView struct {
	Desired     int32 `json:"desired"`
	Updated     int32 `json:"updated"`
	Ready       int32 `json:"ready"`
	Available   int32 `json:"available"`
	Unavailable int32 `json:"unavailable"`
}

// DeploymentPodTemplateView Pod 模板摘要
type DeploymentPodTemplateView struct {
	Containers     []ContainerDescribeView `json:"containers"`
	InitContainers []ContainerDescribeView `json:"initContainers,omitempty"`
	Volumes        []VolumeDescribeView    `json:"volumes,omitempty"`
	ServiceAccount string                  `json:"serviceAccount,omitempty"`
	NodeSelector   map[string]string       `json:"nodeSelector,omitempty"`
	Tolerations    []corev1.Toleration     `json:"tolerations,omitempty"`
}

// ContainerDescribeView 容器条目
type ContainerDescribeView struct {
	Name         string            `json:"name"`
	Image        string            `json:"image"`
	Ports        []string          `json:"ports,omitempty"`
	Requests     map[string]string `json:"requests,omitempty"`
	Limits       map[string]string `json:"limits,omitempty"`
	Env          []EnvDescribeView `json:"env,omitempty"`
	VolumeMounts []string          `json:"volumeMounts,omitempty"`
}

// EnvDescribeView 环境变量（值或引用摘要）
type EnvDescribeView struct {
	Name  string `json:"name"`
	Value string `json:"value,omitempty"`
	From  string `json:"from,omitempty"`
}

// VolumeDescribeView 卷摘要
type VolumeDescribeView struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
}

// RollingUpdateDescribeView 滚动更新参数
type RollingUpdateDescribeView struct {
	MaxUnavailable string `json:"maxUnavailable,omitempty"`
	MaxSurge       string `json:"maxSurge,omitempty"`
}

type deploymentDescribeCacheEntry struct {
	ts   time.Time
	data DeploymentDescribeResponse
}

var (
	deploymentDescribeCache   = make(map[string]deploymentDescribeCacheEntry)
	deploymentDescribeCacheMu sync.Mutex
	deploymentDescribeTTL     = 3 * time.Second
)

func deploymentDescribeCacheKey(clusterID, ns, name string) string {
	return strings.Join([]string{"deploy-desc", clusterID, ns, name}, "|")
}

func getDeploymentDescribeFromCache(key string) (DeploymentDescribeResponse, bool) {
	deploymentDescribeCacheMu.Lock()
	defer deploymentDescribeCacheMu.Unlock()
	e, ok := deploymentDescribeCache[key]
	if !ok {
		return DeploymentDescribeResponse{}, false
	}
	if time.Since(e.ts) > deploymentDescribeTTL {
		delete(deploymentDescribeCache, key)
		return DeploymentDescribeResponse{}, false
	}
	return e.data, true
}

func setDeploymentDescribeCache(key string, data DeploymentDescribeResponse) {
	deploymentDescribeCacheMu.Lock()
	deploymentDescribeCache[key] = deploymentDescribeCacheEntry{ts: time.Now(), data: data}
	deploymentDescribeCacheMu.Unlock()
}

func qtyMap(m corev1.ResourceList) map[string]string {
	if len(m) == 0 {
		return nil
	}
	out := make(map[string]string, len(m))
	for k, q := range m {
		out[string(k)] = q.String()
	}
	return out
}

func summarizeEnv(e corev1.EnvVar) EnvDescribeView {
	v := EnvDescribeView{Name: e.Name}
	if e.Value != "" {
		v.Value = e.Value
		return v
	}
	if e.ValueFrom == nil {
		return v
	}
	vf := e.ValueFrom
	switch {
	case vf.ConfigMapKeyRef != nil:
		r := vf.ConfigMapKeyRef
		v.From = fmt.Sprintf("configMapKeyRef %s/%s", r.Name, r.Key)
	case vf.SecretKeyRef != nil:
		r := vf.SecretKeyRef
		v.From = fmt.Sprintf("secretKeyRef %s/%s", r.Name, r.Key)
	case vf.FieldRef != nil:
		v.From = fmt.Sprintf("fieldRef %s", vf.FieldRef.FieldPath)
	case vf.ResourceFieldRef != nil:
		v.From = fmt.Sprintf("resourceFieldRef %s", vf.ResourceFieldRef.Resource)
	default:
		v.From = "valueFrom"
	}
	return v
}

func volumeKind(vol corev1.Volume) string {
	switch {
	case vol.HostPath != nil:
		return "hostPath"
	case vol.EmptyDir != nil:
		return "emptyDir"
	case vol.ConfigMap != nil:
		return "configMap"
	case vol.Secret != nil:
		return "secret"
	case vol.PersistentVolumeClaim != nil:
		return "persistentVolumeClaim"
	case vol.DownwardAPI != nil:
		return "downwardAPI"
	case vol.Projected != nil:
		return "projected"
	default:
		return "other"
	}
}

func describeContainer(c corev1.Container) ContainerDescribeView {
	out := ContainerDescribeView{
		Name:  c.Name,
		Image: c.Image,
	}
	for _, p := range c.Ports {
		proto := string(p.Protocol)
		if proto == "" {
			proto = "TCP"
		}
		out.Ports = append(out.Ports, fmt.Sprintf("%d/%s", p.ContainerPort, proto))
	}
	if c.Resources.Requests != nil {
		out.Requests = qtyMap(c.Resources.Requests)
	}
	if c.Resources.Limits != nil {
		out.Limits = qtyMap(c.Resources.Limits)
	}
	for _, e := range c.Env {
		out.Env = append(out.Env, summarizeEnv(e))
	}
	for _, vm := range c.VolumeMounts {
		out.VolumeMounts = append(out.VolumeMounts, fmt.Sprintf("%s → %s", vm.Name, vm.MountPath))
	}
	return out
}

func buildDeploymentDescribeView(dep *appsv1.Deployment) DeploymentDescribeView {
	spec := dep.Spec
	st := spec.Strategy
	status := dep.Status

	desired := int32(1)
	if spec.Replicas != nil {
		desired = *spec.Replicas
	}

	view := DeploymentDescribeView{
		Name:         dep.Name,
		Namespace:    dep.Namespace,
		Labels:       dep.Labels,
		Annotations:  dep.Annotations,
		Conditions:   status.Conditions,
		StrategyType: string(st.Type),
		PodTemplate:  DeploymentPodTemplateView{},
		Replicas: DeploymentReplicaStatusView{
			Desired:     desired,
			Updated:     status.UpdatedReplicas,
			Ready:       status.ReadyReplicas,
			Available:   status.AvailableReplicas,
			Unavailable: status.UnavailableReplicas,
		},
	}
	if !dep.CreationTimestamp.IsZero() {
		view.CreationTimestamp = dep.CreationTimestamp.Time.UTC().Format(time.RFC3339)
	}
	if spec.Selector != nil {
		view.Selector = metav1.FormatLabelSelector(spec.Selector)
	}
	if spec.ProgressDeadlineSeconds != nil {
		view.ProgressDeadlineSeconds = spec.ProgressDeadlineSeconds
	}

	if st.Type == appsv1.RollingUpdateDeploymentStrategyType && st.RollingUpdate != nil {
		ru := st.RollingUpdate
		view.RollingUpdate = &RollingUpdateDescribeView{
			MaxUnavailable: ru.MaxUnavailable.String(),
			MaxSurge:       ru.MaxSurge.String(),
		}
	}

	pt := spec.Template.Spec
	view.PodTemplate.ServiceAccount = pt.ServiceAccountName
	if len(pt.NodeSelector) > 0 {
		view.PodTemplate.NodeSelector = pt.NodeSelector
	}
	if len(pt.Tolerations) > 0 {
		view.PodTemplate.Tolerations = pt.Tolerations
	}
	for _, c := range pt.Containers {
		view.PodTemplate.Containers = append(view.PodTemplate.Containers, describeContainer(c))
	}
	for _, c := range pt.InitContainers {
		view.PodTemplate.InitContainers = append(view.PodTemplate.InitContainers, describeContainer(c))
	}
	for _, vol := range pt.Volumes {
		view.PodTemplate.Volumes = append(view.PodTemplate.Volumes, VolumeDescribeView{
			Name: vol.Name,
			Kind: volumeKind(vol),
		})
	}

	return view
}

func listDeploymentRelatedEvents(ctx context.Context, client *kubernetes.Clientset, dep *appsv1.Deployment) ([]corev1.Event, error) {
	ns := dep.Namespace
	selector := fields.AndSelectors(
		fields.OneTermEqualSelector("involvedObject.kind", "Deployment"),
		fields.OneTermEqualSelector("involvedObject.namespace", ns),
		fields.OneTermEqualSelector("involvedObject.name", dep.Name),
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
		if ev.InvolvedObject.UID == dep.UID {
			related = append(related, ev)
		}
	}
	sort.Slice(related, func(i, j int) bool {
		ti, tj := related[i].LastTimestamp, related[j].LastTimestamp
		return ti.Time.Before(tj.Time)
	})
	return related, nil
}

// registerDeploymentDescribeRoute 注册 Deployment 结构化 Describe
func registerDeploymentDescribeRoute(r *gin.Engine, reg *cluster.Registry) {
	r.GET("/api/clusters/:id/deployments/:namespace/:name/describe", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}

		cacheKey := deploymentDescribeCacheKey(id, ns, name)
		if data, ok := getDeploymentDescribeFromCache(cacheKey); ok {
			c.JSON(http.StatusOK, &data)
			return
		}

		ctx := c.Request.Context()
		dep, err := client.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		view := buildDeploymentDescribeView(dep)

		related, err := listDeploymentRelatedEvents(ctx, client, dep)
		if err != nil {
			log.Printf("describe deployment=%s/%s list events error: %v", ns, name, err)
			resp := DeploymentDescribeResponse{View: view, Events: nil}
			setDeploymentDescribeCache(cacheKey, resp)
			c.JSON(http.StatusOK, &resp)
			return
		}

		resp := DeploymentDescribeResponse{View: view, Events: related}
		setDeploymentDescribeCache(cacheKey, resp)
		c.JSON(http.StatusOK, &resp)
	})
}
