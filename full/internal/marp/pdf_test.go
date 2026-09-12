package marp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestPDFUnicode(t *testing.T) {
	b, e := TextPDF(context.Background(), "[1 user]\n한글 日本語 😀\nsecond line")
	if e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(string(b), "D83DDE00") {
		t.Fatal("lost emoji")
	}
	if os.Getenv("MARP_PDF_FIXTURE") != "" {
		os.WriteFile(os.Getenv("MARP_PDF_FIXTURE"), b, 0600)
	}
}
func TestPDFFallback(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var b map[string]any
		json.NewDecoder(r.Body).Decode(&b)
		if calls == 1 {
			if !strings.Contains(jsonString(b), "file_data") {
				t.Error("missing PDF")
			}
			w.WriteHeader(400)
			json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"message": "PDF file is not supported"}})
			return
		}
		if strings.Contains(jsonString(b), "file_data") {
			t.Error("retry retained PDF")
		}
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": "ok"}}}})
	}))
	defer srv.Close()
	e := NewEngine(testStore(t))
	defer e.Close()
	a := Config{"provider": "openai", "base_url": srv.URL, "api_key": "fake", "model": "mock", "pdf_mode": "quality"}
	r, err := e.Call(context.Background(), a, []Message{{"user", strings.Repeat("한글 ", 500)}})
	if err != nil || r.Text != "ok" || calls != 2 {
		t.Fatalf("%+v %v %d", r, err, calls)
	}
}
func TestPDFSafety(t *testing.T) {
	for _, status := range []int{401, 429, 500} {
		if pdfUnsupported(&APIError{status, "PDF unsupported"}) {
			t.Fatal(status)
		}
	}
	if _, e := TextPDF(context.Background(), strings.Repeat("a", (1<<20)+1)); e == nil {
		t.Fatal("missing cap")
	}
	a := Config{"base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "model": "gemini-test"}
	u, e := nativeGeminiURL(a)
	if e != nil || u != "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent" {
		t.Fatal(u, e)
	}
}
