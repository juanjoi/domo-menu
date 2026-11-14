package domomenu

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

const tag = `<script src="/__menu/menu.js" defer></script>`

func newMenu(t *testing.T, next http.Handler) http.Handler {
	t.Helper()
	h, err := New(context.Background(), next, CreateConfig(), "menu")
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func pageRequest() *http.Request {
	req := httptest.NewRequest(http.MethodGet, "http://app.example.test/", nil)
	req.Header.Set("Sec-Fetch-Dest", "document")
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	req.Header.Set("Accept-Encoding", "gzip, deflate, br, zstd")
	return req
}

func htmlHandler(body string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Content-Length", strconv.Itoa(len(body)))
		io.WriteString(w, body)
	}
}

func TestInsertsBeforeHead(t *testing.T) {
	body := "<!doctype html><html><head><title>x</title></HEAD><body>hola</body></html>"
	rec := httptest.NewRecorder()
	newMenu(t, htmlHandler(body)).ServeHTTP(rec, pageRequest())

	want := "<!doctype html><html><head><title>x</title>" + tag + "</HEAD><body>hola</body></html>"
	if got := rec.Body.String(); got != want {
		t.Fatalf("body = %q, want %q", got, want)
	}
	if got := rec.Header().Get("Content-Length"); got != strconv.Itoa(len(want)) {
		t.Fatalf("Content-Length = %q, want %d", got, len(want))
	}
}

func TestRemovesAcceptEncodingOnPages(t *testing.T) {
	var got string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("Accept-Encoding")
		htmlHandler("<head></head>")(w, r)
	})
	newMenu(t, next).ServeHTTP(httptest.NewRecorder(), pageRequest())
	if got != "" {
		t.Fatalf("Accept-Encoding = %q, want empty", got)
	}
}

func TestKeepsAcceptEncodingOnOtherRequests(t *testing.T) {
	var got string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("Accept-Encoding")
	})
	req := pageRequest()
	req.Header.Set("Sec-Fetch-Dest", "script")
	newMenu(t, next).ServeHTTP(httptest.NewRecorder(), req)
	if got == "" {
		t.Fatal("Accept-Encoding was removed from a non-page request")
	}
}

func TestPassesThroughNonPages(t *testing.T) {
	body := "<head></head>"
	cases := map[string]func(*http.Request){
		"fragment":  func(r *http.Request) { r.Header.Set("Sec-Fetch-Dest", "empty") },
		"iframe":    func(r *http.Request) { r.Header.Set("Sec-Fetch-Dest", "iframe") },
		"post":      func(r *http.Request) { r.Method = http.MethodPost },
		"head":      func(r *http.Request) { r.Method = http.MethodHead },
		"range":     func(r *http.Request) { r.Header.Set("Range", "bytes=0-10") },
		"websocket": func(r *http.Request) { r.Header.Set("Upgrade", "websocket") },
		"no fetch metadata, no html": func(r *http.Request) {
			r.Header.Del("Sec-Fetch-Dest")
			r.Header.Set("Accept", "application/json")
		},
	}
	for name, modify := range cases {
		t.Run(name, func(t *testing.T) {
			req := pageRequest()
			modify(req)
			rec := httptest.NewRecorder()
			newMenu(t, htmlHandler(body)).ServeHTTP(rec, req)
			if rec.Body.String() != body {
				t.Fatalf("body = %q, want untouched", rec.Body.String())
			}
		})
	}
}

func TestAcceptWithoutFetchMetadata(t *testing.T) {
	req := pageRequest()
	req.Header.Del("Sec-Fetch-Dest")
	rec := httptest.NewRecorder()
	newMenu(t, htmlHandler("<head></head>")).ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), tag) {
		t.Fatalf("body = %q, want script", rec.Body.String())
	}
}

func TestPassesThroughNonHTMLResponses(t *testing.T) {
	cases := map[string]http.HandlerFunc{
		"json": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, "<head></head>")
		},
		"not found": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(http.StatusNotFound)
			io.WriteString(w, "<head></head>")
		},
		"compressed": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			w.Header().Set("Content-Encoding", "br")
			io.WriteString(w, "<head></head>")
		},
		"partial": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			w.Header().Set("Content-Range", "bytes 0-12/100")
			io.WriteString(w, "<head></head>")
		},
	}
	for name, next := range cases {
		t.Run(name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			newMenu(t, next).ServeHTTP(rec, pageRequest())
			if rec.Body.String() != "<head></head>" {
				t.Fatalf("body = %q, want untouched", rec.Body.String())
			}
		})
	}
}

func TestHeadAcrossWrites(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		io.WriteString(w, "<html><head>")
		io.WriteString(w, "</he")
		io.WriteString(w, "ad><body>")
		io.WriteString(w, "fin</body>")
	})
	rec := httptest.NewRecorder()
	newMenu(t, next).ServeHTTP(rec, pageRequest())

	want := "<html><head>" + tag + "</head><body>fin</body>"
	if got := rec.Body.String(); got != want {
		t.Fatalf("body = %q, want %q", got, want)
	}
	if got := rec.Header().Get("Content-Length"); got != "" {
		t.Fatalf("Content-Length = %q, want none", got)
	}
}

func TestNoHeadPassesThrough(t *testing.T) {
	body := "<p>sin cabecera</p>"
	rec := httptest.NewRecorder()
	newMenu(t, htmlHandler(body)).ServeHTTP(rec, pageRequest())
	if rec.Body.String() != body {
		t.Fatalf("body = %q, want untouched", rec.Body.String())
	}
	if rec.Header().Get("Content-Length") != strconv.Itoa(len(body)) {
		t.Fatalf("Content-Length changed: %q", rec.Header().Get("Content-Length"))
	}
}

func TestHeadTooFarPassesThrough(t *testing.T) {
	cfg := CreateConfig()
	cfg.MaxHeadSize = 16
	body := "<head>" + strings.Repeat("x", 64) + "</head>"
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		for i := 0; i < len(body); i += 8 {
			end := i + 8
			if end > len(body) {
				end = len(body)
			}
			io.WriteString(w, body[i:end])
		}
	})
	h, err := New(context.Background(), next, cfg, "menu")
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, pageRequest())
	if rec.Body.String() != body {
		t.Fatalf("body = %q, want untouched", rec.Body.String())
	}
}

func TestWeakensStrongETag(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"abc"`)
		htmlHandler("<head></head>")(w, r)
	})
	rec := httptest.NewRecorder()
	newMenu(t, next).ServeHTTP(rec, pageRequest())
	if got := rec.Header().Get("ETag"); got != `W/"abc"` {
		t.Fatalf("ETag = %q", got)
	}
}

func TestStatusIsKept(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		io.WriteString(w, "<head></head>")
	})
	rec := httptest.NewRecorder()
	newMenu(t, next).ServeHTTP(rec, pageRequest())
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), tag) {
		t.Fatalf("code = %d, body = %q", rec.Code, rec.Body.String())
	}
}

func TestEmptyResponse(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
	})
	rec := httptest.NewRecorder()
	newMenu(t, next).ServeHTTP(rec, pageRequest())
	if rec.Code != http.StatusOK || rec.Body.Len() != 0 {
		t.Fatalf("code = %d, body = %q", rec.Code, rec.Body.String())
	}
}

func TestInvalidScriptPath(t *testing.T) {
	for _, path := range []string{"menu.js", `/a"b`, "/<x>"} {
		cfg := CreateConfig()
		cfg.ScriptPath = path
		if _, err := New(context.Background(), http.NotFoundHandler(), cfg, "menu"); err == nil {
			t.Errorf("scriptPath %q accepted", path)
		}
	}
}

type flushRecorder struct {
	*httptest.ResponseRecorder
	flushes int
}

func (f *flushRecorder) Flush() { f.flushes++ }

func TestFlushesStreamedResponses(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "data: 1\n\n")
		io.WriteString(w, "data: 2\n\n")
	})
	rec := &flushRecorder{ResponseRecorder: httptest.NewRecorder()}
	newMenu(t, next).ServeHTTP(rec, pageRequest())
	if rec.flushes != 2 {
		t.Fatalf("flushes = %d, want one per write", rec.flushes)
	}
}
