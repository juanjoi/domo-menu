// Package domomenu is a Traefik middleware plugin that inserts the hub menu
// script into the HTML pages of the applications that use it.
//
// Traefik runs it with Yaegi, so it only uses the standard library and keeps
// to plain constructs.
package domomenu

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

// Config is the plugin configuration.
type Config struct {
	// ScriptPath is the same-origin path of the menu script.
	ScriptPath string `json:"scriptPath,omitempty"`
	// MaxHeadSize is how many bytes are buffered looking for </head>.
	// Pages whose </head> comes later pass through untouched.
	MaxHeadSize int `json:"maxHeadSize,omitempty"`

	// Categoria, Nombre and Icono describe the application in the menu list.
	// The plugin ignores them: the menu service reads them from Traefik's API.
	Categoria string `json:"categoria,omitempty"`
	Nombre    string `json:"nombre,omitempty"`
	Icono     string `json:"icono,omitempty"`
}

// CreateConfig returns the default configuration.
func CreateConfig() *Config {
	return &Config{
		ScriptPath:  "/__menu/menu.js",
		MaxHeadSize: 128 * 1024,
	}
}

// Menu is the middleware.
type Menu struct {
	next        http.Handler
	tag         []byte
	maxHeadSize int
}

// New creates the middleware.
func New(_ context.Context, next http.Handler, config *Config, _ string) (http.Handler, error) {
	path := config.ScriptPath
	if path == "" {
		path = "/__menu/menu.js"
	}
	if !strings.HasPrefix(path, "/") || strings.ContainsAny(path, "\"'<> ") {
		return nil, fmt.Errorf("domo-menu: scriptPath no válido: %q", path)
	}
	max := config.MaxHeadSize
	if max <= 0 {
		max = 128 * 1024
	}
	return &Menu{
		next:        next,
		tag:         []byte(`<script src="` + path + `" defer></script>`),
		maxHeadSize: max,
	}, nil
}

func (m *Menu) ServeHTTP(rw http.ResponseWriter, req *http.Request) {
	if !isPageRequest(req) {
		m.next.ServeHTTP(rw, req)
		return
	}
	// Brotli and zstd cannot be decoded with the standard library: ask for
	// an uncompressed page and let Traefik's compress middleware, placed
	// before this one, compress it again.
	req.Header.Del("Accept-Encoding")

	w := &injector{rw: rw, tag: m.tag, maxHeadSize: m.maxHeadSize, code: http.StatusOK}
	m.next.ServeHTTP(w, req)
	w.finish()
}

// isPageRequest reports whether the browser is navigating to a page, as
// opposed to fetching a fragment, a resource, a range or opening a websocket.
func isPageRequest(req *http.Request) bool {
	if req.Method != http.MethodGet {
		return false
	}
	if req.Header.Get("Upgrade") != "" || req.Header.Get("Range") != "" {
		return false
	}
	if dest := req.Header.Get("Sec-Fetch-Dest"); dest != "" {
		return dest == "document"
	}
	return strings.Contains(req.Header.Get("Accept"), "text/html")
}

const (
	stateNew = iota
	stateBuffering
	statePassthrough
)

// injector buffers the beginning of an HTML page until it finds </head>,
// inserts the script tag there and streams the rest.
type injector struct {
	rw          http.ResponseWriter
	tag         []byte
	maxHeadSize int

	state  int
	code   int
	length int64 // original Content-Length, -1 if unknown
	buf    []byte
}

func (w *injector) Header() http.Header {
	return w.rw.Header()
}

func (w *injector) WriteHeader(code int) {
	if w.state != stateNew {
		return
	}
	if code >= 100 && code < 200 {
		w.rw.WriteHeader(code)
		return
	}
	w.code = code
	if w.isHTMLPage() {
		w.state = stateBuffering
		w.length = -1
		if v := w.rw.Header().Get("Content-Length"); v != "" {
			if n, err := strconv.ParseInt(v, 10, 64); err == nil && n >= 0 {
				w.length = n
			}
		}
		return
	}
	w.state = statePassthrough
	w.rw.WriteHeader(code)
}

func (w *injector) isHTMLPage() bool {
	if w.code != http.StatusOK {
		return false
	}
	h := w.rw.Header()
	ct := strings.ToLower(strings.TrimSpace(h.Get("Content-Type")))
	if !strings.HasPrefix(ct, "text/html") {
		return false
	}
	enc := strings.ToLower(strings.TrimSpace(h.Get("Content-Encoding")))
	if enc != "" && enc != "identity" {
		return false
	}
	return h.Get("Content-Range") == ""
}

func (w *injector) Write(p []byte) (int, error) {
	if w.state == stateNew {
		w.WriteHeader(http.StatusOK)
	}
	if w.state != stateBuffering {
		n, err := w.rw.Write(p)
		if err == nil {
			w.flushNext()
		}
		return n, err
	}
	// Only search the new bytes, plus a pattern length of overlap.
	from := len(w.buf) - len("</head")
	if from < 0 {
		from = 0
	}
	w.buf = append(w.buf, p...)
	if i := indexHeadEnd(w.buf[from:]); i >= 0 {
		if err := w.release(from + i); err != nil {
			return 0, err
		}
		return len(p), nil
	}
	if len(w.buf) > w.maxHeadSize {
		if err := w.release(-1); err != nil {
			return 0, err
		}
	}
	return len(p), nil
}

// Flush forwards flushes once the head has been released.
func (w *injector) Flush() {
	if w.state == stateNew {
		w.WriteHeader(http.StatusOK)
	}
	if w.state == stateBuffering {
		return
	}
	w.flushNext()
}

// flushNext flushes the underlying writer. Under Yaegi, Traefik does not see
// the Flush method of this interpreted type, so streamed responses, such as
// server-sent events or pages rendered in chunks, would wait until the end:
// the injector flushes after every write once it is not buffering.
func (w *injector) flushNext() {
	if f, ok := w.rw.(http.Flusher); ok {
		f.Flush()
	}
}

// release writes the headers and the buffered bytes, with the script tag
// inserted at position at (or untouched if at < 0), and switches to
// passthrough.
func (w *injector) release(at int) error {
	w.state = statePassthrough
	buf := w.buf
	w.buf = nil

	h := w.rw.Header()
	if at >= 0 {
		if w.length >= 0 {
			h.Set("Content-Length", strconv.FormatInt(w.length+int64(len(w.tag)), 10))
		} else {
			h.Del("Content-Length")
		}
		if etag := h.Get("ETag"); etag != "" && !strings.HasPrefix(etag, "W/") {
			h.Set("ETag", "W/"+etag)
		}
	}
	w.rw.WriteHeader(w.code)

	if at < 0 {
		if _, err := w.rw.Write(buf); err != nil {
			return err
		}
		w.flushNext()
		return nil
	}
	if _, err := w.rw.Write(buf[:at]); err != nil {
		return err
	}
	if _, err := w.rw.Write(w.tag); err != nil {
		return err
	}
	if _, err := w.rw.Write(buf[at:]); err != nil {
		return err
	}
	w.flushNext()
	return nil
}

// finish releases a page that ended before </head> was found.
func (w *injector) finish() {
	if w.state == stateBuffering {
		_ = w.release(-1)
	}
}

// indexHeadEnd returns the position of the first "</head" in b, ignoring
// ASCII case, or -1.
func indexHeadEnd(b []byte) int {
	const pattern = "</head"
	for i := 0; i+len(pattern) <= len(b); i++ {
		match := true
		for j := 0; j < len(pattern); j++ {
			c := b[i+j]
			if c >= 'A' && c <= 'Z' {
				c += 'a' - 'A'
			}
			if c != pattern[j] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}
