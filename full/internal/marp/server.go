package marp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type AnalyzeRequest struct {
	UserInput        string    `json:"user_input"`
	ChatHistory      []Message `json:"chat_history"`
	SystemContext    string    `json:"system_context"`
	WorldSummary     string    `json:"world_summary"`
	CharSummary      string    `json:"char_summary"`
	ContextWindow    *int      `json:"context_window,omitempty"`
	AnalysisLanguage string    `json:"analysis_language"`
}
type AnalyzeResponse struct {
	World       string            `json:"context_world"`
	Plot        string            `json:"context_plot"`
	Character   string            `json:"context_char"`
	Errors      map[string]string `json:"errors"`
	Latency     map[string]int64  `json:"latency_ms"`
	Diagnostics map[string]any    `json:"diagnostics,omitempty"`
}
type Server struct {
	Store   *Store
	Analyze func(context.Context, AnalyzeRequest) (AnalyzeResponse, error)
	TestLLM func(context.Context, string) (any, error)
}

func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, detail any) {
	respond(w, status, map[string]any{"detail": detail})
}
func readBody(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	defer r.Body.Close()
	d := json.NewDecoder(r.Body)
	if err := d.Decode(v); err != nil {
		fail(w, 422, []any{map[string]any{"loc": []string{"body"}, "msg": err.Error(), "type": "json_invalid"}})
		return false
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		fail(w, 422, "Expected one JSON value")
		return false
	}
	return true
}
func validateConfig(raw Config) error {
	defaults := Defaults()
	for k, v := range raw {
		def, ok := defaults[k]
		if !ok {
			continue
		}
		switch def.(type) {
		case string:
			if _, ok := v.(string); !ok {
				return fmt.Errorf("%s must be a string", k)
			}
		case bool:
			if _, ok := v.(bool); !ok {
				return fmt.Errorf("%s must be boolean", k)
			}
		case float64:
			if _, ok := v.(float64); !ok {
				return fmt.Errorf("%s must be numeric", k)
			}
		}
	}
	for _, k := range []string{"context_window", "request_timeout", "analysis_timeout", "max_concurrent_analyses"} {
		if v, ok := raw[k]; ok && number(v, 0) <= 0 {
			return fmt.Errorf("%s must be positive", k)
		}
	}
	for k, v := range raw {
		if strings.HasSuffix(k, "pdf_mode") {
			switch v {
			case "", "off", "quality", "standard", "max":
			default:
				return fmt.Errorf("invalid %s", k)
			}
		}
	}
	return nil
}
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /config", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, s.Store.Snapshot()) })
	mux.HandleFunc("PUT /config", func(w http.ResponseWriter, r *http.Request) {
		var c Config
		if !readBody(w, r, &c) {
			return
		}
		if err := validateConfig(c); err != nil {
			fail(w, 422, []any{map[string]any{"loc": []string{"body"}, "msg": err.Error(), "type": "value_error"}})
			return
		}
		if err := s.Store.Save(c); err != nil {
			fail(w, 500, err.Error())
			return
		}
		respond(w, 200, s.Store.Snapshot())
	})
	mux.HandleFunc("GET /runtime-config", func(w http.ResponseWriter, r *http.Request) {
		c := s.Store.Snapshot()
		respond(w, 200, Config{"context_window": c["context_window"], "request_timeout": c["request_timeout"], "analysis_timeout": c["analysis_timeout"], "revision": revision(c)})
	})
	mux.HandleFunc("GET /status", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, status(s.Store.Snapshot())) })
	mux.HandleFunc("GET /prompts/defaults", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, legacy["/prompts/defaults"]) })
	mux.HandleFunc("GET /presets", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, s.Store.Presets(false)) })
	mux.HandleFunc("GET /presets/{id}", func(w http.ResponseWriter, r *http.Request) {
		for _, p := range s.Store.Presets(true).Presets {
			if p.ID == r.PathValue("id") {
				respond(w, 200, p)
				return
			}
		}
		fail(w, 404, "프리셋을 찾을 수 없습니다.")
	})
	mux.HandleFunc("POST /presets", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			ID   string         `json:"id"`
			Name *string        `json:"name"`
			Pack map[string]any `json:"pack"`
		}
		if !readBody(w, r, &b) {
			return
		}
		if b.Name == nil {
			fail(w, 422, []any{map[string]any{"loc": []string{"body", "name"}, "msg": "Field required", "type": "missing"}})
			return
		}
		if b.Pack == nil {
			b.Pack = map[string]any{}
		}
		if _, err := s.Store.SavePreset(b.ID, *b.Name, b.Pack); err != nil {
			fail(w, 500, err.Error())
			return
		}
		respond(w, 200, s.Store.Presets(false))
	})
	mux.HandleFunc("DELETE /presets/{id}", func(w http.ResponseWriter, r *http.Request) {
		ok, err := s.Store.DeletePreset(r.PathValue("id"))
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		if !ok {
			fail(w, 404, "프리셋을 찾을 수 없습니다.")
			return
		}
		respond(w, 200, s.Store.Presets(false))
	})
	mux.HandleFunc("POST /analyze", func(w http.ResponseWriter, r *http.Request) {
		var raw map[string]json.RawMessage
		if !readBody(w, r, &raw) {
			return
		}
		if _, ok := raw["user_input"]; !ok {
			fail(w, 422, []any{map[string]any{"loc": []string{"body", "user_input"}, "msg": "Field required", "type": "missing"}})
			return
		}
		b, _ := json.Marshal(raw)
		var req AnalyzeRequest
		if err := json.Unmarshal(b, &req); err != nil {
			fail(w, 422, err.Error())
			return
		}
		if s.Analyze == nil {
			fail(w, 503, "Analysis engine not initialized")
			return
		}
		out, err := s.Analyze(r.Context(), req)
		if err != nil {
			fail(w, 503, err.Error())
			return
		}
		respond(w, 200, out)
	})
	mux.HandleFunc("GET /test/llm", func(w http.ResponseWriter, r *http.Request) {
		if s.TestLLM == nil {
			fail(w, 503, "Analysis engine not initialized")
			return
		}
		a := r.URL.Query().Get("agent")
		if a != "" {
			if _, ok := Labels[a]; !ok {
				fail(w, 404, "알 수 없는 에이전트: "+a)
				return
			}
			if !enabled(s.Store.Snapshot(), a+"_enabled") {
				fail(w, 400, "비활성화된 에이전트: "+a)
				return
			}
		}
		out, err := s.TestLLM(r.Context(), a)
		if err != nil {
			fail(w, 502, err.Error())
			return
		}
		respond(w, 200, out)
	})
	mux.HandleFunc("GET /openapi.json", func(w http.ResponseWriter, r *http.Request) {
		doc := clone(legacy["/openapi.json"].(map[string]any))
		doc["info"].(map[string]any)["version"] = Version
		respond(w, 200, doc)
	})
	mux.HandleFunc("GET /docs", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, `<!doctype html><title>MARP API</title><div id="swagger-ui"></div><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui'})</script>`)
	})
	mux.HandleFunc("GET /redoc", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/docs", 307) })
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		if r.Method == "OPTIONS" {
			w.WriteHeader(200)
			return
		}
		mux.ServeHTTP(w, r)
	})
}
func status(c Config) Config {
	public := Config{}
	for _, k := range []string{"pipeline_mode", "default_provider", "default_base_url", "default_model", "default_temperature", "default_max_tokens", "context_window", "debug_mode", "request_timeout", "strict_mode", "injection_position", "injection_format", "analysis_language", "default_pdf_mode", "analysis_timeout"} {
		public[k] = c[k]
	}
	public["default_api_key_set"] = str(c["default_api_key"]) != ""
	public["default_extra_body_json_set"] = str(c["default_extra_body_json"]) != ""
	agents := []Config{}
	ready := true
	for _, n := range AgentNames {
		a := agentConfig(c, n)
		item := Config{"name": n, "label": Labels[n], "enabled": a["enabled"], "active": a["enabled"], "api_key_set": str(a["api_key"]) != "", "extra_body_json_set": str(a["extra_body_json"]) != "", "system_prompt_custom": str(a["system_prompt"]) != "", "user_prompt_template_custom": str(a["user_prompt_template"]) != ""}
		for _, k := range []string{"provider", "base_url", "model", "temperature", "max_tokens", "pdf_mode"} {
			item[k] = a[k]
		}
		for _, k := range []string{"provider", "base_url", "api_key", "model", "temperature", "max_tokens", "extra_body_json", "pdf_mode"} {
			source := "default"
			if v := c[n+"_"+k]; v != nil && v != "" {
				source = "override"
			}
			item[k+"_source"] = source
		}
		ok := str(a["api_key"]) != "" && str(a["base_url"]) != "" && str(a["model"]) != ""
		item["ready"] = ok
		if enabled(c, n+"_enabled") && !ok {
			ready = false
		}
		agents = append(agents, item)
	}
	return Config{"status": "ok", "version": Version, "ready": ready, "config": public, "agents": agents}
}
