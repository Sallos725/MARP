package marp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf16"
)

func TextPDF(ctx context.Context, text string) ([]byte, error) {
	if len(text) > 1<<20 {
		return nil, errors.New("source-limit")
	}
	ids := map[rune]int{}
	chars := []rune{}
	encoded := []string{}
	for i, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if i%64 == 0 {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
		}
		var b strings.Builder
		for _, r := range line {
			id, ok := ids[r]
			if !ok {
				id = len(chars) + 1
				ids[r] = id
				chars = append(chars, r)
			}
			fmt.Fprintf(&b, "%04X", id)
		}
		encoded = append(encoded, b.String())
	}
	if len(chars) > 65534 {
		return nil, errors.New("glyph-limit")
	}
	var cmap strings.Builder
	cmap.WriteString("/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /MARPUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n")
	for start := 0; start < len(chars); start += 100 {
		end := min(start+100, len(chars))
		fmt.Fprintf(&cmap, "%d beginbfchar\n", end-start)
		for i := start; i < end; i++ {
			fmt.Fprintf(&cmap, "<%04X> <", i+1)
			for _, u := range utf16.Encode([]rune{chars[i]}) {
				fmt.Fprintf(&cmap, "%04X", u)
			}
			cmap.WriteString(">\n")
		}
		cmap.WriteString("endbfchar\n")
	}
	cmap.WriteString("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend")
	stream := func(s string) string { return fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(s), s) }
	objects := []string{"<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type0 /BaseFont /MARPText /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 6 0 R >>", "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /MARPText /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /DW 600 /CIDToGIDMap /Identity >>", "<< /Type /FontDescriptor /FontName /MARPText /Flags 4 /FontBBox [0 -200 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>", stream(cmap.String())}
	kids := []string{}
	for start := 0; start < len(encoded); start += 100 {
		end := min(start+100, len(encoded))
		id := len(objects) + 1
		kids = append(kids, fmt.Sprintf("%d 0 R", id))
		var b strings.Builder
		b.WriteString("BT /F1 6 Tf 7 TL 20 820 Td\n")
		for _, line := range encoded[start:end] {
			fmt.Fprintf(&b, "%.6f Tz <%s> Tj T*\n", math.Min(100, 555/(math.Max(1, float64(len(line))/4)*3.6)*100), line)
		}
		b.WriteString("ET")
		objects = append(objects, fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>", id+1), stream(b.String()))
	}
	objects[1] = fmt.Sprintf("<< /Type /Pages /Count %d /Kids [%s] >>", len(kids), strings.Join(kids, " "))
	var out strings.Builder
	out.WriteString("%PDF-1.7\n")
	offsets := []int{0}
	for i, o := range objects {
		offsets = append(offsets, out.Len())
		fmt.Fprintf(&out, "%d 0 obj\n%s\nendobj\n", i+1, o)
	}
	xref := out.Len()
	fmt.Fprintf(&out, "xref\n0 %d\n0000000000 65535 f \n", len(offsets))
	for _, o := range offsets[1:] {
		fmt.Fprintf(&out, "%010d 00000 n \n", o)
	}
	fmt.Fprintf(&out, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xref)
	if out.Len() > 8<<20 {
		return nil, errors.New("pdf-limit")
	}
	return []byte(out.String()), nil
}

const pdfTask = "Analyze the attached source transcript using your agent instructions. Preserve facts and distinguish uncertainty. Return concise analysis notes, never the final roleplay reply."

var unsupportedPDF = regexp.MustCompile("(?i)(pdf|document|file|application/pdf).{0,100}(not supported|unsupported|not allowed|invalid|only text)|(not supported|unsupported|does not support).{0,100}(pdf|document|file)")

func pdfUnsupported(err error) bool {
	var e *APIError
	return errors.As(err, &e) && (e.Status == 400 || e.Status == 415 || e.Status == 422) && unsupportedPDF.MatchString(e.Message)
}
func pdfSource(messages []Message, mode string) (string, []Message) {
	var b strings.Builder
	kept := []Message{}
	for i, m := range messages {
		if m.Role == "system" && mode != "max" {
			kept = append(kept, m)
			continue
		}
		fmt.Fprintf(&b, "[%d %s]\n%s\n\n", i+1, m.Role, m.Content)
	}
	source := b.String()
	if mode == "quality" {
		r := []rune(source)
		n := len(r) * 80 / 100
		source = string(r[:n])
		kept = append(kept, Message{"user", "Transcript continues:\n" + string(r[n:])})
	}
	return source, kept
}
func nativeGeminiURL(a Config) (string, error) {
	u, err := url.Parse(str(a["base_url"]))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", errors.New("native-endpoint")
	}
	model := strings.TrimPrefix(strings.TrimPrefix(str(a["model"]), "google/"), "models/")
	if strings.Contains(model, "/") {
		return "", errors.New("native-model")
	}
	if strings.HasSuffix(u.Path, ":generateContent") {
		return u.String(), nil
	}
	if i := strings.Index(u.Path, "/endpoints/openapi"); i >= 0 {
		u.Path = u.Path[:i] + "/publishers/google/models/" + model + ":generateContent"
	} else if strings.Contains(u.Host, "generativelanguage.googleapis.com") {
		u.Path = "/v1beta/models/" + model + ":generateContent"
	} else {
		return "", errors.New("native-endpoint")
	}
	return u.String(), nil
}
func pdfPayload(ctx context.Context, a Config, messages []Message, h map[string][]string) (string, map[string]any, map[string]any, error) {
	mode := str(a["pdf_mode"])
	diag := map[string]any{"mode": mode, "applied": false}
	if mode == "" || mode == "off" {
		return "", nil, diag, nil
	}
	var extra map[string]any
	if raw := str(a["extra_body_json"]); raw != "" {
		if json.Unmarshal([]byte(raw), &extra) != nil {
			return "", nil, diag, errors.New("extra-json")
		}
	}
	for k := range extra {
		if k == "messages" || k == "contents" || k == "system" || k == "systemInstruction" {
			return "", nil, diag, errors.New("extra-content")
		}
	}
	source, kept := pdfSource(messages, mode)
	diag["estimated_source_tokens"] = (len([]rune(source)) + 2) / 3
	if len([]rune(source)) <= 840 {
		diag["reason"] = "short-input"
		return "", nil, diag, nil
	}
	pdf, err := TextPDF(ctx, source)
	if err != nil {
		return "", nil, diag, err
	}
	data := base64.StdEncoding.EncodeToString(pdf)
	diag["bytes"] = len(pdf)
	diag["applied"] = true
	p := provider(a)
	if p == "google" || p == "gemini" || p == "google-ai-studio" || p == "vertex" || p == "vertex-ai" || strings.Contains(str(a["base_url"]), "generativelanguage.googleapis.com") {
		for k := range extra {
			if k != "generationConfig" && k != "safetySettings" {
				return "", nil, diag, errors.New("extra-native-options")
			}
		}
		endpoint, err := nativeGeminiURL(a)
		if err != nil {
			return "", nil, diag, err
		}
		var sys, txt []string
		for _, m := range kept {
			if m.Role == "system" {
				sys = append(sys, m.Content)
			} else {
				txt = append(txt, m.Content)
			}
		}
		gen := map[string]any{"temperature": a["temperature"]}
		if a["max_tokens"] != nil {
			gen["maxOutputTokens"] = a["max_tokens"]
		}
		body := map[string]any{"contents": []any{map[string]any{"role": "user", "parts": []any{map[string]any{"inlineData": map[string]any{"mimeType": "application/pdf", "data": data}}, map[string]any{"text": pdfTask + "\n" + strings.Join(txt, "\n")}}}}, "generationConfig": gen}
		if len(sys) > 0 {
			body["systemInstruction"] = map[string]any{"parts": []any{map[string]any{"text": strings.Join(sys, "\n")}}}
		}
		if p != "vertex" && p != "vertex-ai" {
			delete(h, "Authorization")
			h["X-Goog-Api-Key"] = []string{str(a["api_key"])}
		}
		return endpoint, merge(body, extra), diag, nil
	}
	endpoint, body, err := payload(a, kept)
	if err != nil {
		return "", nil, diag, err
	}
	chat := []any{}
	if old, ok := body["messages"].([]Message); ok {
		for _, m := range old {
			chat = append(chat, m)
		}
	}
	var file any = map[string]any{"type": "file", "file": map[string]any{"filename": "marp-conversation.pdf", "file_data": "data:application/pdf;base64," + data}}
	if p == "claude" || p == "anthropic" {
		file = map[string]any{"type": "document", "source": map[string]any{"type": "base64", "media_type": "application/pdf", "data": data}}
	}
	body["messages"] = append(chat, map[string]any{"role": "user", "content": []any{file, map[string]any{"type": "text", "text": pdfTask}}})
	return endpoint, body, diag, nil
}
