package apps

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func TestFromRouters(t *testing.T) {
	routers := []Router{
		{Name: "zeta@docker", Rule: "HostRegexp(`^zeta\\.`)", Status: "enabled", Middlewares: []string{"compress@file", "menu@file"}},
		{Name: "alfa@docker", Rule: "HostRegexp(`^alfa\\.`)", Status: "enabled", Middlewares: []string{"menu@docker"}},
		{Name: "alfa-http@docker", Rule: "HostRegexp(`^alfa\\.`)", Status: "enabled", Middlewares: []string{"menu@file"}},
		{Name: "secret@docker", Rule: "HostRegexp(`^secret\\.`)", Status: "enabled", Middlewares: []string{"compress@file"}},
		{Name: "broken@docker", Rule: "HostRegexp(`^broken\\.`)", Status: "disabled", Middlewares: []string{"menu@file"}},
		{Name: "other@docker", Rule: "HostRegexp(`^other\\.`)", Status: "enabled", Middlewares: []string{"menuextra@file"}},
		{Name: "menu@file", Rule: "PathPrefix(`/__menu/`)", Status: "enabled"},
	}
	want := []App{{Name: "alfa"}, {Name: "zeta"}}
	if got := FromRouters(routers, "menu"); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}

	want = []App{{Name: "alfa"}}
	if got := FromRouters(routers, "menu@docker"); !reflect.DeepEqual(got, want) {
		t.Fatalf("with provider: got %#v, want %#v", got, want)
	}

	if got := FromRouters(nil, "menu"); got == nil || len(got) != 0 {
		t.Fatalf("empty: got %#v, want empty non-nil list", got)
	}
}

func fakeTraefik(t *testing.T, routers []Router, calls *atomic.Int32) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/http/routers" {
			http.NotFound(w, r)
			return
		}
		calls.Add(1)
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		perPage, _ := strconv.Atoi(r.URL.Query().Get("per_page"))
		start := (page - 1) * perPage
		end := min(start+perPage, len(routers))
		next := 1
		if end < len(routers) {
			next = page + 1
		}
		w.Header().Set("X-Next-Page", strconv.Itoa(next))
		json.NewEncoder(w).Encode(routers[start:end])
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
	srv := fakeTraefik(t, routers, &calls)
	defer srv.Close()

	s := &Source{API: srv.URL, Middleware: "menu", TTL: time.Minute}
	list, err := s.Apps(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 150 {
		t.Fatalf("got %d apps, want 150", len(list))
	}
	if calls.Load() != 2 {
		t.Fatalf("got %d calls, want 2 pages", calls.Load())
	}
	if _, err := s.Apps(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("cache not used: %d calls", calls.Load())
	}
}

func TestSourceKeepsLastListWhenTraefikFails(t *testing.T) {
	var calls atomic.Int32
	srv := fakeTraefik(t, []Router{{Rule: "HostRegexp(`^a\\.`)", Middlewares: []string{"menu"}}}, &calls)

	s := &Source{API: srv.URL, Middleware: "menu", TTL: time.Nanosecond}
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
	s := &Source{API: "http://127.0.0.1:1", Middleware: "menu", TTL: time.Minute}
	if _, err := s.Apps(context.Background()); err == nil {
		t.Fatal("want error")
	}
}
