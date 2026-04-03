package httpapi

import (
	"bufio"
	"net/http"
	"strconv"
	"time"

	"weblens/server/internal/cluster"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/gin-gonic/gin"
)

// registerLogRoutes adds pod log endpoints.
func registerLogRoutes(r *gin.Engine, reg *cluster.Registry) {
	// Pod logs (supports follow)
	r.GET("/api/clusters/:id/pods/:namespace/:pod/logs", func(c *gin.Context) {
		id := c.Param("id")
		ns := c.Param("namespace")
		pod := c.Param("pod")
		container := c.Query("container")
		follow, _ := strconv.ParseBool(c.DefaultQuery("follow", "false"))
		previous, _ := strconv.ParseBool(c.DefaultQuery("previous", "false"))
		timestamps, _ := strconv.ParseBool(c.DefaultQuery("timestamps", "false"))
		tailLinesStr := c.Query("tailLines")
		sinceTimeStr := c.Query("sinceTime")

		var tailLines *int64
		if tailLinesStr != "" {
			if v, err := strconv.ParseInt(tailLinesStr, 10, 64); err == nil {
				tailLines = &v
			}
		}

		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}

		opts := &corev1.PodLogOptions{
			Container:  container,
			Follow:     follow,
			TailLines:  tailLines,
			Previous:   previous,
			Timestamps: timestamps,
		}

		if sinceTimeStr != "" {
			if parsed, err := time.Parse(time.RFC3339, sinceTimeStr); err == nil {
				opts.SinceTime = &metav1.Time{Time: parsed}
			}
		}

		req := client.CoreV1().Pods(ns).GetLogs(pod, opts)

		if !follow {
			data, err := req.DoRaw(c.Request.Context())
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.Data(http.StatusOK, "text/plain; charset=utf-8", data)
			return
		}

		// streaming follow
		stream, err := req.Stream(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer stream.Close()

		w := c.Writer
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Transfer-Encoding", "chunked")
		w.WriteHeader(http.StatusOK)

		flusher, ok := w.(http.Flusher)
		if !ok {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming not supported"})
			return
		}

		reader := bufio.NewReader(stream)
		for {
			line, err := reader.ReadBytes('\n')
			if len(line) > 0 {
				if _, writeErr := w.Write(line); writeErr != nil {
					return
				}
				flusher.Flush()
			}
			if err != nil {
				// EOF or context cancelled
				return
			}
		}
	})
}

