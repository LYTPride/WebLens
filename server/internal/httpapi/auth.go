package httpapi

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"weblens/server/internal/auth"
	"weblens/server/internal/cluster"

	"github.com/gin-gonic/gin"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const (
	sessionCookieName = "weblens_session"
	authUserKey       = "weblensAuthUser"
	authSessionKey    = "weblensSessionTokenHash"
)

type authEnvelope struct {
	User               auth.User           `json:"user"`
	Scopes             []auth.ClusterCombo `json:"scopes"`
	IdleTimeoutMs      int64               `json:"idleTimeoutMs"`
	IdleWarningMs      int64               `json:"idleWarningMs"`
	SessionExpiresAt   int64               `json:"sessionExpiresAt"`
	MustChangePassword bool                `json:"mustChangePassword"`
}

func setSessionCookie(c *gin.Context, token string, expiresAt time.Time) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   c.Request.TLS != nil,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
		MaxAge:   int(time.Until(expiresAt).Seconds()),
	})
}

func clearSessionCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   c.Request.TLS != nil,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
	})
}

func currentUser(c *gin.Context) (auth.User, bool) {
	v, ok := c.Get(authUserKey)
	if !ok {
		return auth.User{}, false
	}
	u, ok := v.(auth.User)
	return u, ok
}

func currentSessionTokenHash(c *gin.Context) string {
	v, ok := c.Get(authSessionKey)
	if !ok {
		return ""
	}
	s, _ := v.(string)
	return s
}

func buildAuthEnvelope(c *gin.Context, store *auth.Store, user auth.User, expiresAt time.Time) (authEnvelope, error) {
	scopes, err := store.ListCombosForUser(c.Request.Context(), user)
	if err != nil {
		return authEnvelope{}, err
	}
	return authEnvelope{
		User:               user,
		Scopes:             scopes,
		IdleTimeoutMs:      auth.IdleTimeout.Milliseconds(),
		IdleWarningMs:      auth.IdleWarningBefore.Milliseconds(),
		SessionExpiresAt:   expiresAt.UnixMilli(),
		MustChangePassword: user.MustChangePassword,
	}, nil
}

func registerAuthPublicRoutes(r *gin.Engine, store *auth.Store) {
	r.POST("/api/auth/login", func(c *gin.Context) {
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求体不合法"})
			return
		}
		user, err := store.Authenticate(c.Request.Context(), body.Username, body.Password)
		if err != nil {
			switch {
			case errors.Is(err, auth.ErrUserDisabled):
				c.JSON(http.StatusForbidden, gin.H{"error": "用户已被禁用", "code": "USER_DISABLED"})
			case errors.Is(err, auth.ErrInvalidCredentials):
				c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误", "code": "INVALID_CREDENTIALS"})
			default:
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			}
			return
		}
		token, tokenHash, err := auth.NewSessionToken()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "创建会话失败"})
			return
		}
		expiresAt := time.Now().Add(auth.IdleTimeout)
		if err := store.CreateSession(c.Request.Context(), user.ID, tokenHash, expiresAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "创建会话失败"})
			return
		}
		setSessionCookie(c, token, expiresAt)
		env, err := buildAuthEnvelope(c, store, user, expiresAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, env)
	})
}

func authRequired(store *auth.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		cookie, err := c.Cookie(sessionCookieName)
		if err != nil || strings.TrimSpace(cookie) == "" {
			clearSessionCookie(c)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "请先登录", "code": "UNAUTHENTICATED"})
			return
		}
		tokenHash := auth.HashSessionToken(cookie)
		user, _, err := store.ValidateSession(c.Request.Context(), tokenHash, time.Now())
		if err != nil {
			clearSessionCookie(c)
			if errors.Is(err, auth.ErrUserDisabled) {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "用户已被禁用，请联系管理员", "code": "USER_DISABLED"})
				return
			}
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "会话已失效，请重新登录", "code": "SESSION_EXPIRED"})
			return
		}
		c.Set(authUserKey, user)
		c.Set(authSessionKey, tokenHash)
		if user.MustChangePassword && !isPasswordChangeAllowedPath(c.Request.URL.Path) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "请先修改默认密码", "code": "PASSWORD_CHANGE_REQUIRED"})
			return
		}
		if !authorizeRequest(c, store, user) {
			return
		}
		c.Next()
	}
}

func isPasswordChangeAllowedPath(path string) bool {
	return path == "/api/auth/me" ||
		path == "/api/auth/logout" ||
		path == "/api/auth/change-password" ||
		path == "/api/auth/renew"
}

func authorizeRequest(c *gin.Context, store *auth.Store, user auth.User) bool {
	if user.Role == auth.RoleAdmin {
		return true
	}
	path := c.Request.URL.Path
	method := c.Request.Method

	if strings.HasPrefix(path, "/api/auth/admin") {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "需要管理员权限", "code": "ADMIN_REQUIRED"})
		return false
	}
	if path == "/api/auth/me" || path == "/api/auth/logout" || path == "/api/auth/change-password" || path == "/api/auth/renew" {
		return true
	}
	if path == "/api/config" || path == "/api/clusters/reload" {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "需要管理员权限", "code": "ADMIN_REQUIRED"})
		return false
	}
	if strings.HasPrefix(path, "/api/cluster-combos") {
		if path == "/api/cluster-combos" && method == http.MethodGet {
			return true
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "需要管理员权限", "code": "ADMIN_REQUIRED"})
		return false
	}
	if path == "/api/clusters" && method == http.MethodGet {
		return true
	}
	if strings.HasPrefix(path, "/api/analytics/") {
		return true
	}

	clusterID, namespace, kind, batchScoped := clusterScopeFromPath(c)
	if clusterID == "" {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "需要授权作用域", "code": "SCOPE_REQUIRED"})
		return false
	}
	if kind == "nodes" {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "普通用户不能访问集群级资源", "code": "SCOPE_FORBIDDEN"})
		return false
	}
	if batchScoped {
		return true
	}
	if kind == "namespaces" {
		ok, err := store.UserHasAnyScopeForCluster(c.Request.Context(), user, clusterID)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return false
		}
		if !ok {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "当前账号没有该集群的授权作用域", "code": "SCOPE_FORBIDDEN"})
			return false
		}
		return true
	}
	if namespace == "" {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "普通用户必须在已授权命名空间内操作", "code": "SCOPE_REQUIRED"})
		return false
	}
	ok, err := store.UserHasScope(c.Request.Context(), user, clusterID, namespace)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return false
	}
	if !ok {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "当前账号没有该作用域权限", "code": "SCOPE_FORBIDDEN"})
		return false
	}
	return true
}

func clusterScopeFromPath(c *gin.Context) (clusterID string, namespace string, kind string, batchScoped bool) {
	parts := strings.Split(strings.Trim(c.Request.URL.Path, "/"), "/")
	if len(parts) < 3 || parts[0] != "api" || parts[1] != "clusters" {
		return "", "", "", false
	}
	clusterID = parts[2]
	if len(parts) < 4 {
		return clusterID, "", "", false
	}
	kind = parts[3]
	if kind == "namespaces" || kind == "reload" {
		return clusterID, "", kind, false
	}
	if kind == "nodes" {
		return clusterID, "", kind, false
	}
	if kind == "configmaps" && len(parts) >= 5 && (parts[4] == "batch-delete" || parts[4] == "export") {
		return clusterID, "", kind, true
	}
	if ns := c.Query("namespace"); ns != "" {
		return clusterID, ns, kind, false
	}
	if len(parts) >= 5 {
		return clusterID, parts[4], kind, false
	}
	return clusterID, "", kind, false
}

func registerAuthProtectedRoutes(r *gin.Engine, store *auth.Store) {
	r.GET("/api/auth/me", func(c *gin.Context) {
		user, ok := currentUser(c)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
			return
		}
		_, expiresAt, err := store.ValidateSession(c.Request.Context(), currentSessionTokenHash(c), time.Now())
		if err != nil {
			clearSessionCookie(c)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "会话已失效，请重新登录", "code": "SESSION_EXPIRED"})
			return
		}
		env, err := buildAuthEnvelope(c, store, user, expiresAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, env)
	})

	r.POST("/api/auth/renew", func(c *gin.Context) {
		user, ok := currentUser(c)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
			return
		}
		expiresAt := time.Now().Add(auth.IdleTimeout)
		tokenHash := currentSessionTokenHash(c)
		if err := store.RenewSession(c.Request.Context(), tokenHash, expiresAt); err != nil {
			clearSessionCookie(c)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "会话已失效，请重新登录", "code": "SESSION_EXPIRED"})
			return
		}
		env, err := buildAuthEnvelope(c, store, user, expiresAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if raw, err := c.Cookie(sessionCookieName); err == nil && raw != "" {
			setSessionCookie(c, raw, expiresAt)
		}
		c.JSON(http.StatusOK, env)
	})

	r.POST("/api/auth/logout", func(c *gin.Context) {
		if tokenHash := currentSessionTokenHash(c); tokenHash != "" {
			_ = store.DeleteSession(c.Request.Context(), tokenHash)
		}
		clearSessionCookie(c)
		c.Status(http.StatusNoContent)
	})

	r.POST("/api/auth/change-password", func(c *gin.Context) {
		user, ok := currentUser(c)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
			return
		}
		var body struct {
			OldPassword string `json:"oldPassword"`
			NewPassword string `json:"newPassword"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求体不合法"})
			return
		}
		if err := store.ChangePassword(c.Request.Context(), user.ID, body.OldPassword, body.NewPassword, currentSessionTokenHash(c)); err != nil {
			status := http.StatusBadRequest
			msg := err.Error()
			if errors.Is(err, auth.ErrInvalidCredentials) {
				status = http.StatusUnauthorized
				msg = "当前密码错误"
			}
			c.JSON(status, gin.H{"error": msg})
			return
		}
		u, err := store.UserByID(c.Request.Context(), user.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		_, expiresAt, _ := store.ValidateSession(c.Request.Context(), currentSessionTokenHash(c), time.Now())
		env, err := buildAuthEnvelope(c, store, u.User, expiresAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, env)
	})

	r.GET("/api/auth/admin/users", requireAdmin(store, func(c *gin.Context) {
		users, err := store.ListUsers(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"items": users})
	}))

	r.POST("/api/auth/admin/users", requireAdmin(store, func(c *gin.Context) {
		var body struct {
			Username string `json:"username"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求体不合法"})
			return
		}
		user, err := store.CreateNormalUser(c.Request.Context(), body.Username)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"user": user, "defaultPassword": auth.DefaultUserPassword})
	}))

	r.PATCH("/api/auth/admin/users/:id/enabled", requireAdmin(store, func(c *gin.Context) {
		id, ok := parseIDParam(c)
		if !ok {
			return
		}
		var body struct {
			Enabled bool `json:"enabled"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求体不合法"})
			return
		}
		if err := store.SetUserDisabled(c.Request.Context(), id, !body.Enabled); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}))

	r.POST("/api/auth/admin/users/:id/reset-password", requireAdmin(store, func(c *gin.Context) {
		id, ok := parseIDParam(c)
		if !ok {
			return
		}
		if err := store.ResetUserPassword(c.Request.Context(), id); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"defaultPassword": auth.DefaultUserPassword})
	}))

	r.DELETE("/api/auth/admin/users/:id", requireAdmin(store, func(c *gin.Context) {
		id, ok := parseIDParam(c)
		if !ok {
			return
		}
		if err := store.DeleteUser(c.Request.Context(), id); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}))

	r.GET("/api/auth/admin/users/:id/scopes", requireAdmin(store, func(c *gin.Context) {
		id, ok := parseIDParam(c)
		if !ok {
			return
		}
		ids, err := store.ListUserScopeIDs(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"scopeIds": ids})
	}))

	r.PUT("/api/auth/admin/users/:id/scopes", requireAdmin(store, func(c *gin.Context) {
		id, ok := parseIDParam(c)
		if !ok {
			return
		}
		var body struct {
			ScopeIDs []string `json:"scopeIds"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求体不合法"})
			return
		}
		if err := store.SetUserScopeIDs(c.Request.Context(), id, body.ScopeIDs); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}))
}

func requireAdmin(_ *auth.Store, h gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		u, ok := currentUser(c)
		if !ok || u.Role != auth.RoleAdmin {
			c.JSON(http.StatusForbidden, gin.H{"error": "需要管理员权限", "code": "ADMIN_REQUIRED"})
			return
		}
		h(c)
	}
}

func parseIDParam(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "用户 ID 不合法"})
		return 0, false
	}
	return id, true
}

func filterClustersForUser(c *gin.Context, store *auth.Store, clusters []*cluster.Cluster) ([]*cluster.Cluster, error) {
	user, ok := currentUser(c)
	if !ok || user.Role == auth.RoleAdmin {
		return clusters, nil
	}
	combos, err := store.ListCombosForUser(c.Request.Context(), user)
	if err != nil {
		return nil, err
	}
	allowed := map[string]bool{}
	for _, combo := range combos {
		allowed[combo.ClusterID] = true
	}
	out := make([]*cluster.Cluster, 0, len(clusters))
	for _, item := range clusters {
		if allowed[item.ID] {
			out = append(out, item)
		}
	}
	return out, nil
}

func namespacesForUser(c *gin.Context, store *auth.Store, user auth.User, clusterID string) ([]corev1.Namespace, bool, error) {
	if user.Role == auth.RoleAdmin {
		return nil, false, nil
	}
	names, err := store.AuthorizedNamespacesForCluster(c.Request.Context(), user, clusterID)
	if err != nil {
		return nil, true, err
	}
	items := make([]corev1.Namespace, 0, len(names))
	for _, name := range names {
		items = append(items, corev1.Namespace{
			ObjectMeta: metav1.ObjectMeta{Name: name},
		})
	}
	return items, true, nil
}

func requireBatchConfigMapScopes(c *gin.Context, store *auth.Store, clusterID string, items []configMapBatchItem) bool {
	user, ok := currentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
		return false
	}
	if user.Role == auth.RoleAdmin {
		return true
	}
	for _, item := range items {
		ok, err := store.UserHasScope(c.Request.Context(), user, clusterID, item.Namespace)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return false
		}
		if !ok {
			c.JSON(http.StatusForbidden, gin.H{"error": "当前账号没有该作用域权限", "code": "SCOPE_FORBIDDEN"})
			return false
		}
	}
	return true
}

func errorStatus(err error) int {
	if errors.Is(err, sql.ErrNoRows) {
		return http.StatusNotFound
	}
	return http.StatusInternalServerError
}
