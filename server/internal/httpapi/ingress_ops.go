package httpapi

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	"weblens/server/internal/cluster"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/client-go/kubernetes"

	"github.com/gin-gonic/gin"
	"sigs.k8s.io/yaml"
)

func invalidateIngressListCache(clusterID, ns string) {
	listCacheMu.Lock()
	defer listCacheMu.Unlock()
	delete(listCache, listCacheKey("ingresses", clusterID, ns))
	delete(listCache, listCacheKey("ingresses", clusterID, corev1.NamespaceAll))
}

// IngressRuleRowView 单条 path 规则（Describe / 列表展开同源结构）
type IngressRuleRowView struct {
	Host        string `json:"host"`
	Path        string `json:"path"`
	PathType    string `json:"pathType"`
	ServiceName string `json:"serviceName"`
	Port        string `json:"port"`
	TLSHint     string `json:"tlsHint"`
}

// IngressTLSView TLS 条目
type IngressTLSView struct {
	SecretName string   `json:"secretName"`
	Hosts      []string `json:"hosts,omitempty"`
}

// IngressBackendView Service + Port 摘要
type IngressBackendView struct {
	ServiceName string `json:"serviceName"`
	Port        string `json:"port"`
}

// IngressDescribeView 结构化 Ingress 信息
type IngressDescribeView struct {
	Name              string               `json:"name"`
	Namespace         string               `json:"namespace"`
	IngressClassName  string               `json:"ingressClassName,omitempty"`
	CreationTimestamp string               `json:"creationTimestamp,omitempty"`
	Labels            map[string]string    `json:"labels,omitempty"`
	Annotations       map[string]string    `json:"annotations,omitempty"`
	HostCount         int                  `json:"hostCount"`
	PathCount         int                  `json:"pathCount"`
	TLSConfigured     bool                 `json:"tlsConfigured"`
	HasDefaultBackend bool                 `json:"hasDefaultBackend"`
	Rules             []IngressRuleRowView `json:"rules"`
	TLS               []IngressTLSView     `json:"tls"`
	DefaultBackend    *IngressBackendView  `json:"defaultBackend,omitempty"`
}

// IngressDescribeResponse 供前端分块渲染
type IngressDescribeResponse struct {
	View   IngressDescribeView `json:"view"`
	Events []corev1.Event      `json:"events"`
}

func formatServiceBackendPort(p networkingv1.ServiceBackendPort) string {
	if p.Name != "" {
		return p.Name
	}
	if p.Number != 0 {
		return fmt.Sprintf("%d", p.Number)
	}
	return "—"
}

func ingressBackendView(svc *networkingv1.IngressServiceBackend) *IngressBackendView {
	if svc == nil {
		return nil
	}
	return &IngressBackendView{
		ServiceName: svc.Name,
		Port:        formatServiceBackendPort(svc.Port),
	}
}

func tlsHintForIngressPath(ruleHost string, specTLS []networkingv1.IngressTLS) string {
	if len(specTLS) == 0 {
		return "—"
	}
	var out []string
	seen := map[string]struct{}{}
	rh := ruleHost
	for _, t := range specTLS {
		if t.SecretName == "" {
			continue
		}
		match := false
		if len(t.Hosts) == 0 {
			match = true
		} else if rh == "" {
			match = true
		} else {
			for _, h := range t.Hosts {
				if h == rh {
					match = true
					break
				}
			}
		}
		if match {
			if _, ok := seen[t.SecretName]; !ok {
				seen[t.SecretName] = struct{}{}
				out = append(out, t.SecretName)
			}
		}
	}
	if len(out) == 0 {
		return "未匹配证书"
	}
	return strings.Join(out, ", ")
}

func appendIngressRuleRows(ing *networkingv1.Ingress, rows *[]IngressRuleRowView) {
	spec := ing.Spec
	for _, rule := range spec.Rules {
		host := rule.Host
		if rule.HTTP == nil {
			continue
		}
		for _, p := range rule.HTTP.Paths {
			row := IngressRuleRowView{
				Host:     host,
				Path:     p.Path,
				PathType: "",
			}
			if p.PathType != nil {
				row.PathType = string(*p.PathType)
			}
			if p.Backend.Service != nil {
				row.ServiceName = p.Backend.Service.Name
				row.Port = formatServiceBackendPort(p.Backend.Service.Port)
			}
			row.TLSHint = tlsHintForIngressPath(host, spec.TLS)
			*rows = append(*rows, row)
		}
	}
}

func buildIngressDescribeView(ing *networkingv1.Ingress) IngressDescribeView {
	view := IngressDescribeView{
		Name:              ing.Name,
		Namespace:         ing.Namespace,
		Labels:            ing.Labels,
		Annotations:       ing.Annotations,
		TLSConfigured:     len(ing.Spec.TLS) > 0,
		HasDefaultBackend: ing.Spec.DefaultBackend != nil && ing.Spec.DefaultBackend.Service != nil,
	}
	if ing.Spec.IngressClassName != nil {
		view.IngressClassName = *ing.Spec.IngressClassName
	}
	if !ing.CreationTimestamp.IsZero() {
		view.CreationTimestamp = ing.CreationTimestamp.Time.UTC().Format(time.RFC3339)
	}
	hostSeen := map[string]struct{}{}
	for _, rule := range ing.Spec.Rules {
		hostSeen[rule.Host] = struct{}{}
	}
	view.HostCount = len(hostSeen)
	var rows []IngressRuleRowView
	appendIngressRuleRows(ing, &rows)
	if len(rows) == 0 && view.HasDefaultBackend {
		db := ing.Spec.DefaultBackend.Service
		row := IngressRuleRowView{
			Host:        "",
			Path:        "—",
			PathType:    "—",
			ServiceName: db.Name,
			Port:        formatServiceBackendPort(db.Port),
			TLSHint:     tlsHintForIngressPath("", ing.Spec.TLS),
		}
		rows = append(rows, row)
	}
	view.Rules = rows
	view.PathCount = len(rows)
	if view.Rules == nil {
		view.Rules = []IngressRuleRowView{}
	}
	for _, t := range ing.Spec.TLS {
		view.TLS = append(view.TLS, IngressTLSView{SecretName: t.SecretName, Hosts: append([]string(nil), t.Hosts...)})
	}
	if view.TLS == nil {
		view.TLS = []IngressTLSView{}
	}
	if ing.Spec.DefaultBackend != nil && ing.Spec.DefaultBackend.Service != nil {
		view.DefaultBackend = ingressBackendView(ing.Spec.DefaultBackend.Service)
	}
	return view
}

func listIngressRelatedEvents(ctx context.Context, client *kubernetes.Clientset, ing *networkingv1.Ingress) ([]corev1.Event, error) {
	ns := ing.Namespace
	selector := fields.AndSelectors(
		fields.OneTermEqualSelector("involvedObject.kind", "Ingress"),
		fields.OneTermEqualSelector("involvedObject.namespace", ns),
		fields.OneTermEqualSelector("involvedObject.name", ing.Name),
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
		if ev.InvolvedObject.UID == ing.UID {
			related = append(related, ev)
		}
	}
	sort.Slice(related, func(i, j int) bool {
		return related[i].LastTimestamp.Time.Before(related[j].LastTimestamp.Time)
	})
	return related, nil
}

// RegisterIngressRoutes Ingress describe / YAML / delete
func RegisterIngressRoutes(r *gin.Engine, reg *cluster.Registry) {
	r.GET("/api/clusters/:id/ingresses/:namespace/:name/describe", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		ctx := c.Request.Context()
		ing, err := client.NetworkingV1().Ingresses(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		view := buildIngressDescribeView(ing)
		related, err := listIngressRelatedEvents(ctx, client, ing)
		if err != nil {
			log.Printf("describe ingress=%s/%s list events error: %v", ns, name, err)
			c.JSON(http.StatusOK, IngressDescribeResponse{View: view, Events: nil})
			return
		}
		c.JSON(http.StatusOK, IngressDescribeResponse{View: view, Events: related})
	})

	r.GET("/api/clusters/:id/ingresses/:namespace/:name/yaml", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		ing, err := client.NetworkingV1().Ingresses(ns).Get(c.Request.Context(), name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		ing.ManagedFields = nil
		raw, err := yaml.Marshal(ing)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Data(http.StatusOK, "text/yaml; charset=utf-8", raw)
	})

	r.PUT("/api/clusters/:id/ingresses/:namespace/:name", func(c *gin.Context) {
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
		var ing networkingv1.Ingress
		if err := yaml.Unmarshal(body, &ing); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid YAML: " + err.Error()})
			return
		}
		existing, err := client.NetworkingV1().Ingresses(ns).Get(c.Request.Context(), name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		ing.Namespace = ns
		ing.Name = name
		ing.ResourceVersion = existing.ResourceVersion
		updated, err := client.NetworkingV1().Ingresses(ns).Update(c.Request.Context(), &ing, metav1.UpdateOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		invalidateIngressListCache(id, ns)
		c.JSON(http.StatusOK, updated)
	})

	r.DELETE("/api/clusters/:id/ingresses/:namespace/:name", func(c *gin.Context) {
		id, ns, name := c.Param("id"), c.Param("namespace"), c.Param("name")
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		err := client.NetworkingV1().Ingresses(ns).Delete(c.Request.Context(), name, metav1.DeleteOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		invalidateIngressListCache(id, ns)
		c.Status(http.StatusNoContent)
	})
}
