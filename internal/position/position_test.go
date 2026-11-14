package position

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalize(t *testing.T) {
	ok := map[string]string{
		"right:0.5":   "right:0.500",
		"left:0":      "left:0.000",
		"top:1":       "top:1.000",
		"bottom:0.25": "bottom:0.250",
		" left:0.1\n": "left:0.100",
	}
	for in, want := range ok {
		if got, err := Normalize(in); err != nil || got != want {
			t.Errorf("Normalize(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{"", "arriba:0.5", "left:1.5", "left:-0.1", "left:0.1234", "left:0.5;x", "left"} {
		if _, err := Normalize(in); err == nil {
			t.Errorf("Normalize(%q) accepted", in)
		}
	}
}

func TestStorePersists(t *testing.T) {
	file := FileIn(t.TempDir())
	s := &Store{File: file}
	s.Load()
	if s.Get() != Default {
		t.Fatalf("initial = %q", s.Get())
	}
	if err := s.Set("left:0.25"); err != nil {
		t.Fatal(err)
	}
	if err := s.Set("nada"); err == nil {
		t.Fatal("invalid value accepted")
	}

	again := &Store{File: file}
	again.Load()
	if again.Get() != "left:0.250" {
		t.Fatalf("reloaded = %q", again.Get())
	}
}

func TestStoreBadFile(t *testing.T) {
	file := filepath.Join(t.TempDir(), "posicion")
	os.WriteFile(file, []byte("basura"), 0o644)
	s := &Store{File: file}
	s.Load()
	if s.Get() != Default {
		t.Fatalf("got %q", s.Get())
	}
}

func TestStoreUnwritableKeepsMemory(t *testing.T) {
	s := &Store{File: filepath.Join(t.TempDir(), "no", "existe", "posicion")}
	s.Load()
	if err := s.Set("top:0.5"); err == nil {
		t.Fatal("want write error")
	}
	if s.Get() != "top:0.500" {
		t.Fatalf("got %q", s.Get())
	}
}
