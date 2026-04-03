package main

import (
	"log"
	"net/http"
	"time"

	"weblens/server/internal/cluster"
	"weblens/server/internal/config"
	"weblens/server/internal/httpapi"
)

func main() {
	config.Load()

	reg := cluster.NewRegistry()
	if err := reg.LoadFromDir(config.KubeconfigDir()); err != nil {
		log.Printf("failed to load kubeconfigs: %v", err)
	}

	router := httpapi.NewRouter(reg)

	srv := &http.Server{
		Addr:              config.HTTPAddr(),
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("WebLens server listening on %s", config.HTTPAddr())

	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}
