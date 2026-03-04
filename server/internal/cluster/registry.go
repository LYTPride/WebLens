package cluster

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
)

// Cluster represents a logical Kubernetes cluster (kubeconfig file + context).
type Cluster struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	FilePath   string `json:"filePath"`
	Context    string `json:"context"`
	Kubeconfig string `json:"-"`
}

// Registry stores all discovered clusters and their clients.
type Registry struct {
	mu       sync.RWMutex
	clusters map[string]*Cluster
	clients  map[string]*kubernetes.Clientset
}

// NewRegistry creates an empty registry.
func NewRegistry() *Registry {
	return &Registry{
		clusters: make(map[string]*Cluster),
		clients:  make(map[string]*kubernetes.Clientset),
	}
}

// LoadFromDir scans a directory for kubeconfig files and loads clusters.
func (r *Registry) LoadFromDir(dir string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.clusters = make(map[string]*Cluster)
	r.clients = make(map[string]*kubernetes.Clientset)

	if dir == "" {
		return fmt.Errorf("kubeconfig directory is empty")
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

		return r.loadKubeconfigFile(path)
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
			ID:       id,
			Name:     ctxName,
			FilePath: path,
			Context:  ctxName,
		}
		r.clients[id] = clientset
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
