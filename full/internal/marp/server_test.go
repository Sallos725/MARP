package marp

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"testing"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	d := t.TempDir()
	s, e := OpenStore(filepath.Join(d, "config.json"), filepath.Join(d, "presets.json"))
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func TestLegacyAPI(t *testing.T) {
	s := &Server{Store: testStore(t)}
	h := s.Handler()
	for _, path := range []string{"/health", "/config", "/presets"} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", path, nil))
		if r.Code != 200 {
			t.Fatal(path, r.Code)
		}
		var got map[string]any
		_ = json.Unmarshal(r.Body.Bytes(), &got)
		want := legacy[path].(map[string]any)
		for k, v := range want {
			if !reflect.DeepEqual(v, got[k]) {
				t.Errorf("%s %s differs", path, k)
			}
		}
	}
}
func TestConfigAndPresetsPersist(t *testing.T) {
	s := testStore(t)
	h := (&Server{Store: s}).Handler()
	r := httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest("PUT", "/config", bytes.NewBufferString(`{"default_temperature":0,"plot_model":"override","worldbuilding_enabled":false}`)))
	if r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	s2, e := OpenStore(s.path, s.presetPath)
	if e != nil {
		t.Fatal(e)
	}
	if agentConfig(s2.Snapshot(), "plot")["temperature"] != float64(0) {
		t.Fatal("zero lost")
	}
	r = httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest("POST", "/presets", bytes.NewBufferString(`{"name":" 한글 preset ","pack":{"version":1}}`)))
	if r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	if len(s.Presets(true).Presets) != 1 {
		t.Fatal("not persisted")
	}
	for _, p := range s.Presets(false).Presets {
		if p.Pack != nil {
			t.Fatal("index exposed pack")
		}
	}
}
func TestValidationAndNoSecrets(t *testing.T) {
	s := testStore(t)
	c := s.Snapshot()
	c["default_api_key"] = "secret-fixture"
	_ = s.Save(c)
	h := (&Server{Store: s}).Handler()
	for _, p := range []string{"/status", "/runtime-config"} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", p, nil))
		if bytes.Contains(r.Body.Bytes(), []byte("secret-fixture")) {
			t.Fatal("secret leaked")
		}
	}
	r := httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest("POST", "/analyze", bytes.NewBufferString(`{}`)))
	if r.Code != 422 {
		t.Fatal(r.Code)
	}
}

func TestNewContractAndValidation(t *testing.T) {
	h := (&Server{Store: testStore(t)}).Handler()
	for _, body := range []string{`null`, `{"context_window":0.5}`, `{"max_concurrent_analyses":0.5}`, `{"plot_max_tokens":"bad"}`} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("PUT", "/config", bytes.NewBufferString(body)))
		if r.Code != 422 {
			t.Fatalf("%s: %d", body, r.Code)
		}
	}
	r := httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest("GET", "/prompts/defaults", nil))
	if !bytes.Contains(r.Body.Bytes(), []byte("Separate established facts")) {
		t.Fatal("missing improved default")
	}
	r = httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest("GET", "/openapi.json", nil))
	if !bytes.Contains(r.Body.Bytes(), []byte("/runtime-config")) {
		t.Fatal("missing runtime API schema")
	}
}
