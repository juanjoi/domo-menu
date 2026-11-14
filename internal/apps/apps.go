// Package apps builds the menu list from the routers and middlewares in
// Traefik's API.
package apps

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// IconPath is where the service serves the icons.
const IconPath = "/__menu/iconos/"

// App is a menu entry. Prefix applications, routed with HostRegexp(`^name\.`),
// only carry Name and the script builds the link with the domain of the
// current page. Applications routed with Host(`full.name`) also carry Host.
// Title, Category and Icon come from the configuration of the application's
// menu middleware.
type App struct {
	Name     string `json:"name"`
	Host     string `json:"host,omitempty"`
	Title    string `json:"title,omitempty"`
	Category string `json:"category,omitempty"`
	Icon     string `json:"icon,omitempty"`
}

// Router is the part of a Traefik HTTP router that the menu uses.
type Router struct {
	Name        string   `json:"name"`
	Rule        string   `json:"rule"`
	Status      string   `json:"status"`
	Middlewares []string `json:"middlewares"`
}

// Middleware is the part of a Traefik HTTP middleware that the menu uses.
// Plugin middlewares carry their configuration under Plugin[pluginName].
type Middleware struct {
	Name   string                    `json:"name"`
	Type   string                    `json:"type"`
	Status string                    `json:"status"`
	Plugin map[string]map[string]any `json:"plugin"`
}

// Options says how to recognise and describe the menu applications.
type Options struct {
	// Plugin is the name of the menu plugin in Traefik's static
	// configuration; it is the type of every menu middleware.
	Plugin string
	// Categories, in the order they are shown. Others are dropped.
	Categories []string
	// IconExists reports whether an icon file is available.
	IconExists func(name string) bool
}

var (
	matcherRe = regexp.MustCompile("(HostRegexp|Host)\\(([^)]*)\\)")
	quotedRe  = regexp.MustCompile("`([^`]*)`|\"([^\"]*)\"")
	prefixRe  = regexp.MustCompile(`^\^([a-z0-9][a-z0-9-]*)\\\.`)
	hostRe    = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$`)
	iconRe    = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*\.(svg|png|webp)$`)
)

// ValidIconName reports whether name is an acceptable icon file name: no
// paths, only the image types the service serves.
func ValidIconName(name string) bool {
	return len(name) <= 100 && iconRe.MatchString(name)
}

type meta struct {
	title, category, icon string
}

// Build returns the applications behind the enabled routers that use a menu
// middleware, without duplicates, sorted by category and then by name.
func Build(routers []Router, middlewares []Middleware, opt Options) []App {
	menus := map[string]meta{}
	for _, m := range middlewares {
		if m.Type != opt.Plugin || (m.Status != "" && m.Status != "enabled") {
			continue
		}
		cfg := m.Plugin[opt.Plugin]
		menus[m.Name] = meta{
			title:    text(cfg["nombre"], 60),
			category: category(text(cfg["categoria"], 60), opt.Categories),
			icon:     icon(text(cfg["icono"], 100), opt.IconExists),
		}
	}

	index := map[string]int{}
	list := []App{}
	for _, r := range routers {
		if r.Status != "" && r.Status != "enabled" {
			continue
		}
		m, ok := menuOf(r.Middlewares, menus)
		if !ok {
			continue
		}
		for _, app := range fromRule(r.Rule) {
			key := app.Name + "|" + app.Host
			if i, dup := index[key]; dup {
				merge(&list[i], m)
				continue
			}
			merge(&app, m)
			index[key] = len(list)
			list = append(list, app)
		}
	}

	order := map[string]int{}
	for i, c := range opt.Categories {
		order[c] = i
	}
	rank := func(a App) int {
		if i, ok := order[a.Category]; ok {
			return i
		}
		return len(order)
	}
	sort.SliceStable(list, func(i, j int) bool {
		a, b := list[i], list[j]
		if rank(a) != rank(b) {
			return rank(a) < rank(b)
		}
		if ta, tb := strings.ToLower(display(a)), strings.ToLower(display(b)); ta != tb {
			return ta < tb
		}
		return a.Host < b.Host
	})
	return list
}

func display(a App) string {
	if a.Title != "" {
		return a.Title
	}
	return a.Name
}

// menuOf returns the configuration of the first menu middleware in names.
func menuOf(names []string, menus map[string]meta) (meta, bool) {
	for _, n := range names {
		if m, ok := menus[n]; ok {
			return m, true
		}
	}
	return meta{}, false
}

// merge fills the empty fields of app; when an application has several
// routers, the first one that says something wins.
func merge(app *App, m meta) {
	if app.Title == "" {
		app.Title = m.title
	}
	if app.Category == "" {
		app.Category = m.category
	}
	if app.Icon == "" {
		app.Icon = m.icon
	}
}

func text(v any, max int) string {
	s, _ := v.(string)
	s = strings.TrimSpace(s)
	if !utf8.ValidString(s) || utf8.RuneCountInString(s) > max {
		return ""
	}
	return s
}

// category returns the configured spelling of c, or "" if it is not one of
// the categories.
func category(c string, categories []string) string {
	for _, known := range categories {
		if strings.EqualFold(c, known) {
			return known
		}
	}
	return ""
}

func icon(name string, exists func(string) bool) string {
	if !ValidIconName(name) || exists == nil || !exists(name) {
		return ""
	}
	return IconPath + name
}

// fromRule extracts the applications from the Host and HostRegexp matchers
// of a rule. Other matchers, and regular expressions that are not a plain
// name prefix, are ignored.
func fromRule(rule string) []App {
	var list []App
	for _, m := range matcherRe.FindAllStringSubmatch(rule, -1) {
		for _, q := range quotedRe.FindAllStringSubmatch(m[2], -1) {
			value := strings.ToLower(strings.TrimSpace(q[1] + q[2]))
			if m[1] == "Host" {
				if hostRe.MatchString(value) {
					name, _, _ := strings.Cut(value, ".")
					list = append(list, App{Name: name, Host: value})
				}
				continue
			}
			if p := prefixRe.FindStringSubmatch(value); p != nil {
				list = append(list, App{Name: p[1]})
			}
		}
	}
	return list
}

// Source reads Traefik's API and caches the list.
type Source struct {
	API        string // base URL of Traefik's API, such as http://traefik:8080
	Plugin     string
	Categories []string
	IconDir    string // folder with the icons; empty for none
	TTL        time.Duration
	Client     *http.Client

	mu      sync.Mutex
	list    []App
	fetched time.Time
}

// Apps returns the cached list, refreshing it when it is older than the TTL.
// If Traefik does not answer, it keeps serving the last list it got.
func (s *Source) Apps(ctx context.Context) ([]App, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.list != nil && time.Since(s.fetched) < s.TTL {
		return s.list, nil
	}
	var routers []Router
	var middlewares []Middleware
	err := getAll(ctx, s.client(), s.API, "/api/http/routers", &routers)
	if err == nil {
		err = getAll(ctx, s.client(), s.API, "/api/http/middlewares", &middlewares)
	}
	if err != nil {
		if s.list != nil {
			return s.list, nil
		}
		return nil, err
	}
	s.list = Build(routers, middlewares, Options{
		Plugin:     s.Plugin,
		Categories: s.Categories,
		IconExists: s.iconExists,
	})
	s.fetched = time.Now()
	return s.list, nil
}

func (s *Source) iconExists(name string) bool {
	if s.IconDir == "" {
		return false
	}
	info, err := os.Stat(filepath.Join(s.IconDir, name))
	return err == nil && info.Mode().IsRegular()
}

func (s *Source) client() *http.Client {
	if s.Client != nil {
		return s.Client
	}
	return &http.Client{Timeout: 5 * time.Second}
}

const maxPages = 50

// getAll reads every page of a list from Traefik's API.
func getAll[T any](ctx context.Context, client *http.Client, api, path string, out *[]T) error {
	base, err := url.Parse(strings.TrimRight(api, "/") + path)
	if err != nil {
		return err
	}
	for page := 1; page <= maxPages; {
		u := *base
		u.RawQuery = url.Values{"per_page": {"100"}, "page": {strconv.Itoa(page)}}.Encode()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		if err != nil {
			return err
		}
		resp, err := client.Do(req)
		if err != nil {
			return err
		}
		var items []T
		err = json.NewDecoder(resp.Body).Decode(&items)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("API de Traefik %s: %s", path, resp.Status)
		}
		if err != nil {
			return fmt.Errorf("API de Traefik %s: %w", path, err)
		}
		*out = append(*out, items...)

		next, _ := strconv.Atoi(resp.Header.Get("X-Next-Page"))
		if next <= page {
			break
		}
		page = next
	}
	return nil
}
