// Package apps builds the menu list from the routers in Traefik's API.
package apps

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// App is a menu entry. Prefix applications, routed with HostRegexp(`^name\.`),
// only carry Name and the script builds the link with the domain of the
// current page. Applications routed with Host(`full.name`) also carry Host.
type App struct {
	Name string `json:"name"`
	Host string `json:"host,omitempty"`
}

// Router is the part of a Traefik HTTP router that the menu uses.
type Router struct {
	Name        string   `json:"name"`
	Rule        string   `json:"rule"`
	Status      string   `json:"status"`
	Middlewares []string `json:"middlewares"`
}

var (
	matcherRe = regexp.MustCompile("(HostRegexp|Host)\\(([^)]*)\\)")
	quotedRe  = regexp.MustCompile("`([^`]*)`|\"([^\"]*)\"")
	prefixRe  = regexp.MustCompile(`^\^([a-z0-9][a-z0-9-]*)\\\.`)
	hostRe    = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$`)
)

// FromRouters returns the applications behind the enabled routers that use
// the given middleware, without duplicates and sorted by name.
func FromRouters(routers []Router, middleware string) []App {
	seen := map[string]bool{}
	list := []App{}
	for _, r := range routers {
		if r.Status != "" && r.Status != "enabled" {
			continue
		}
		if !usesMiddleware(r.Middlewares, middleware) {
			continue
		}
		for _, app := range fromRule(r.Rule) {
			key := app.Name + "|" + app.Host
			if seen[key] {
				continue
			}
			seen[key] = true
			list = append(list, app)
		}
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].Name != list[j].Name {
			return list[i].Name < list[j].Name
		}
		return list[i].Host < list[j].Host
	})
	return list
}

// usesMiddleware matches "menu" against "menu", "menu@file", "menu@docker"...
// A name with a provider, such as "menu@file", only matches exactly.
func usesMiddleware(names []string, middleware string) bool {
	for _, n := range names {
		if n == middleware {
			return true
		}
		if !strings.Contains(middleware, "@") {
			if base, _, ok := strings.Cut(n, "@"); ok && base == middleware {
				return true
			}
		}
	}
	return false
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

// Source reads the routers from Traefik's API and caches the list.
type Source struct {
	API        string // base URL of Traefik's API, such as http://traefik:8080
	Middleware string
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
	routers, err := s.routers(ctx)
	if err != nil {
		if s.list != nil {
			return s.list, nil
		}
		return nil, err
	}
	s.list = FromRouters(routers, s.Middleware)
	s.fetched = time.Now()
	return s.list, nil
}

const maxPages = 50

func (s *Source) routers(ctx context.Context) ([]Router, error) {
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	base, err := url.Parse(strings.TrimRight(s.API, "/") + "/api/http/routers")
	if err != nil {
		return nil, err
	}
	var all []Router
	for page := 1; page <= maxPages; {
		u := *base
		u.RawQuery = url.Values{"per_page": {"100"}, "page": {strconv.Itoa(page)}}.Encode()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		if err != nil {
			return nil, err
		}
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		var routers []Router
		err = json.NewDecoder(resp.Body).Decode(&routers)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("API de Traefik: %s", resp.Status)
		}
		if err != nil {
			return nil, fmt.Errorf("API de Traefik: %w", err)
		}
		all = append(all, routers...)

		next, _ := strconv.Atoi(resp.Header.Get("X-Next-Page"))
		if next <= page {
			break
		}
		page = next
	}
	return all, nil
}
