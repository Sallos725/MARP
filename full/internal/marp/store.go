package marp

import (
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const Version = "0.9.5"

var AgentNames = []string{"worldbuilding", "plot", "character"}
var Labels = map[string]string{"worldbuilding": "세계관 에이전트", "plot": "플롯 에이전트", "character": "등장인물 에이전트"}

//go:embed legacy.json
var legacyBytes []byte
var legacy map[string]any

func init() {
	if err := json.Unmarshal(legacyBytes, &legacy); err != nil {
		panic(err)
	}
}

type Config map[string]any

func clone[T any](v T) T { b, _ := json.Marshal(v); var out T; _ = json.Unmarshal(b, &out); return out }
func str(v any) string {
	if v == nil {
		return ""
	}
	s, ok := v.(string)
	if ok {
		return s
	}
	return fmt.Sprint(v)
}
func number(v any, fallback float64) float64 {
	if n, ok := v.(float64); ok {
		return n
	}
	return fallback
}
func enabled(c Config, k string) bool { v, ok := c[k].(bool); return !ok || v }
func Defaults() Config {
	c := Config(clone(legacy["/config"].(map[string]any)))
	c["default_pdf_mode"] = "off"
	c["analysis_timeout"] = float64(120)
	c["max_concurrent_analyses"] = float64(4)
	for _, n := range AgentNames {
		c[n+"_pdf_mode"] = ""
	}
	return c
}
func normalize(raw Config) Config {
	c := Defaults()
	for k, v := range raw {
		if _, ok := c[k]; ok {
			c[k] = v
		}
	}
	switch str(c["pipeline_mode"]) {
	case "classic", "ensemble-director", "deep-ensemble":
	default:
		c["pipeline_mode"] = "classic"
	}
	return c
}
func agentConfig(c Config, n string) Config {
	a := Config{"name": n, "enabled": enabled(c, n+"_enabled")}
	for _, k := range []string{"provider", "base_url", "api_key", "model", "temperature", "max_tokens", "extra_body_json", "pdf_mode"} {
		v := c[n+"_"+k]
		if v == nil || v == "" {
			v = c["default_"+k]
		}
		a[k] = v
	}
	a["system_prompt"] = c[n+"_system_prompt"]
	a["user_prompt_template"] = c[n+"_user_prompt_template"]
	return a
}

type Preset struct {
	ID      string         `json:"id"`
	Name    string         `json:"name"`
	SavedAt string         `json:"saved_at"`
	Pack    map[string]any `json:"pack,omitempty"`
}
type PresetLibrary struct {
	Version int      `json:"version"`
	Presets []Preset `json:"presets"`
}
type Store struct {
	mu               sync.RWMutex
	path, presetPath string
	config           Config
	presets          PresetLibrary
}

func OpenStore(path, presetPath string) (*Store, error) {
	s := &Store{path: path, presetPath: presetPath, config: Defaults(), presets: PresetLibrary{1, []Preset{}}}
	b, err := os.ReadFile(path)
	if err == nil {
		var c Config
		if err = json.Unmarshal(b, &c); err != nil {
			return nil, fmt.Errorf("read config: %w", err)
		}
		s.config = normalize(c)
	} else if !os.IsNotExist(err) {
		return nil, err
	} else {
		for k, def := range s.config {
			if v, ok := os.LookupEnv(strings.ToUpper(k)); ok {
				var x any
				switch def.(type) {
				case bool, float64:
					if e := json.Unmarshal([]byte(v), &x); e != nil {
						return nil, fmt.Errorf("invalid %s", strings.ToUpper(k))
					}
				case nil:
					if v != "" {
						if e := json.Unmarshal([]byte(v), &x); e != nil {
							return nil, e
						}
					}
				default:
					x = v
				}
				s.config[k] = x
			}
		}
		if err = writeJSON(path, s.config); err != nil {
			return nil, err
		}
	}
	if b, err = os.ReadFile(presetPath); err == nil {
		if json.Unmarshal(b, &s.presets) != nil {
			s.presets = PresetLibrary{1, []Preset{}}
		}
	}
	if s.presets.Presets == nil {
		s.presets.Presets = []Preset{}
	}
	s.presets.Version = 1
	if err := validateConfig(s.config); err != nil {
		return nil, err
	}
	return s, nil
}
func writeJSON(path string, v any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".marp-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(append(b, '\n')); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), path)
}
func (s *Store) Snapshot() Config { s.mu.RLock(); defer s.mu.RUnlock(); return clone(s.config) }
func (s *Store) Save(c Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	c = normalize(c)
	if err := validateConfig(c); err != nil {
		return err
	}
	if err := writeJSON(s.path, c); err != nil {
		return err
	}
	s.config = c
	return nil
}
func revision(c Config) string {
	b, _ := json.Marshal(c)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:8])
}
func (s *Store) Presets(withPack bool) PresetLibrary {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p := clone(s.presets)
	if !withPack {
		for i := range p.Presets {
			p.Presets[i].Pack = nil
		}
	}
	return p
}
func (s *Store) SavePreset(id, name string, pack map[string]any) (PresetLibrary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id == "" {
		b := make([]byte, 16)
		if _, err := rand.Read(b); err != nil {
			return PresetLibrary{}, err
		}
		id = "preset-" + hex.EncodeToString(b)
	}
	name = strings.Join(strings.Fields(name), " ")
	if name == "" {
		name = "Preset"
	}
	r := []rune(name)
	if len(r) > 80 {
		name = string(r[:77]) + "..."
	}
	next := PresetLibrary{1, []Preset{{id, name, time.Now().UTC().Format(time.RFC3339Nano), pack}}}
	for _, p := range s.presets.Presets {
		if p.ID != id && len(next.Presets) < 100 {
			next.Presets = append(next.Presets, p)
		}
	}
	if err := writeJSON(s.presetPath, next); err != nil {
		return next, err
	}
	s.presets = next
	return next, nil
}
func (s *Store) DeletePreset(id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := PresetLibrary{1, []Preset{}}
	found := false
	for _, p := range s.presets.Presets {
		if p.ID == id {
			found = true
		} else {
			next.Presets = append(next.Presets, p)
		}
	}
	if !found {
		return false, nil
	}
	if err := writeJSON(s.presetPath, next); err != nil {
		return false, err
	}
	s.presets = next
	return true, nil
}
