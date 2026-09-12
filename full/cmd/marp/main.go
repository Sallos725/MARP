package main

import (
	"context"
	"fmt"
	"github.com/Sallos725/MARP/full/internal/marp"
	"github.com/joho/godotenv"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
func main() {
	_ = godotenv.Load()
	if len(os.Args) > 1 {
		if os.Args[1] == "--version" {
			fmt.Println(marp.Version)
			return
		}
		if os.Args[1] == "--healthcheck" {
			client := http.Client{Timeout: 3 * time.Second}
			res, err := client.Get("http://127.0.0.1:" + env("PORT", "6009") + "/health")
			if err != nil {
				os.Exit(1)
			}
			res.Body.Close()
			if res.StatusCode != 200 {
				os.Exit(1)
			}
			return
		}
	}
	path := env("CONFIG_PATH", "data/config.json")
	store, err := marp.OpenStore(path, env("PRESET_PATH", filepath.Join(filepath.Dir(path), "presets.json")))
	if err != nil {
		log.Fatal(err)
	}
	engine := marp.NewEngine(store)
	defer engine.Close()
	api := &marp.Server{Store: store, Analyze: engine.Analyze, TestLLM: engine.TestLLM}
	srv := &http.Server{Addr: net.JoinHostPort(env("HOST", "0.0.0.0"), env("PORT", "6009")), Handler: api.Handler(), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		<-ctx.Done()
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if srv.Shutdown(c) != nil {
			_ = srv.Close()
		}
	}()
	log.Printf("MARP %s listening on %s", marp.Version, srv.Addr)
	if err = srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
	<-stopped
}
