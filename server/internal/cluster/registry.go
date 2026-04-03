package cluster

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	weblensconfig "weblens/server/internal/config"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// Cluster represents a logical Kubernetes cluster (kubeconfig file + context).
type Cluster struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	FilePath          string `json:"filePath"`
	Context           string `json:"context"`
	DefaultNamespace  string `json:"defaultNamespace,omitempty"` // from kubeconfig context, for SA without cluster-scope list
	Kubeconfig        string `json:"-"`
}

// Registry stores all discovered clusters and their clients.
type Registry struct {
	mu        sync.RWMutex
	clusters  map[string]*Cluster
	clients   map[string]*kubernetes.Clientset
	restCfgs  map[string]*rest.Config
}

// NewRegistry creates an empty registry.
func NewRegistry() *Registry {
	return &Registry{
		clusters: make(map[string]*Cluster),
		clients:  make(map[string]*kubernetes.Clientset),
		restCfgs: make(map[string]*rest.Config),
	}
}

// LoadFromDir scans a directory for kubeconfig files and loads clusters.
func (r *Registry) LoadFromDir(dir string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.clusters = make(map[string]*Cluster)
	r.clients = make(map[string]*kubernetes.Clientset)
	r.restCfgs = make(map[string]*rest.Config)

	if strings.TrimSpace(dir) == "" {
		// 未配置目录：空注册表，由 UI 提示用户填写绝对路径；不作为错误阻断启动
		return nil
	}

	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}

		// simple filter on extension/name
		lower := strings.ToLower(d.Name())
		if !(strings.HasSuffix(lower, ".yaml") || strings.HasSuffix(lower, ".yml") || strings.HasPrefix(lower, "config")) {
			return nil
		}

		if loadErr := r.loadKubeconfigFile(path); loadErr != nil {
			log.Printf("cluster: skip kubeconfig %s: %v", path, loadErr)
			return nil // 单个文件失败不中断整次扫描
		}
		return nil
	})

	return err
}

func (r *Registry) loadKubeconfigFile(path string) error {
	config, err := clientcmd.LoadFromFile(path)
	if err != nil {
		return fmt.Errorf("load kubeconfig %s: %w", path, err)
	}

	// for each context treat as a separate logical cluster
	for ctxName := range config.Contexts {
		id := fmt.Sprintf("%s@%s", filepath.Base(path), ctxName)
		ctx := config.Contexts[ctxName]
		defaultNS := ""
		if ctx != nil && ctx.Namespace != "" {
			defaultNS = ctx.Namespace
		}
		if defaultNS == "" {
			defaultNS = weblensconfig.DefaultNamespace()
		}

		clientCfg := clientcmd.NewNonInteractiveClientConfig(*config, ctxName, &clientcmd.ConfigOverrides{}, nil)
		restCfg, err := clientCfg.ClientConfig()
		if err != nil {
			continue
		}

		clientset, err := kubernetes.NewForConfig(restCfg)
		if err != nil {
			continue
		}

		r.clusters[id] = &Cluster{
			ID:               id,
			Name:             ctxName,
			FilePath:         path,
			Context:          ctxName,
			DefaultNamespace: defaultNS,
		}
		r.clients[id] = clientset
		r.restCfgs[id] = restCfg
	}

	return nil
}

// List returns all known clusters.
func (r *Registry) List() []*Cluster {
	r.mu.RLock()
	defer r.mu.RUnlock()

	out := make([]*Cluster, 0, len(r.clusters))
	for _, c := range r.clusters {
		out = append(out, c)
	}
	return out
}

// Client returns a clientset for a given cluster ID.
func (r *Registry) Client(id string) (*kubernetes.Clientset, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	c, ok := r.clients[id]
	return c, ok
}

// Cluster returns cluster info for a given cluster ID.
func (r *Registry) Cluster(id string) (*Cluster, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	c, ok := r.clusters[id]
	return c, ok
}

// RestConfig returns rest.Config for a given cluster ID (for exec/port-forward etc).
func (r *Registry) RestConfig(id string) (*rest.Config, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	cfg, ok := r.restCfgs[id]
	return cfg, ok
}
