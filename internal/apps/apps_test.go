package apps

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"sync/atomic"
	"testing"
	"time"
)

func TestFromRule(t *testing.T) {
	cases := []struct {
		rule string
		want []App
	}{
		{"HostRegexp(`^jellyfin\\.`)", []App{{Name: "jellyfin"}}},
		{"HostRegexp(`^jellyfin\\..+$`)", []App{{Name: "jellyfin"}}},
		{"Host(`Board.example.com`)", []App{{Name: "board", Host: "board.example.com"}}},
		{"Host(\"nas.lan\")", []App{{Name: "nas", Host: "nas.lan"}}},
		{"Host(`a.example.com`) || Host(`b.example.com`)", []App{{Name: "a", Host: "a.example.com"}, {Name: "b", Host: "b.example.com"}}},
		{"HostRegexp(`^fotos\\.`) && PathPrefix(`/api`)", []App{{Name: "fotos"}}},
		{"PathPrefix(`/__menu/`)", nil},
		{"HostRegexp(`.+`)", nil},
		{"HostRegexp(`^(a|b)\\.`)", nil},
		{"Host(`bad host`)", nil},
	}
	for _, c := range cases {
		if got := fromRule(c.rule); !reflect.DeepEqual(got, c.want) {
			t.Errorf("fromRule(%q) = %#v, want %#v", c.rule, got, c.want)
		}
	}
}

func menuMW(name string, cfg map[string]any) Middleware {
	return Middleware{Name: name, Type: "menu", Status: "enabled", Plugin: map[string]map[string]any{"menu": cfg}}
}

var categories = []string{"Infraestructura", "Familia", "Domótica"}

func TestBuild(t *testing.T) {
	middlewares := []Middleware{
		menuMW("menu@file", nil),
		menuMW("fotos-menu@docker", map[string]any{"categoria": "familia", "nombre": "Fotos", "icono": "fotos.svg"}),
		menuMW("luces-menu@docker", map[string]any{"categoria": "Domótica", "icono": "../secreto.svg"}),
		menuMW("raro-menu@docker", map[string]any{"categoria": "Inventada", "icono": "falta.svg"}),
		{Name: "compress@file", Type: "compress", Status: "enabled"},
		{Name: "roto@file", Type: "menu", Status: "disabled"},
	}
	routers := []Router{
		{Rule: "HostRegexp(`^zeta\\.`)", Status: "enabled", Middlewares: []string{"compress@file", "menu@file"}},
		{Rule: "HostRegexp(`^alfa\\.`)", Status: "enabled", Middlewares: []string{"menu@file"}},
		{Rule: "HostRegexp(`^immich\\.`)", Status: "enabled", Middlewares: []string{"compress@file", "fotos-menu@docker"}},
		{Rule: "HostRegexp(`^immich\\.`) && PathPrefix(`/api`)", Status: "enabled", Middlewares: []string{"menu@file"}},
		{Rule: "HostRegexp(`^ha\\.`)", Status: "enabled", Middlewares: []string{"luces-menu@docker"}},
		{Rule: "HostRegexp(`^raro\\.`)", Status: "enabled", Middlewares: []string{"raro-menu@docker"}},
		{Rule: "HostRegexp(`^secreto\\.`)", Status: "enabled", Middlewares: []string{"compress@file"}},
		{Rule: "HostRegexp(`^roto\\.`)", Status: "enabled", Middlewares: []string{"roto@file"}},
		{Rule: "HostRegexp(`^apagado\\.`)", Status: "disabled", Middlewares: []string{"menu@file"}},
		{Rule: "PathPrefix(`/__menu/`)", Status: "enabled"},
	}
	exists := func(name string) bool { return name == "fotos.svg" }
	got := Build(routers, middlewares, Options{Plugin: "menu", Categories: categories, IconExists: exists})
	want := []App{
		{Name: "immich", Title: "Fotos", Category: "Familia", Icon: "/__menu/iconos/fotos.svg"},
		{Name: "ha", Category: "Domótica"},
		{Name: "alfa"},
		{Name: "raro"},
		{Name: "zeta"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got  %#v\nwant %#v", got, want)
	}

	if got := Build(nil, nil, Options{Plugin: "menu"}); got == nil || len(got) != 0 {
		t.Fatalf("empty: got %#v, want empty non-nil list", got)
	}
}

func TestBuildSortsByTitle(t *testing.T) {
	middlewares := []Middleware{
		menuMW("a@file", map[string]any{"nombre": "Zorro"}),
		menuMW("b@file", map[string]any{"nombre": "abeja"}),
	}
	routers := []Router{
		{Rule: "HostRegexp(`^aaa\\.`)", Middlewares: []string{"a@file"}},
		{Rule: "HostRegexp(`^bbb\\.`)", Middlewares: []string{"b@file"}},
	}
	got := Build(routers, middlewares, Options{Plugin: "menu"})
	if got[0].Title != "abeja" || got[1].Title != "Zorro" {
		t.Fatalf("got %#v", got)
	}
}

func TestValidIconName(t *testing.T) {
	for _, ok := range []string{"jellyfin.svg", "home-assistant.png", "a_b.webp"} {
		if !ValidIconName(ok) {
			t.Errorf("%q rejected", ok)
		}
	}
	for _, bad := range []string{"", "../x.svg", "x/y.svg", "x.html", ".svg", "X.svg", "x.svg.js"} {
		if ValidIconName(bad) {
			t.Errorf("%q accepted", bad)
		}
	}
}

func fakeTraefik(t *testing.T, routers []Router, middlewares []Middleware, calls *atomic.Int32) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var items []any
		switch r.URL.Path {
		case "/api/http/routers":
			for _, x := range routers {
				items = append(items, x)
			}
		case "/api/http/middlewares":
			for _, x := range middlewares {
				items = append(items, x)
			}
		default:
			http.NotFound(w, r)
			return
		}
		calls.Add(1)
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		perPage, _ := strconv.Atoi(r.URL.Query().Get("per_page"))
		start := min((page-1)*perPage, len(items))
		end := min(start+perPage, len(items))
		next := 1
		if end < len(items) {
			next = page + 1
		}
		w.Header().Set("X-Next-Page", strconv.Itoa(next))
		json.NewEncoder(w).Encode(append([]any{}, items[start:end]...))
	}))
}

func TestSourcePaginatesAndCaches(t *testing.T) {
	var routers []Router
	for i := range 150 {
		routers = append(routers, Router{
			Rule:        "HostRegexp(`^app" + strconv.Itoa(i) + "\\.`)",
			Status:      "enabled",
			Middlewares: []string{"menu@file"},
		})
	}
	var calls atomic.Int32
	srv := fakeTraefik(t, routers, []Middleware{menuMW("menu@file", nil)}, &calls)
	defer srv.Close()

	s := &Source{API: srv.URL, Plugin: "menu", TTL: time.Minute}
	list, err := s.Apps(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 150 {
		t.Fatalf("got %d apps, want 150", len(list))
	}
	if calls.Load() != 3 {
		t.Fatalf("got %d calls, want 2 pages of routers and 1 of middlewares", calls.Load())
	}
	if _, err := s.Apps(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 3 {
		t.Fatalf("cache not used: %d calls", calls.Load())
	}
}

func TestSourceIcons(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "si.svg"), []byte("<svg/>"), 0o644)
	var calls atomic.Int32
	srv := fakeTraefik(t,
		[]Router{
			{Rule: "HostRegexp(`^a\\.`)", Middlewares: []string{"a@file"}},
			{Rule: "HostRegexp(`^b\\.`)", Middlewares: []string{"b@file"}},
		},
		[]Middleware{menuMW("a@file", map[string]any{"icono": "si.svg"}), menuMW("b@file", map[string]any{"icono": "no.svg"})},
		&calls)
	defer srv.Close()

	s := &Source{API: srv.URL, Plugin: "menu", IconDir: dir, TTL: time.Minute}
	list, err := s.Apps(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if list[0].Icon != "/__menu/iconos/si.svg" || list[1].Icon != "" {
		t.Fatalf("got %#v", list)
	}
}

func TestSourceKeepsLastListWhenTraefikFails(t *testing.T) {
	var calls atomic.Int32
	srv := fakeTraefik(t, []Router{{Rule: "HostRegexp(`^a\\.`)", Middlewares: []string{"menu@file"}}}, []Middleware{menuMW("menu@file", nil)}, &calls)

	s := &Source{API: srv.URL, Plugin: "menu", TTL: time.Nanosecond}
	if _, err := s.Apps(context.Background()); err != nil {
		t.Fatal(err)
	}
	srv.Close()
	list, err := s.Apps(context.Background())
	if err != nil || len(list) != 1 {
		t.Fatalf("got %v, %v; want the last list", list, err)
	}
}

func TestSourceErrorWithoutList(t *testing.T) {
	s := &Source{API: "http://127.0.0.1:1", Plugin: "menu", TTL: time.Minute}
	if _, err := s.Apps(context.Background()); err == nil {
		t.Fatal("want error")
	}
}
