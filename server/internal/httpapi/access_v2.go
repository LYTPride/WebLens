package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"weblens/server/internal/auth"

	"github.com/gin-gonic/gin"
)

func registerAccessV2Routes(r *gin.Engine, store *auth.Store) {
	r.GET("/api/auth/admin/scope-groups", requireAdmin(store, func(c *gin.Context) {
		items, err := store.ListScopeGroups(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"items": items})
	}))

	r.POST("/api/auth/admin/scope-groups", requireAdmin(store, func(c *gin.Context) {
		var body struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求体不合法"})
			return
		}
		item, err := store.CreateScopeGroup(c.Request.Context(), body.Name, body.Description)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, item)
	}))

	r.PATCH("/api/auth/admin/scope-groups/:id", requireAdmin(store, func(c *gin.Context) {
		id, ok := parseIDParam(c)
		if !ok {
			return
		}
		var body struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			SortOrder   int    `json:"sortOrder"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求体不合法"})
			return
		}
		if err := store.UpdateScopeGroup(c.Request.Context(), id, body.Name, body.Description, body.SortOrder); err != nil {
			status := errorStatus(err)
			if status == http.StatusInternalServerError {
				status = http.StatusBadRequest
			}
			c.JSON(status, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}))

	r.DELETE("/api/auth/admin/scope-groups/:id", requireAdmin(store, func(c *gin.Context) {
		id, ok := parseIDParam(c)
		if !ok {
			return
		}
		if err := store.DeleteScopeGroup(c.Request.Context(), id); err != nil {
			status := errorStatus(err)
			if status == http.StatusInternalServerError {
				status = http.StatusBadRequest
			}
			c.JSON(status, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}))

	r.PUT("/api/auth/admin/scope-groups/:id/scopes", requireAdmin(store, func(c *gin.Context) {
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
		if err := store.SetScopeGroupScopeIDs(c.Request.Context(), id, body.ScopeIDs); err != nil {
			status := errorStatus(err)
			if status == http.StatusInternalServerError {
				status = http.StatusBadRequest
			}
			c.JSON(status, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}))

	r.GET("/api/auth/admin/users/:id/grants", requireAdmin(store, func(c *gin.Context) {
		id, ok := parseIDParam(c)
		if !ok {
			return
		}
		grants, err := store.ListUserGrants(c.Request.Context(), id)
		if err != nil {
			status := errorStatus(err)
			if status == http.StatusInternalServerError {
				status = http.StatusBadRequest
			}
			c.JSON(status, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, grants)
	}))

	r.PUT("/api/auth/admin/users/:id/grants", requireAdmin(store, func(c *gin.Context) {
		id, ok := parseIDParam(c)
		if !ok {
			return
		}
		target, err := store.UserByID(c.Request.Context(), id)
		if err != nil {
			writeUserManagementError(c, err)
			return
		}
		setUserAuditTarget(c, target.User, "update-grants")
		var body auth.UserGrants
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求体不合法"})
			return
		}
		if err := store.SetUserGrants(c.Request.Context(), id, body); err != nil {
			status := errorStatus(err)
			if status == http.StatusInternalServerError {
				status = http.StatusBadRequest
			}
			c.JSON(status, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}))

	r.GET("/api/auth/admin/audit-logs", requireAdmin(store, func(c *gin.Context) {
		var filter auth.AuditFilter
		if raw := strings.TrimSpace(c.Query("userId")); raw != "" {
			id, err := strconv.ParseInt(raw, 10, 64)
			if err != nil || id <= 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "userId 不合法"})
				return
			}
			filter.UserID = id
		}
		filter.Action = strings.TrimSpace(c.Query("action"))
		filter.Result = strings.TrimSpace(c.Query("result"))
		if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
			value, err := strconv.Atoi(raw)
			if err != nil || value <= 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "limit 不合法"})
				return
			}
			filter.Limit = value
		}
		items, err := store.ListAuditLogs(c.Request.Context(), filter)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"items": items})
	}))
}
