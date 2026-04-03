package httpapi

import (
	"net/http"

	"weblens/server/internal/analytics"

	"github.com/gin-gonic/gin"
)

func registerAnalyticsRoutes(r *gin.Engine) {
	// v1 轻量埋点：单行 JSON 写入 analytics 日志，失败不影响主流程
	r.POST("/api/analytics/events", func(c *gin.Context) {
		var body map[string]any
		if err := c.ShouldBindJSON(&body); err != nil {
			c.Status(http.StatusNoContent)
			return
		}
		analytics.AppendLine(body)
		c.Status(http.StatusNoContent)
	})
}
