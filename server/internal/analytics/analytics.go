package analytics

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var (
	mu      sync.Mutex
	logPath string
)

func init() {
	logPath = os.Getenv("WEBLENS_ANALYTICS_LOG")
	if logPath == "" {
		logPath = "logs/analytics.log"
	}
}

// AppendLine writes one JSON object per line (ndjson) for v1 usage analytics.
func AppendLine(fields map[string]any) {
	if fields == nil {
		fields = map[string]any{}
	}
	fields["ts"] = time.Now().UTC().Format(time.RFC3339Nano)
	b, err := json.Marshal(fields)
	if err != nil {
		return
	}
	line := append(b, '\n')

	mu.Lock()
	defer mu.Unlock()
	dir := filepath.Dir(logPath)
	if dir != "" && dir != "." {
		_ = os.MkdirAll(dir, 0o755)
	}
	f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	_, _ = f.Write(line)
	_ = f.Close()
}
