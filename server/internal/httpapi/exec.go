package httpapi

import (
	"io"
	"net/http"

	"weblens/server/internal/cluster"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// registerExecRoutes adds Pod exec WebSocket endpoint.
func registerExecRoutes(r *gin.Engine, reg *cluster.Registry) {
	r.GET("/api/clusters/:id/pods/:namespace/:pod/exec", func(c *gin.Context) {
		id := c.Param("id")
		ns := c.Param("namespace")
		podName := c.Param("pod")
		container := c.Query("container")

		restCfg, ok := reg.RestConfig(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		client, ok := reg.Client(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}

		req := client.CoreV1().RESTClient().Post().
			Resource("pods").Namespace(ns).Name(podName).SubResource("exec")
		opts := &corev1.PodExecOptions{
			Container: container,
			Command:   []string{"/bin/sh"},
			Stdin:     true,
			Stdout:    true,
			Stderr:    true,
			TTY:       true,
		}
		req.VersionedParams(opts, scheme.ParameterCodec)

		exec, err := remotecommand.NewSPDYExecutor(restCfg, "POST", req.URL())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		pipeR, pipeW := io.Pipe()
		defer pipeW.Close()

		go func() {
			defer pipeR.Close()
			_ = exec.StreamWithContext(c.Request.Context(), remotecommand.StreamOptions{
				Stdin:  pipeR,
				Stdout: &wsWriter{conn: conn},
				Stderr: &wsWriter{conn: conn},
				Tty:    true,
			})
		}()

		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				break
			}
			if _, err := pipeW.Write(data); err != nil {
				break
			}
		}
	})
}

type wsWriter struct{ conn *websocket.Conn }

func (w *wsWriter) Write(p []byte) (n int, err error) {
	err = w.conn.WriteMessage(websocket.BinaryMessage, p)
	if err != nil {
		return 0, err
	}
	return len(p), nil
}
