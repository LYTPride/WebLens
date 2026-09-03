package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"weblens/server/internal/auth"
	"weblens/server/internal/cluster"
	"weblens/server/internal/config"
	"weblens/server/internal/httpapi"
)

func main() {
	config.Load()

	if len(os.Args) > 1 {
		runCommand(os.Args[1])
		return
	}

	store, err := auth.OpenDefault()
	if err != nil {
		log.Fatalf("open auth database: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	initialized, err := store.IsInitialized(ctx)
	if err != nil {
		log.Fatalf("check auth database: %v", err)
	}
	if !initialized {
		log.Fatalf("WebLens is not initialized. Please run scripts/init.sh first.")
	}
	if err := store.MigrateLegacyConfig(ctx); err != nil {
		log.Fatalf("migrate legacy config: %v", err)
	}
	if dir, err := store.GetConfig(ctx, "kubeconfig_dir"); err != nil {
		log.Fatalf("load kubeconfig dir: %v", err)
	} else if dir != "" {
		config.SetKubeconfigDirRuntime(dir)
	}

	reg := cluster.NewRegistry()
	if err := reg.LoadFromDir(config.KubeconfigDir()); err != nil {
		log.Printf("failed to load kubeconfigs: %v", err)
	}

	router := httpapi.NewRouter(reg, store)

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

func runCommand(cmd string) {
	ctx := context.Background()
	store, err := auth.OpenDefault()
	if err != nil {
		fmt.Fprintf(os.Stderr, "open auth database: %v\n", err)
		os.Exit(2)
	}
	defer store.Close()

	switch cmd {
	case "is-initialized":
		ok, err := store.IsInitialized(ctx)
		if err != nil {
			fmt.Fprintf(os.Stderr, "check auth database: %v\n", err)
			os.Exit(2)
		}
		if !ok {
			os.Exit(1)
		}
	case "init-admin":
		passwordBytes, err := io.ReadAll(io.LimitReader(os.Stdin, 4096))
		if err != nil {
			fmt.Fprintf(os.Stderr, "read password: %v\n", err)
			os.Exit(2)
		}
		password := strings.TrimRight(string(passwordBytes), "\r\n")
		if err := store.BootstrapAdmin(ctx, password); err != nil {
			if errors.Is(err, auth.ErrAlreadyInitialized) {
				fmt.Fprintln(os.Stderr, "WebLens has already been initialized.")
				os.Exit(1)
			}
			fmt.Fprintf(os.Stderr, "initialize admin: %v\n", err)
			os.Exit(2)
		}
		fmt.Println("WebLens admin user initialized.")
	case "reset-admin-password":
		passwordBytes, err := io.ReadAll(io.LimitReader(os.Stdin, 4096))
		if err != nil {
			fmt.Fprintf(os.Stderr, "read temporary password: %v\n", err)
			os.Exit(2)
		}
		password := strings.TrimRight(string(passwordBytes), "\r\n")
		revokedSessions, err := store.ResetRootPassword(ctx, password)
		if err != nil {
			fmt.Fprintf(os.Stderr, "reset admin password: %v\n", err)
			os.Exit(2)
		}
		fmt.Println("WebLens admin password was reset successfully.")
		fmt.Printf("%d existing admin sessions were revoked.\n", revokedSessions)
		fmt.Println("The next admin login must change this temporary password.")
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", cmd)
		os.Exit(2)
	}
}
