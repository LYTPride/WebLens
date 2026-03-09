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
		// 优先进入 bash 交互 shell：设置 TERM 与 PS1，兼容方向键/历史命令（若容器内存在 bash）
		// 若无 bash，则退回到 /bin/sh -i，同样设置 TERM 与 PS1。
		opts := &corev1.PodExecOptions{
			Container: container,
			Command: []string{
				"/bin/sh", "-c",
				"if command -v bash >/dev/null 2>&1; then " +
					"export TERM=xterm-256color; " +
					"export PS1='root@$(hostname 2>/dev/null || true):\\w# '; " +
					"exec bash -li; " +
				"else " +
					"export TERM=xterm-256color; " +
					"export PS1='root@$(hostname 2>/dev/null || true):\\w# '; " +
					"exec /bin/sh -i; " +
				"fi",
			},
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
