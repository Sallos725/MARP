package main

import (
	"context"
	"github.com/Sallos725/MARP/full/internal/marp"
	"github.com/joho/godotenv"
	"log"
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
	path := env("CONFIG_PATH", "data/config.json")
	store, err := marp.OpenStore(path, env("PRESET_PATH", filepath.Join(filepath.Dir(path), "presets.json")))
	if err != nil {
		log.Fatal(err)
	}
	engine := marp.NewEngine(store)
	defer engine.Close()
	api := &marp.Server{Store: store, Analyze: engine.Analyze, TestLLM: engine.TestLLM}
	srv := &http.Server{Addr: env("HOST", "0.0.0.0") + ":" + env("PORT", "6009"), Handler: api.Handler(), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(c)
	}()
	log.Printf("MARP %s listening on %s", marp.Version, srv.Addr)
	if err = srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
