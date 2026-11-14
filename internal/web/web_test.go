package web

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/juanjoi/domo-menu/internal/apps"
	"github.com/juanjoi/domo-menu/internal/position"
)

type fakeApps struct {
	list []apps.App
	err  error
}

func (f fakeApps) Apps(context.Context) ([]apps.App, error) { return f.list, f.err }

func do(h http.Handler, method, path string, header map[string]string) *httptest.ResponseRecorder {
	return doBody(h, method, path, "", header)
}

func doBody(h http.Handler, method, path, body string, header map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	for k, v := range header {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestScript(t *testing.T) {
	h := Handler(Config{Script: []byte("console.log(1)"), Apps: fakeApps{}, Position: &position.Store{}})
	rec := do(h, "GET", "/__menu/menu.js", nil)
	if rec.Code != 200 || rec.Body.String() != "console.log(1)" {
		t.Fatalf("code %d, body %q", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Cache-Control") != "no-cache" || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/javascript") {
		t.Fatalf("headers %v", rec.Header())
	}
	rec = do(h, "GET", "/__menu/menu.js", map[string]string{"If-None-Match": rec.Header().Get("ETag")})
	if rec.Code != http.StatusNotModified {
		t.Fatalf("revalidation: code %d", rec.Code)
	}
}

func TestApps(t *testing.T) {
	h := Handler(Config{Apps: fakeApps{list: []apps.App{{Name: "a"}, {Name: "b", Host: "b.example.com"}}}, Domain: "example.com", Position: &position.Store{}})
	rec := do(h, "GET", "/__menu/apps.json", nil)
	want := `{"domain":"example.com","position":"right:0.500","categories":[],"apps":[{"name":"a"},{"name":"b","host":"b.example.com"}]}`
	if rec.Code != 200 || rec.Body.String() != want {
		t.Fatalf("code %d, body %s", rec.Code, rec.Body.String())
	}
}

func TestAppsUnavailable(t *testing.T) {
	h := Handler(Config{Apps: fakeApps{err: errors.New("caído")}, Position: &position.Store{}})
	if rec := do(h, "GET", "/__menu/apps.json", nil); rec.Code != http.StatusBadGateway {
		t.Fatalf("code %d", rec.Code)
	}
}

func TestOnlyGet(t *testing.T) {
	h := Handler(Config{Script: []byte("x"), Apps: fakeApps{}, Position: &position.Store{}})
	for _, path := range []string{"/__menu/menu.js", "/__menu/apps.json", "/__menu/salud", "/__menu/posicion"} {
		if rec := do(h, "POST", path, nil); rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("POST %s: code %d", path, rec.Code)
		}
	}
	if rec := do(h, "GET", "/__menu/otro", nil); rec.Code != http.StatusNotFound {
		t.Errorf("unknown path: code %d", rec.Code)
	}
}

func TestPosition(t *testing.T) {
	store := &position.Store{}
	h := Handler(Config{Apps: fakeApps{}, Position: store})

	if rec := doBody(h, "PUT", "/__menu/posicion", "left:0.25", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("PUT: code %d", rec.Code)
	}
	if store.Get() != "left:0.250" {
		t.Fatalf("stored %q", store.Get())
	}
	if rec := do(h, "GET", "/__menu/apps.json", nil); !strings.Contains(rec.Body.String(), `"position":"left:0.250"`) {
		t.Fatalf("list without position: %s", rec.Body.String())
	}
	if rec := doBody(h, "PUT", "/__menu/posicion", "<script>", nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid PUT: code %d", rec.Code)
	}
	if rec := doBody(h, "PUT", "/__menu/posicion", "left:0.25"+strings.Repeat(" ", 100), nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("long PUT: code %d", rec.Code)
	}
	if store.Get() != "left:0.250" {
		t.Fatalf("invalid values changed it: %q", store.Get())
	}
}

func TestCategories(t *testing.T) {
	h := Handler(Config{Apps: fakeApps{list: []apps.App{{Name: "a", Category: "Familia"}}}, Categories: []string{"Familia", "Domótica"}, Position: &position.Store{}})
	rec := do(h, "GET", "/__menu/apps.json", nil)
	if !strings.Contains(rec.Body.String(), `"categories":["Familia","Domótica"]`) || !strings.Contains(rec.Body.String(), `"category":"Familia"`) {
		t.Fatalf("body %s", rec.Body.String())
	}
}

func TestIcons(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "a.svg"), []byte("<svg/>"), 0o644)
	os.WriteFile(filepath.Join(dir, "b.png"), []byte("png"), 0o644)
	os.WriteFile(filepath.Join(dir, "c.html"), []byte("<script>"), 0o644)
	os.Mkdir(filepath.Join(dir, "d.svg"), 0o755)
	h := Handler(Config{Apps: fakeApps{}, Position: &position.Store{}, IconDir: dir})

	rec := do(h, "GET", "/__menu/iconos/a.svg", nil)
	if rec.Code != 200 || rec.Body.String() != "<svg/>" || rec.Header().Get("Content-Type") != "image/svg+xml" {
		t.Fatalf("svg: code %d, %v", rec.Code, rec.Header())
	}
	if !strings.Contains(rec.Header().Get("Content-Security-Policy"), "sandbox") {
		t.Fatal("svg without restrictive CSP")
	}
	if rec := do(h, "GET", "/__menu/iconos/b.png", nil); rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("png: %v", rec.Header())
	}
	for _, path := range []string{"/__menu/iconos/c.html", "/__menu/iconos/no.svg", "/__menu/iconos/d.svg", "/__menu/iconos/..%2Fweb.go", "/__menu/iconos/"} {
		if rec := do(h, "GET", path, nil); rec.Code != http.StatusNotFound {
			t.Errorf("%s: code %d", path, rec.Code)
		}
	}
	if rec := do(Handler(Config{Apps: fakeApps{}, Position: &position.Store{}}), "GET", "/__menu/iconos/a.svg", nil); rec.Code != http.StatusNotFound {
		t.Errorf("without icon folder: code %d", rec.Code)
	}
}
