package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"weblens/server/internal/auth"

	"github.com/gin-gonic/gin"
)

const (
	auditReasonHeader       = "X-WebLens-Audit-Reason"
	maxAuditOperationLogLen = 500
)

var (
	errAuditReasonRequired = errors.New("本次资源操作的原因是强制必填项")
	errAuditReasonTooLong  = errors.New("资源操作原因不能超过 500 个字符")
	errAuditReasonInvalid  = errors.New("资源操作原因格式不合法")
)

func requiredCapabilityForRequest(c *gin.Context) auth.Capability {
	path := c.Request.URL.Path
	if !strings.HasPrefix(path, "/api/clusters/") {
		return ""
	}
	if strings.HasSuffix(path, "/exec") {
		return auth.CapabilityPodExec
	}
	if strings.HasSuffix(path, "/logs") {
		return auth.CapabilityPodLogs
	}
	if strings.Contains(path, "/files") {
		if c.Request.Method == http.MethodGet {
			return auth.CapabilityFileRead
		}
		return auth.CapabilityFileWrite
	}
	if c.Request.Method == http.MethodGet {
		return auth.CapabilityResourceRead
	}
	if strings.HasSuffix(path, "/configmaps/export") && c.Request.Method == http.MethodPost {
		return auth.CapabilityResourceRead
	}
	switch c.Request.Method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return auth.CapabilityResourceWrite
	default:
		return ""
	}
}

func auditActionForRequest(c *gin.Context) string {
	if c.Request.Method == http.MethodGet {
		if requiredCapabilityForRequest(c) == auth.CapabilityPodExec {
			return "pod.exec"
		}
		return ""
	}
	path := c.Request.URL.Path
	switch {
	case strings.HasPrefix(path, "/api/auth/admin/"):
		return "access.manage"
	case path == "/api/config" || path == "/api/clusters/reload":
		return "platform.config"
	case strings.HasPrefix(path, "/api/cluster-combos"):
		return "scope.config"
	}
	switch requiredCapabilityForRequest(c) {
	case auth.CapabilityFileWrite:
		return "file.write"
	case auth.CapabilityResourceWrite:
		switch {
		case c.Request.Method == http.MethodDelete || strings.HasSuffix(path, "/batch-delete"):
			return "resource.delete"
		case strings.HasSuffix(path, "/restart"):
			return "resource.restart"
		case strings.HasSuffix(path, "/scale"):
			return "resource.scale"
		default:
			return "resource.write"
		}
	default:
		return ""
	}
}

func auditActionRequiresOperationLog(action string) bool {
	switch action {
	case "resource.write", "resource.delete", "resource.restart", "resource.scale":
		return true
	default:
		return false
	}
}

func auditOperationLogForRequest(c *gin.Context, action string) (string, error) {
	if !auditActionRequiresOperationLog(action) {
		return "", nil
	}
	decoded, err := url.QueryUnescape(c.GetHeader(auditReasonHeader))
	if err != nil {
		return "", errAuditReasonInvalid
	}
	log := strings.TrimSpace(decoded)
	if log == "" {
		return "", errAuditReasonRequired
	}
	if len([]rune(log)) > maxAuditOperationLogLen {
		return "", errAuditReasonTooLong
	}
	return log, nil
}

func recordDeniedRequestAudit(store *auth.Store, c *gin.Context, user auth.User, capability auth.Capability, detail string) {
	action := auditActionForRequest(c)
	if action == "" {
		action = "access.denied"
	}
	recordRequestAuditWithResult(store, c, user, action, "denied", http.StatusForbidden, string(capability), detail)
}

func recordRequestAudit(store *auth.Store, c *gin.Context, user auth.User, action, detail string) {
	status := c.Writer.Status()
	result := "success"
	if status >= http.StatusBadRequest {
		result = "failure"
	}
	recordRequestAuditWithResult(store, c, user, action, result, status, string(requiredCapabilityForRequest(c)), detail)
}

func recordRequestAuditWithResult(
	store *auth.Store,
	c *gin.Context,
	user auth.User,
	action string,
	result string,
	status int,
	capability string,
	detail string,
) {
	clusterID, namespace, kind, _ := clusterScopeFromPath(c)
	resourceName := resourceNameFromPath(c.Request.URL.Path)
	if detail == "" && capability != "" {
		detail = "capability=" + capability
	}
	userID := user.ID
	record := auth.AuditRecord{
		UserID:       &userID,
		Username:     user.Username,
		Action:       action,
		Method:       c.Request.Method,
		Path:         c.Request.URL.Path,
		ClusterID:    clusterID,
		Namespace:    namespace,
		ResourceKind: kind,
		ResourceName: resourceName,
		Result:       result,
		StatusCode:   status,
		Detail:       detail,
	}
	if result != "denied" && auditActionRequiresOperationLog(action) {
		if log, err := auditOperationLogForRequest(c, action); err == nil {
			record.OperationLog = log
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = store.RecordAudit(ctx, record)
}

func resourceNameFromPath(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 5 || parts[0] != "api" || parts[1] != "clusters" {
		return ""
	}
	if parts[3] == "nodes" {
		if len(parts) >= 5 && parts[4] != "watch" {
			return parts[4]
		}
		return ""
	}
	if len(parts) >= 6 {
		switch parts[4] {
		case "watch", "batch-delete", "export":
			return ""
		default:
			return parts[5]
		}
	}
	return ""
}
