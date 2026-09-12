package marp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

type Engine struct {
	store        *Store
	client       *http.Client
	slots        chan struct{}
	tokenMu      sync.Mutex
	tokens       map[string]oauth2.TokenSource
	tokenContext context.Context
	closeTokens  context.CancelFunc
}

func NewEngine(s *Store) *Engine {
	ctx, cancel := context.WithCancel(context.Background())
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConns = 32
	transport.MaxIdleConnsPerHost = 8
	transport.ResponseHeaderTimeout = 60 * time.Second
	return &Engine{s, &http.Client{Transport: transport}, make(chan struct{}, int(number(s.Snapshot()["max_concurrent_analyses"], 4))), sync.Mutex{}, map[string]oauth2.TokenSource{}, ctx, cancel}
}
func (e *Engine) Close() { e.closeTokens(); e.client.CloseIdleConnections() }

type LLMResult struct {
	Text  string
	Usage map[string]any
	PDF   map[string]any
}
type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string { return fmt.Sprintf("Provider HTTP %d: %s", e.Status, e.Message) }

var thinking = regexp.MustCompile(`(?is)<\s*(?:think|thinking|reasoning)\s*>.*?(?:<\s*/\s*(?:think|thinking|reasoning)\s*>|$)|<｜begin▁of▁(?:thinking|thought|reasoning)｜>.*?(?:<｜end▁of▁(?:thinking|thought|reasoning)｜>|$)|<\|begin[_▁]of[_▁](?:thinking|thought|reasoning)\|>.*?(?:<\|end[_▁]of[_▁](?:thinking|thought|reasoning)\|>|$)`)
var strayThinking = regexp.MustCompile(`(?i)<\s*/\s*(?:think|thinking|reasoning)\s*>|<｜end▁of▁(?:thinking|thought|reasoning)｜>|<\|end[_▁]of[_▁](?:thinking|thought|reasoning)\|>`)

func cleanOutput(s string) string {
	return strings.TrimSpace(strayThinking.ReplaceAllString(thinking.ReplaceAllString(s, ""), ""))
}
func textContent(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	var parts []string
	for _, v := range array(v) {
		p := object(v)
		if p["thought"] == true {
			continue
		}
		if s, ok := v.(string); ok {
			parts = append(parts, s)
		} else if s, ok := p["text"].(string); ok && (p["type"] == nil || p["type"] == "text" || p["type"] == "output_text") {
			parts = append(parts, s)
		}
	}
	return strings.Join(parts, "\n")
}
func extract(data map[string]any) (LLMResult, error) {
	text := ""
	if choices := array(data["choices"]); len(choices) > 0 {
		c := object(choices[0])
		text = textContent(object(c["message"])["content"])
		if text == "" {
			text = textContent(c["text"])
		}
	} else if candidates := array(data["candidates"]); len(candidates) > 0 {
		text = textContent(object(object(candidates[0])["content"])["parts"])
	} else {
		text = textContent(data["content"])
		if text == "" {
			text = textContent(data["output_text"])
		}
	}
	text = cleanOutput(text)
	if text == "" {
		return LLMResult{}, errors.New("Provider returned no visible analysis text")
	}
	usage := object(data["usage"])
	if usage == nil {
		usage = object(data["usageMetadata"])
	}
	return LLMResult{Text: text, Usage: usage}, nil
}
func provider(a Config) string {
	return strings.ReplaceAll(strings.ToLower(str(a["provider"])), "_", "-")
}
func (e *Engine) auth(ctx context.Context, a Config) (http.Header, error) {
	h := http.Header{"Content-Type": []string{"application/json"}}
	key := str(a["api_key"])
	if key == "" {
		return h, errors.New("Credential is not configured")
	}
	switch provider(a) {
	case "claude", "anthropic":
		h.Set("x-api-key", key)
		h.Set("anthropic-version", "2023-06-01")
	case "vertex", "vertex-ai":
		sum := sha256.Sum256([]byte(key))
		id := hex.EncodeToString(sum[:])
		e.tokenMu.Lock()
		source := e.tokens[id]
		if source == nil {
			cfg, err := google.JWTConfigFromJSON([]byte(key), "https://www.googleapis.com/auth/cloud-platform")
			if err != nil {
				e.tokenMu.Unlock()
				return h, errors.New("Invalid Vertex service account JSON")
			}
			if len(e.tokens) >= 16 {
				e.tokens = map[string]oauth2.TokenSource{}
			}
			tokenCtx := context.WithValue(e.tokenContext, oauth2.HTTPClient, &http.Client{Transport: e.client.Transport, Timeout: 30 * time.Second})
			source = oauth2.ReuseTokenSource(nil, cfg.TokenSource(tokenCtx))
			e.tokens[id] = source
		}
		e.tokenMu.Unlock()
		type tokenResult struct {
			token *oauth2.Token
			err   error
		}
		done := make(chan tokenResult, 1)
		go func() { t, err := source.Token(); done <- tokenResult{t, err} }()
		select {
		case <-ctx.Done():
			return h, ctx.Err()
		case r := <-done:
			if r.err != nil {
				return h, errors.New("Vertex access token request failed")
			}
			h.Set("Authorization", "Bearer "+r.token.AccessToken)
		}
	default:
		h.Set("Authorization", "Bearer "+key)
	}
	return h, nil
}
func merge(base, extra map[string]any) map[string]any {
	out := clone(base)
	for k, v := range extra {
		if k == "messages" || k == "contents" || k == "systemInstruction" {
			continue
		}
		if m := object(v); m != nil && object(out[k]) != nil {
			out[k] = merge(object(out[k]), m)
		} else {
			out[k] = v
		}
	}
	return out
}
func payload(a Config, messages []Message) (string, map[string]any, error) {
	url := strings.TrimRight(str(a["base_url"]), "/")
	if url == "" || str(a["model"]) == "" {
		return "", nil, errors.New("Provider URL and model are required")
	}
	body := map[string]any{"model": a["model"], "messages": messages, "temperature": a["temperature"], "stream": false}
	if a["max_tokens"] != nil {
		body["max_tokens"] = a["max_tokens"]
	}
	if provider(a) == "claude" || provider(a) == "anthropic" {
		var system []string
		chat := []Message{}
		for _, m := range messages {
			if m.Role == "system" {
				system = append(system, m.Content)
			} else {
				chat = append(chat, m)
			}
		}
		body["messages"] = chat
		body["system"] = strings.Join(system, "\n\n")
		if body["max_tokens"] == nil {
			body["max_tokens"] = 1024
		}
		return url + "/messages", body, nil
	}
	if raw := strings.TrimSpace(str(a["extra_body_json"])); raw != "" {
		var extra map[string]any
		if json.Unmarshal([]byte(raw), &extra) != nil || extra == nil {
			return "", nil, errors.New("Extra JSON body must be an object")
		}
		body = merge(body, extra)
	}
	body["stream"] = false
	return url + "/chat/completions", body, nil
}
func (e *Engine) post(ctx context.Context, url string, h http.Header, body map[string]any) (LLMResult, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return LLMResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(b))
	if err != nil {
		return LLMResult{}, errors.New("Invalid provider URL")
	}
	req.Header = h.Clone()
	res, err := e.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return LLMResult{}, ctx.Err()
		}
		return LLMResult{}, errors.New("Provider connection failed")
	}
	defer res.Body.Close()
	dataBytes, err := io.ReadAll(io.LimitReader(res.Body, (8<<20)+1))
	if err != nil {
		return LLMResult{}, err
	}
	if len(dataBytes) > 8<<20 {
		return LLMResult{}, errors.New("Provider response exceeds 8 MiB")
	}
	var data map[string]any
	_ = json.Unmarshal(dataBytes, &data)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		message := str(object(data["error"])["message"])
		if message == "" {
			message = http.StatusText(res.StatusCode)
		}
		if len(message) > 300 {
			message = message[:300]
		}
		return LLMResult{}, &APIError{res.StatusCode, message}
	}
	return extract(data)
}
func (e *Engine) Call(ctx context.Context, a Config, messages []Message) (LLMResult, error) {
	h, err := e.auth(ctx, a)
	if err != nil {
		return LLMResult{}, err
	}
	url, body, err := payload(a, messages)
	if err != nil {
		return LLMResult{}, err
	}
	originalHeaders := h.Clone()
	pdfURL, pdfBody, diag, pdfErr := pdfPayload(ctx, a, messages, h)
	if pdfErr != nil {
		diag["applied"] = false
		diag["reason"] = pdfErr.Error()
	}
	if pdfErr == nil && pdfBody != nil {
		result, err := e.post(ctx, pdfURL, h, pdfBody)
		if !pdfUnsupported(err) {
			result.PDF = diag
			return result, err
		}
		diag["applied"] = false
		diag["reason"] = "provider-unsupported"
		diag["text_retry"] = true
	}
	result, err := e.post(ctx, url, originalHeaders, body)
	result.PDF = diag
	return result, err
}
func (e *Engine) Check(ctx context.Context, a Config) (int, error) {
	h, err := e.auth(ctx, a)
	if err != nil {
		return 0, err
	}
	if provider(a) == "vertex-ai" || provider(a) == "vertex" {
		return 200, nil
	}
	url := strings.TrimRight(str(a["base_url"]), "/") + "/models"
	if provider(a) == "claude" || provider(a) == "anthropic" {
		url += "/" + str(a["model"])
	}
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return 0, errors.New("Invalid provider URL")
	}
	req.Header = h
	res, err := e.client.Do(req)
	if err != nil {
		return 0, errors.New("Provider connection failed")
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 65536))
	if res.StatusCode >= 400 {
		return res.StatusCode, &APIError{res.StatusCode, http.StatusText(res.StatusCode)}
	}
	return res.StatusCode, nil
}
