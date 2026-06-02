package cluster

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIsKubeconfigCandidateName(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		{name: "train-uat", want: true},
		{name: "ncmd-sit", want: true},
		{name: "kubernetes-admin-abc123", want: true},
		{name: "xxxxx.config", want: true},
		{name: "train-uat.config", want: true},
		{name: "cluster.yaml", want: true},
		{name: "cluster.yml", want: true},
		{name: ".DS_Store", want: false},
		{name: ".config", want: false},
		{name: "cluster.tmp", want: false},
		{name: "cluster.bak", want: false},
		{name: "cluster.swp", want: false},
		{name: "cluster.old", want: false},
		{name: "cluster~", want: false},
		{name: "notes.txt", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isKubeconfigCandidateName(tt.name); got != tt.want {
				t.Fatalf("isKubeconfigCandidateName(%q) = %v, want %v", tt.name, got, tt.want)
			}
		})
	}
}

func TestLoadFromDirSupportsConfigSuffixAndSkipsNonCandidates(t *testing.T) {
	dir := t.TempDir()
	validKubeconfig := []byte(`
apiVersion: v1
kind: Config
clusters:
- name: local
  cluster:
    server: https://127.0.0.1:6443
contexts:
- name: local
  context:
    cluster: local
    user: local
current-context: local
users:
- name: local
  user:
    token: test
`)

	files := map[string][]byte{
		"train-uat":         validKubeconfig,
		"train-uat.config":  validKubeconfig,
		"cluster.yaml":      validKubeconfig,
		".DS_Store":         validKubeconfig,
		"hidden.config.tmp": validKubeconfig,
		"backup.config.bak": validKubeconfig,
		"notes.txt":         validKubeconfig,
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), content, 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	if err := os.Mkdir(filepath.Join(dir, "dir.config"), 0o755); err != nil {
		t.Fatalf("mkdir dir.config: %v", err)
	}

	reg := NewRegistry()
	if err := reg.LoadFromDir(dir); err != nil {
		t.Fatalf("LoadFromDir: %v", err)
	}

	loaded := map[string]bool{}
	for _, c := range reg.List() {
		loaded[filepath.Base(c.FilePath)] = true
	}

	for _, name := range []string{"train-uat", "train-uat.config", "cluster.yaml"} {
		if !loaded[name] {
			t.Fatalf("expected %s to be loaded; loaded=%v", name, loaded)
		}
	}
	for _, name := range []string{".DS_Store", "hidden.config.tmp", "backup.config.bak", "notes.txt", "dir.config"} {
		if loaded[name] {
			t.Fatalf("expected %s to be skipped; loaded=%v", name, loaded)
		}
	}
}
