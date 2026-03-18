package httpapi

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"weblens/server/internal/cluster"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"

	"github.com/gin-gonic/gin"
)

type fileEntry struct {
	Name string `json:"name"`
	Type string `json:"type"` // "file" | "dir"
	Size int64  `json:"size"` // -1 表示未知；dir 通常为 -1
}

type listFilesResponse struct {
	Path  string      `json:"path"`
	Items []fileEntry `json:"items"`
}

func registerFileRoutes(r *gin.Engine, reg *cluster.Registry) {
	// List directory
	r.GET("/api/clusters/:id/pods/:namespace/:pod/files", func(c *gin.Context) {
		id, ns, podName := c.Param("id"), c.Param("namespace"), c.Param("pod")
		container := c.Query("container")
		p := c.DefaultQuery("path", "/")

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

		// 通过 /bin/sh 执行 list：使用 ls -1Ap 区分目录（带 /），并尽力获取文件 size（stat 或 wc -c）
		// 输出格式：name<TAB>type<TAB>size
		safePath := strings.ReplaceAll(p, `'`, `'\''`)
		cmd := fmt.Sprintf(
			`DIR='%s'; `+
				`cd "$DIR" 2>/dev/null || { echo "__ERR__\tfile\t-1"; exit 2; }; `+
				`ls -1Ap 2>/dev/null | while IFS= read -r n; do `+
				`[ -z "$n" ] && continue; `+
				`case "$n" in "."|".." ) continue;; esac; `+
				`if [ "${n#*\/}" != "$n" ]; then `+ // endswith /
				`echo "${n%%/}\tdir\t-1"; `+
				`else `+
				`sz=$( (stat -c %%s "$n" 2>/dev/null) || (wc -c < "$n" 2>/dev/null) || echo -1 ); `+
				`echo "$n\tfile\t$sz"; `+
				`fi; `+
				`done`,
			safePath,
		)

		stdout, stderr, err := execInPodCapture(
			c.Request.Context(),
			restCfg,
			client,
			ns,
			podName,
			container,
			[]string{"/bin/sh", "-c", cmd},
			5*time.Second,
		)
		if err != nil {
			msg := strings.TrimSpace(stderr)
			if msg == "" {
				msg = err.Error()
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": msg})
			return
		}
		items := parseFileEntries(stdout)
		c.JSON(http.StatusOK, &listFilesResponse{Path: p, Items: items})
	})

	// Mkdir
	r.POST("/api/clusters/:id/pods/:namespace/:pod/files/mkdir", func(c *gin.Context) {
		id, ns, podName := c.Param("id"), c.Param("namespace"), c.Param("pod")
		container := c.Query("container")
		var body struct {
			Path string `json:"path"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Path) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 path"})
			return
		}

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

		p := strings.ReplaceAll(body.Path, `'`, `'\''`)
		_, stderr, err := execInPodCapture(
			c.Request.Context(),
			restCfg,
			client,
			ns,
			podName,
			container,
			[]string{"/bin/sh", "-c", fmt.Sprintf(`mkdir -p '%s'`, p)},
			10*time.Second,
		)
		if err != nil {
			msg := strings.TrimSpace(stderr)
			if msg == "" {
				msg = err.Error()
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": msg})
			return
		}
		c.Status(http.StatusOK)
	})

	// Rename
	r.POST("/api/clusters/:id/pods/:namespace/:pod/files/rename", func(c *gin.Context) {
		id, ns, podName := c.Param("id"), c.Param("namespace"), c.Param("pod")
		container := c.Query("container")
		var body struct {
			From string `json:"from"`
			To   string `json:"to"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.From) == "" || strings.TrimSpace(body.To) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 from/to"})
			return
		}

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

		from := strings.ReplaceAll(body.From, `'`, `'\''`)
		to := strings.ReplaceAll(body.To, `'`, `'\''`)
		_, stderr, err := execInPodCapture(
			c.Request.Context(),
			restCfg,
			client,
			ns,
			podName,
			container,
			[]string{"/bin/sh", "-c", fmt.Sprintf(`mv '%s' '%s'`, from, to)},
			10*time.Second,
		)
		if err != nil {
			msg := strings.TrimSpace(stderr)
			if msg == "" {
				msg = err.Error()
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": msg})
			return
		}
		c.Status(http.StatusOK)
	})

	// Delete
	r.POST("/api/clusters/:id/pods/:namespace/:pod/files/delete", func(c *gin.Context) {
		id, ns, podName := c.Param("id"), c.Param("namespace"), c.Param("pod")
		container := c.Query("container")
		var body struct {
			Paths []string `json:"paths"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || len(body.Paths) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 paths"})
			return
		}

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

		var quoted []string
		for _, p := range body.Paths {
			if strings.TrimSpace(p) == "" {
				continue
			}
			quoted = append(quoted, fmt.Sprintf("'%s'", strings.ReplaceAll(p, `'`, `'\''`)))
		}
		if len(quoted) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "paths 为空"})
			return
		}

		_, stderr, err := execInPodCapture(
			c.Request.Context(),
			restCfg,
			client,
			ns,
			podName,
			container,
			[]string{"/bin/sh", "-c", "rm -rf -- " + strings.Join(quoted, " ")},
			30*time.Second,
		)
		if err != nil {
			msg := strings.TrimSpace(stderr)
			if msg == "" {
				msg = err.Error()
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": msg})
			return
		}
		c.Status(http.StatusOK)
	})

	// Download (as tar)
	r.GET("/api/clusters/:id/pods/:namespace/:pod/files/download", func(c *gin.Context) {
		id, ns, podName := c.Param("id"), c.Param("namespace"), c.Param("pod")
		container := c.Query("container")
		paths := c.QueryArray("path")
		if len(paths) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 path"})
			return
		}

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

		// tar -cf - 支持多次 -C，因此我们把每个绝对路径拆成（dir, base）
		// 第一版：要求容器内有 tar；否则返回明确错误。
		var parts []string
		parts = append(parts, "tar", "-cf", "-")
		for _, p := range paths {
			if strings.TrimSpace(p) == "" {
				continue
			}
			clean := path.Clean(p)
			if !strings.HasPrefix(clean, "/") {
				clean = "/" + clean
			}
			dir := path.Dir(clean)
			base := path.Base(clean)
			parts = append(parts, "-C", dir, base)
		}
		if len(parts) <= 3 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "path 为空"})
			return
		}

		c.Writer.Header().Set("Content-Type", "application/x-tar")
		c.Writer.Header().Set("Content-Disposition", `attachment; filename="weblens-files.tar"`)
		c.Writer.WriteHeader(http.StatusOK)

		stderr, err := execInPodStreamStdout(
			c.Request.Context(),
			restCfg,
			client,
			ns,
			podName,
			container,
			parts,
			c.Writer,
			2*time.Minute,
		)
		if err != nil {
			// 这里 Header 已写出，无法再返回 JSON；仅记录 stderr 并终止连接
			_ = stderr
			return
		}
	})

	// Upload (multipart): form fields: path, file
	r.POST("/api/clusters/:id/pods/:namespace/:pod/files/upload", func(c *gin.Context) {
		id, ns, podName := c.Param("id"), c.Param("namespace"), c.Param("pod")
		container := c.Query("container")
		dstPath := strings.TrimSpace(c.PostForm("path"))
		if dstPath == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 path"})
			return
		}

		fh, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 file"})
			return
		}

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

		file, err := fh.Open()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		defer file.Close()

		p := strings.ReplaceAll(dstPath, `'`, `'\''`)
		// 通过 cat 重定向写入文件；第一版不做权限/原子替换。
		cmd := []string{"/bin/sh", "-c", fmt.Sprintf(`cat > '%s'`, p)}
		stderr, err := execInPodStreamStdin(
			c.Request.Context(),
			restCfg,
			client,
			ns,
			podName,
			container,
			cmd,
			file,
			2*time.Minute,
		)
		if err != nil {
			msg := strings.TrimSpace(stderr)
			if msg == "" {
				msg = err.Error()
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": msg})
			return
		}
		c.Status(http.StatusOK)
	})
}

func parseFileEntries(out string) []fileEntry {
	lines := strings.Split(out, "\n")
	items := make([]fileEntry, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) < 3 {
			continue
		}
		name := parts[0]
		typ := parts[1]
		sizeStr := parts[2]
		var size int64 = -1
		if v, err := parseInt64(sizeStr); err == nil {
			size = v
		}
		if typ != "dir" && typ != "file" {
			continue
		}
		items = append(items, fileEntry{Name: name, Type: typ, Size: size})
	}
	return items
}

func parseInt64(s string) (int64, error) {
	var neg bool
	if strings.HasPrefix(s, "-") {
		neg = true
		s = strings.TrimPrefix(s, "-")
	}
	var n int64
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if ch < '0' || ch > '9' {
			return 0, fmt.Errorf("invalid int")
		}
		n = n*10 + int64(ch-'0')
	}
	if neg {
		n = -n
	}
	return n, nil
}

func execInPodCapture(
	ctx context.Context,
	restCfg *rest.Config,
	client kubernetes.Interface,
	ns, podName, container string,
	command []string,
	timeout time.Duration,
) (stdout string, stderr string, err error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req := client.CoreV1().RESTClient().Post().
		Resource("pods").Namespace(ns).Name(podName).SubResource("exec")
	opts := &corev1.PodExecOptions{
		Container: container,
		Command:   command,
		Stdin:     false,
		Stdout:    true,
		Stderr:    true,
		TTY:       false,
	}
	req.VersionedParams(opts, scheme.ParameterCodec)

	exec, err := remotecommand.NewSPDYExecutor(restCfg, "POST", req.URL())
	if err != nil {
		return "", "", err
	}

	var outBuf, errBuf bytes.Buffer
	err = exec.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdout: &outBuf,
		Stderr: &errBuf,
		Tty:    false,
	})
	return outBuf.String(), errBuf.String(), err
}

func execInPodStreamStdout(
	ctx context.Context,
	restCfg *rest.Config,
	client kubernetes.Interface,
	ns, podName, container string,
	command []string,
	stdout io.Writer,
	timeout time.Duration,
) (stderr string, err error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req := client.CoreV1().RESTClient().Post().
		Resource("pods").Namespace(ns).Name(podName).SubResource("exec")
	opts := &corev1.PodExecOptions{
		Container: container,
		Command:   command,
		Stdin:     false,
		Stdout:    true,
		Stderr:    true,
		TTY:       false,
	}
	req.VersionedParams(opts, scheme.ParameterCodec)

	exec, err := remotecommand.NewSPDYExecutor(restCfg, "POST", req.URL())
	if err != nil {
		return "", err
	}

	var errBuf bytes.Buffer
	err = exec.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdout: stdout,
		Stderr: &errBuf,
		Tty:    false,
	})
	return errBuf.String(), err
}

func execInPodStreamStdin(
	ctx context.Context,
	restCfg *rest.Config,
	client kubernetes.Interface,
	ns, podName, container string,
	command []string,
	stdin io.Reader,
	timeout time.Duration,
) (stderr string, err error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req := client.CoreV1().RESTClient().Post().
		Resource("pods").Namespace(ns).Name(podName).SubResource("exec")
	opts := &corev1.PodExecOptions{
		Container: container,
		Command:   command,
		Stdin:     true,
		Stdout:    false,
		Stderr:    true,
		TTY:       false,
	}
	req.VersionedParams(opts, scheme.ParameterCodec)

	exec, err := remotecommand.NewSPDYExecutor(restCfg, "POST", req.URL())
	if err != nil {
		return "", err
	}

	var errBuf bytes.Buffer
	err = exec.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdin:  stdin,
		Stderr: &errBuf,
		Tty:    false,
	})
	return errBuf.String(), err
}

