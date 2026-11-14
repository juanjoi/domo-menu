package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInstallPlugin(t *testing.T) {
	src := t.TempDir()
	os.WriteFile(filepath.Join(src, "menu.go"), []byte("package domomenu"), 0o644)
	os.WriteFile(filepath.Join(src, ".traefik.yml"), []byte("type: middleware"), 0o644)

	dir := t.TempDir()
	dst := filepath.Join(dir, "src", "github.com", "juanjoi", "domo-menu")
	os.MkdirAll(dst, 0o755)
	os.WriteFile(filepath.Join(dst, "viejo.go"), []byte("package domomenu"), 0o644)

	if err := installPlugin(src, dir); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"menu.go", ".traefik.yml"} {
		if _, err := os.Stat(filepath.Join(dst, name)); err != nil {
			t.Errorf("%s not installed: %v", name, err)
		}
	}
	if _, err := os.Stat(filepath.Join(dst, "viejo.go")); !os.IsNotExist(err) {
		t.Error("files from the previous version were kept")
	}
}
