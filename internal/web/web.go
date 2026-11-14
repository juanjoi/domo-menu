// Package web serves the menu script and the application list under /__menu/.
package web

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/juanjoi/domo-menu/internal/apps"
)

// Lister returns the applications for the menu.
type Lister interface {
	Apps(ctx context.Context) ([]apps.App, error)
}

// Config is what the handler needs.
type Config struct {
	Script []byte
	Apps   Lister
	// Domain is the common domain of the applications. Empty lets the
	// script deduce it from the current page.
	Domain string
	Log    *slog.Logger
}

type listing struct {
	Domain string     `json:"domain,omitempty"`
	Apps   []apps.App `json:"apps"`
}

// Handler serves GET requests only: the script, the list and a health check.
func Handler(cfg Config) http.Handler {
	log := cfg.Log
	if log == nil {
		log = slog.Default()
	}
	scriptETag := etag(cfg.Script)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /__menu/menu.js", func(w http.ResponseWriter, r *http.Request) {
		serve(w, r, "text/javascript; charset=utf-8", scriptETag, cfg.Script)
	})
	mux.HandleFunc("GET /__menu/apps.json", func(w http.ResponseWriter, r *http.Request) {
		list, err := cfg.Apps.Apps(r.Context())
		if err != nil {
			log.Error("no se pudo leer la lista de aplicaciones", "error", err)
			http.Error(w, "lista de aplicaciones no disponible", http.StatusBadGateway)
			return
		}
		body, err := json.Marshal(listing{Domain: cfg.Domain, Apps: list})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		serve(w, r, "application/json", etag(body), body)
	})
	mux.HandleFunc("GET /__menu/salud", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write([]byte("ok\n"))
	})

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		mux.ServeHTTP(w, r)
	})
}

// serve sends content that browsers must revalidate on every use, so a new
// version reaches them at once and an unchanged one costs a 304.
func serve(w http.ResponseWriter, r *http.Request, contentType, tag string, body []byte) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("ETag", tag)
	http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(body))
}

func etag(b []byte) string {
	sum := sha256.Sum256(b)
	return `"` + hex.EncodeToString(sum[:8]) + `"`
}
