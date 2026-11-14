package web

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
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
	want := `{"domain":"example.com","position":"right:0.500","apps":[{"name":"a"},{"name":"b","host":"b.example.com"}]}`
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
