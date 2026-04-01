package httpapi

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"weblens/server/internal/cluster"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"

	"github.com/gin-gonic/gin"
	"sigs.k8s.io/yaml"
)

func invalidateServiceListCache(clusterID, ns string) {
	listCacheMu.Lock()
	defer listCacheMu.Unlock()
	delete(listCache, listCacheKey("services", clusterID, ns))
	delete(listCache, listCacheKey("services", clusterID, corev1.NamespaceAll))
}

func invalidateEndpointsListCache(clusterID, ns string) {
	listCacheMu.Lock()
	defer listCacheMu.Unlock()
	delete(listCache, listCacheKey("endpoints", clusterID, ns))
	delete(listCache, listCacheKey("endpoints", clusterID, corev1.NamespaceAll))
}

// ServicePortView Service Describe 端口行
type ServicePortView struct {
	Name       string `json:"name"`
	Protocol   string `json:"protocol"`
	Port       int32  `json:"port"`
	TargetPort string `json:"targetPort"`
	NodePort   int32  `json:"nodePort,omitempty"`
}

// ServiceEndpointRowView Endpoints 展开行
type ServiceEndpointRowView struct {
	IP         string `json:"ip"`
	Ports      string `json:"ports"`
	Ready      bool   `json:"ready"`
	NodeName   string `json:"nodeName,omitempty"`
	PodName    string `json:"podName,omitempty"`
	PodHealth  string `json:"podHealth,omitempty"`
	PodPhase   string `json:"podPhase,omitempty"`
	Note       string `json:"note,omitempty"`
}

// ServiceIngressRefView 引用本 Service 的 Ingress 规则摘要
type ServiceIngressRefView struct {
	IngressName string `json:"ingressName"`
	Host        string `json:"host"`
	Path        string `json:"path"`
}

// ServiceRelatedPodView selector 命中的 Pod
type ServiceRelatedPodView struct {
	Name        string `json:"name"`
	Phase       string `json:"phase"`
	HealthLabel string `json:"healthLabel"`
}

// ServiceDescribeView 结构化 Service Describe
type ServiceDescribeView struct {
	Name                  string                       `json:"name"`
	Namespace             string                       `json:"namespace"`
	CreationTimestamp     string                       `json:"creationTimestamp,omitempty"`
	Labels                map[string]string            `json:"labels,omitempty"`
	Annotations           map[string]string            `json:"annotations,omitempty"`
	Type                  string                       `json:"type"`
	ClusterIP             string                       `json:"clusterIP"`
	ExternalName          string                       `json:"externalName,omitempty"`
	SessionAffinity       string                       `json:"sessionAffinity"`
	LoadBalancerIngress   []string                     `json:"loadBalancerIngress,omitempty"`
	Ports                 []ServicePortView            `json:"ports"`
	Selector              map[string]string            `json:"selector,omitempty"`
	EndpointReadyCount    int                          `json:"endpointReadyCount"`
	EndpointNotReadyCount int                          `json:"endpointNotReadyCount"`
	EndpointRows          []ServiceEndpointRowView     `json:"endpointRows"`
	RelatedPods           []ServiceRelatedPodView      `json:"relatedPods"`
	ReferencedByIngresses []ServiceIngressRefView      `json:"referencedByIngresses"`
}

// ServiceDescribeResponse Describe API 响应
type ServiceDescribeResponse struct {
	View   ServiceDescribeView `json:"view"`
	Events []corev1.Event      `json:"events"`
}

func formatTargetPort(p intstr.IntOrString) string {
	if p.Type == intstr.Int {
		return strconv.Itoa(int(p.IntVal))
	}
	return p.StrVal
}

func buildServicePortViews(svc *corev1.Service) []ServicePortView {
	var out []ServicePortView
	for _, sp := range svc.Spec.Ports {
		out = append(out, ServicePortView{
			Name:       sp.Name,
			Protocol:   string(sp.Protocol),
			Port:       sp.Port,
			TargetPort: formatTargetPort(sp.TargetPort),
			NodePort:   sp.NodePort,
		})
	}
	return out
}

func selectorMatches(labels map[string]string, sel map[string]string) bool {
	if len(sel) == 0 {
		return false
	}
	for k, v := range sel {
		if labels[k] != v {
			return false
		}
	}
	return true
}

func buildServiceEndpointRows(ep *corev1.Endpoints, podHealth map[string]PodHealth) ([]ServiceEndpointRowView, int, int) {
	var rows []ServiceEndpointRowView
	readyN, notReadyN := 0, 0
	if ep == nil {
		return rows, 0, 0
	}
	for _, sub := range ep.Subsets {
		var portParts []string
		for _, p := range sub.Ports {
			portParts = append(portParts, fmt.Sprintf("%d/%s", p.Port, p.Protocol))
		}
		portsStr := strings.Join(portParts, ", ")
		for _, a := range sub.Addresses {
			readyN++
			row := ServiceEndpointRowView{
				IP:       a.IP,
				Ports:    portsStr,
				Ready:    true,
				NodeName: derefStr(a.NodeName),
			}
			if a.TargetRef != nil && a.TargetRef.Kind == "Pod" {
				row.PodName = a.TargetRef.Name
				if h, ok := podHealth[a.TargetRef.Name]; ok {
					row.PodHealth = h.HealthLabel
				}
			}
			rows = append(rows, row)
		}
		for _, a := range sub.NotReadyAddresses {
			notReadyN++
			row := ServiceEndpointRowView{
				IP:       a.IP,
				Ports:    portsStr,
				Ready:    false,
				NodeName: derefStr(a.NodeName),
				Note:     "NotReady",
			}
			if a.TargetRef != nil && a.TargetRef.Kind == "Pod" {
				row.PodName = a.TargetRef.Name
				if h, ok := podHealth[a.TargetRef.Name]; ok {
					row.PodHealth = h.HealthLabel
				}
			}
			rows = append(rows, row)
		}
	}
	return rows, readyN, notReadyN
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func listServiceRelatedEvents(ctx context.Context, client *kubernetes.Clientset, svc *corev1.Service) ([]corev1.Event, error) {
	ns := svc.Namespace
	selector := fields.AndSelectors(
		fields.OneTermEqualSelector("involvedObject.kind", "Service"),
		fields.OneTermEqualSelector("involvedObject.namespace", ns),
		fields.OneTermEqualSelector("involvedObject.name", svc.Name),
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
		if ev.InvolvedObject.UID == svc.UID {
			related = append(related, ev)
		}
	}
	sort.Slice(related, func(i, j int) bool {
		return related[i].LastTimestamp.Time.Before(related[j].LastTimestamp.Time)
	})
	return related, nil
}

func findIngressRefsToService(ctx context.Context, client *kubernetes.Clientset, ns, svcName string) []ServiceIngressRefView {
	ingCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	list, err := client.NetworkingV1().Ingresses(ns).List(ingCtx, metav1.ListOptions{})
	if err != nil {
		return nil
	}
	var refs []ServiceIngressRefView
	for i := range list.Items {
		ing := &list.Items[i]
		for _, rule := range ing.Spec.Rules {
			if rule.HTTP == nil {
				continue
			}
			host := rule.Host
			for _, p := range rule.HTTP.Paths {
				if p.Backend.Service != nil && p.Backend.Service.Name == svcName {
					path := p.Path
					if path == "" {
						path = "/"
					}
					refs = append(refs, ServiceIngressRefView{
						IngressName: ing.Name,
						Host:        host,
						Path:        path,
					})
				}
			}
		}
		if ing.Spec.DefaultBackend != nil && ing.Spec.DefaultBackend.Service != nil &&
			ing.Spec.DefaultBackend.Service.Name == svcName {
			refs = append(refs, ServiceIngressRefView{
				IngressName: ing.Name,
				Host:        "（default backend）",
				Path:        "—",
			})
		}
	}
	return refs
}

func buildServiceDescribeView(ctx context.Context, client *kubernetes.Clientset, svc *corev1.Service) (ServiceDescribeView, error) {
	now := time.Now()
	view := ServiceDescribeView{
		Name:              svc.Name,
		Namespace:         svc.Namespace,
		CreationTimestamp: svc.CreationTimestamp.UTC().Format(time.RFC3339),
		Labels:            svc.Labels,
		Annotations:       svc.Annotations,
		Type:              string(svc.Spec.Type),
		ClusterIP:         svc.Spec.ClusterIP,
		ExternalName:      svc.Spec.ExternalName,
		SessionAffinity:   string(svc.Spec.SessionAffinity),
		Ports:             buildServicePortViews(svc),
		Selector:          svc.Spec.Selector,
	}
	if len(svc.Status.LoadBalancer.Ingress) > 0 {
		for _, x := range svc.Status.LoadBalancer.Ingress {
			if x.IP != "" {
				view.LoadBalancerIngress = append(view.LoadBalancerIngress, x.IP)
			}
			if x.Hostname != "" {
				view.LoadBalancerIngress = append(view.LoadBalancerIngress, x.Hostname)
			}
		}
	}

	podHealth := make(map[string]PodHealth)
	if len(svc.Spec.Selector) > 0 {
		pctx, pcancel := context.WithTimeout(ctx, 8*time.Second)
		pods, err := client.CoreV1().Pods(svc.Namespace).List(pctx, metav1.ListOptions{})
		pcancel()
		if err == nil {
			for i := range pods.Items {
				p := &pods.Items[i]
				if selectorMatches(p.Labels, svc.Spec.Selector) {
					h := computePodHealth(p, now)
					podHealth[p.Name] = h
					view.RelatedPods = append(view.RelatedPods, ServiceRelatedPodView{
						Name:        p.Name,
						Phase:       string(p.Status.Phase),
						HealthLabel: h.HealthLabel,
					})
				}
			}
			sort.Slice(view.RelatedPods, func(i, j int) bool {
				return view.RelatedPods[i].Name < view.RelatedPods[j].Name
			})
		}
	}

	ep, err := client.CoreV1().Endpoints(svc.Namespace).Get(ctx, svc.Name, metav1.GetOptions{})
	if err != nil {
		view.EndpointRows = nil
	} else {
		rows, r, n := buildServiceEndpointRows(ep, podHealth)
		view.EndpointRows = rows
		view.EndpointReadyCount = r
		view.EndpointNotReadyCount = n
	}

	view.ReferencedByIngresses = findIngressRefsToService(ctx, client, svc.Namespace, svc.Name)

	return view, nil
}

// RegisterServiceRoutes Service describe / YAML / delete
func RegisterServiceRoutes(r *gin.Engine, reg *cluster.Registry) {
	r.GET("/api/clusters/:id/services/:namespace/:name/describe", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		ctx := c.Request.Context()
		svc, err := client.CoreV1().Services(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		view, err := buildServiceDescribeView(ctx, client, svc)
		if err != nil {
			log.Printf("describe service=%s/%s build view error: %v", ns, name, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		related, err := listServiceRelatedEvents(ctx, client, svc)
		if err != nil {
			log.Printf("describe service=%s/%s list events error: %v", ns, name, err)
			c.JSON(http.StatusOK, ServiceDescribeResponse{View: view, Events: nil})
			return
		}
		c.JSON(http.StatusOK, ServiceDescribeResponse{View: view, Events: related})
	})

	r.GET("/api/clusters/:id/services/:namespace/:name/yaml", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		svc, err := client.CoreV1().Services(ns).Get(c.Request.Context(), name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		svc.ManagedFields = nil
		raw, err := yaml.Marshal(svc)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Data(http.StatusOK, "text/yaml; charset=utf-8", raw)
	})

	r.PUT("/api/clusters/:id/services/:namespace/:name", func(c *gin.Context) {
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
		var svc corev1.Service
		if err := yaml.Unmarshal(body, &svc); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid YAML: " + err.Error()})
			return
		}
		existing, err := client.CoreV1().Services(ns).Get(c.Request.Context(), name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		svc.Namespace = ns
		svc.Name = name
		svc.ResourceVersion = existing.ResourceVersion
		updated, err := client.CoreV1().Services(ns).Update(c.Request.Context(), &svc, metav1.UpdateOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		invalidateServiceListCache(id, ns)
		invalidateEndpointsListCache(id, ns)
		c.JSON(http.StatusOK, updated)
	})

	r.DELETE("/api/clusters/:id/services/:namespace/:name", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		err := client.CoreV1().Services(ns).Delete(c.Request.Context(), name, metav1.DeleteOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		invalidateServiceListCache(id, ns)
		invalidateEndpointsListCache(id, ns)
		c.Status(http.StatusNoContent)
	})
}
