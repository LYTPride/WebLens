package httpapi

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"weblens/server/internal/auth"

	"github.com/gin-gonic/gin"
)

func permissionTestContext(method, path string) *gin.Context {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(method, path, nil)
	return c
}

func TestRequiredCapabilityForRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name   string
		method string
		path   string
		want   auth.Capability
	}{
		{name: "list", method: http.MethodGet, path: "/api/clusters/c1/pods/default", want: auth.CapabilityResourceRead},
		{name: "logs", method: http.MethodGet, path: "/api/clusters/c1/pods/default/p1/logs", want: auth.CapabilityPodLogs},
		{name: "exec", method: http.MethodGet, path: "/api/clusters/c1/pods/default/p1/exec", want: auth.CapabilityPodExec},
		{name: "file read", method: http.MethodGet, path: "/api/clusters/c1/pods/default/p1/files", want: auth.CapabilityFileRead},
		{name: "file write", method: http.MethodPost, path: "/api/clusters/c1/pods/default/p1/files/upload", want: auth.CapabilityFileWrite},
		{name: "delete", method: http.MethodDelete, path: "/api/clusters/c1/pods/default/p1", want: auth.CapabilityResourceWrite},
		{name: "configmap export", method: http.MethodPost, path: "/api/clusters/c1/configmaps/export", want: auth.CapabilityResourceRead},
		{name: "non cluster", method: http.MethodGet, path: "/api/auth/me", want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := requiredCapabilityForRequest(permissionTestContext(tt.method, tt.path))
			if got != tt.want {
				t.Fatalf("required capability = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestAuditActionClassifiesSensitiveOperations(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		method string
		path   string
		want   string
	}{
		{method: http.MethodGet, path: "/api/clusters/c1/pods/default/p1/exec", want: "pod.exec"},
		{method: http.MethodDelete, path: "/api/clusters/c1/pods/default/p1", want: "resource.delete"},
		{method: http.MethodPost, path: "/api/clusters/c1/deployments/default/d1/restart", want: "resource.restart"},
		{method: http.MethodPost, path: "/api/clusters/c1/deployments/default/d1/scale", want: "resource.scale"},
		{method: http.MethodPut, path: "/api/auth/admin/users/2/grants", want: "access.manage"},
	}
	for _, tt := range tests {
		got := auditActionForRequest(permissionTestContext(tt.method, tt.path))
		if got != tt.want {
			t.Errorf("%s %s action = %q, want %q", tt.method, tt.path, got, tt.want)
		}
	}
}

func TestAuditOperationLogRequiredForResourceWrites(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c := permissionTestContext(http.MethodDelete, "/api/clusters/c1/pods/default/p1")
	if _, err := auditOperationLogForRequest(c, auditActionForRequest(c)); !errors.Is(err, errAuditReasonRequired) {
		t.Fatalf("missing operation log error = %v, want %v", err, errAuditReasonRequired)
	}

	c.Request.Header.Set(auditReasonHeader, "%E4%BF%AE%E5%A4%8D%E7%BA%BF%E4%B8%8A%E5%BC%82%E5%B8%B8")
	got, err := auditOperationLogForRequest(c, auditActionForRequest(c))
	if err != nil || got != "修复线上异常" {
		t.Fatalf("operation log = %q, err = %v", got, err)
	}

	c.Request.Header.Set(auditReasonHeader, strings.Repeat("a", maxAuditOperationLogLen+1))
	if _, err := auditOperationLogForRequest(c, auditActionForRequest(c)); !errors.Is(err, errAuditReasonTooLong) {
		t.Fatalf("long operation log error = %v, want %v", err, errAuditReasonTooLong)
	}

	c.Request.Header.Set(auditReasonHeader, "%ZZ")
	if _, err := auditOperationLogForRequest(c, auditActionForRequest(c)); !errors.Is(err, errAuditReasonInvalid) {
		t.Fatalf("invalid operation log error = %v, want %v", err, errAuditReasonInvalid)
	}

	read := permissionTestContext(http.MethodGet, "/api/clusters/c1/pods/default")
	if got, err := auditOperationLogForRequest(read, auditActionForRequest(read)); err != nil || got != "" {
		t.Fatalf("read operation log = %q, err = %v", got, err)
	}
}

func TestClusterScopeFromPath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c := permissionTestContext(http.MethodGet, "/api/clusters/c1/pods/default/p1")
	clusterID, namespace, kind, batch := clusterScopeFromPath(c)
	if clusterID != "c1" || namespace != "default" || kind != "pods" || batch {
		t.Fatalf("scope = %q/%q kind=%q batch=%v", clusterID, namespace, kind, batch)
	}

	c = permissionTestContext(http.MethodPost, "/api/clusters/c1/configmaps/batch-delete")
	clusterID, namespace, kind, batch = clusterScopeFromPath(c)
	if clusterID != "c1" || namespace != "" || kind != "configmaps" || !batch {
		t.Fatalf("batch scope = %q/%q kind=%q batch=%v", clusterID, namespace, kind, batch)
	}
}
