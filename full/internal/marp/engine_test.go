package marp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestPipelineParallelAndTemplate(t *testing.T) {
	var active, peak atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		chat := array(body["messages"])
		system := str(object(chat[0])["content"])
		input := str(object(chat[1])["content"])
		if !strings.Contains(input, "SETTING-FIXTURE") {
			t.Error("system_context missing")
		}
		if strings.HasPrefix(system, "You are the worldbuilding consistency agent.") {
			respond(w, 200, Config{"choices": []any{Config{"message": Config{"content": "<think>private</think>world"}}}})
			return
		}
		n := active.Add(1)
		for old := peak.Load(); n > old && !peak.CompareAndSwap(old, n); old = peak.Load() {
		}
		time.Sleep(30 * time.Millisecond)
		active.Add(-1)
		respond(w, 200, Config{"choices": []any{Config{"message": Config{"content": "analysis"}}}})
	}))
	defer server.Close()
	s := testStore(t)
	cfg := s.Snapshot()
	cfg["default_base_url"] = server.URL
	cfg["default_api_key"] = "fixture"
	for _, n := range AgentNames {
		cfg[n+"_user_prompt_template"] = "{{system_context}} {{context_world}}"
	}
	_ = s.Save(cfg)
	e := NewEngine(s)
	defer e.Close()
	out, err := e.Analyze(context.Background(), AnalyzeRequest{UserInput: "continue", SystemContext: "SETTING-FIXTURE"})
	if err != nil || len(out.Errors) > 0 {
		t.Fatal(err, out.Errors)
	}
	if out.World != "world" || out.Plot != "analysis" || peak.Load() != 2 {
		t.Fatal(out, peak.Load())
	}
}
func TestDisabledAndDeadline(t *testing.T) {
	s := testStore(t)
	c := s.Snapshot()
	for _, n := range AgentNames {
		c[n+"_enabled"] = false
	}
	_ = s.Save(c)
	e := NewEngine(s)
	defer e.Close()
	out, err := e.Analyze(context.Background(), AnalyzeRequest{UserInput: "x"})
	if err != nil || out.World != "" || len(out.Errors) != 0 {
		t.Fatal(out, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for i := 0; i < cap(e.slots); i++ {
		e.slots <- struct{}{}
	}
	if _, err = e.Analyze(ctx, AnalyzeRequest{}); err == nil {
		t.Fatal("cancel ignored")
	}
}
func TestContentExtraction(t *testing.T) {
	r, e := extract(map[string]any{"candidates": []any{Config{"content": Config{"parts": []any{Config{"thought": true, "text": "hidden"}, Config{"text": "visible"}}}}}})
	if e != nil || r.Text != "visible" {
		t.Fatal(r, e)
	}
	if _, e = extract(map[string]any{"choices": []any{Config{"message": Config{"content": "<think>unfinished"}}}}); e == nil {
		t.Fatal("empty output accepted")
	}
}
