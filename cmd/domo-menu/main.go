// Command domo-menu serves the hub menu and installs the Traefik plugin.
//
//	domo-menu [servir]              sirve el script y la lista de aplicaciones
//	domo-menu instalar-plugin DIR   copia el plugin a DIR, la carpeta de plugins locales de Traefik
//	domo-menu comprobar             comprueba que el servicio responde (healthcheck)
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/juanjoi/domo-menu/internal/apps"
	"github.com/juanjoi/domo-menu/internal/position"
	"github.com/juanjoi/domo-menu/internal/web"
	"github.com/juanjoi/domo-menu/script"
)

// pluginModule must match the import in .traefik.yml and the moduleName in
// Traefik's static configuration.
const pluginModule = "github.com/juanjoi/domo-menu"

// pluginSource is where the image keeps the plugin files.
const pluginSource = "/plugin"

func main() {
	cmd := "servir"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	var err error
	switch cmd {
	case "servir":
		err = serve()
	case "instalar-plugin":
		if len(os.Args) != 3 {
			err = errors.New("uso: domo-menu instalar-plugin DIR")
			break
		}
		err = installPlugin(pluginSource, os.Args[2])
	case "comprobar":
		err = check()
	default:
		err = fmt.Errorf("orden desconocida %q: servir, instalar-plugin o comprobar", cmd)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "domo-menu:", err)
		os.Exit(1)
	}
}

func env(name, def string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return def
}

func serve() error {
	ttl, err := time.ParseDuration(env("MENU_CACHE", "30s"))
	if err != nil {
		return fmt.Errorf("MENU_CACHE: %w", err)
	}
	addr := env("MENU_DIRECCION", ":8080")
	source := &apps.Source{
		API:        env("MENU_API_TRAEFIK", "http://traefik:8080"),
		Middleware: env("MENU_MIDDLEWARE", "menu"),
		TTL:        ttl,
	}
	pos := &position.Store{}
	if dir := env("MENU_DATOS", "/datos"); dir != "" {
		pos.File = position.FileIn(dir)
	}
	pos.Load()

	srv := &http.Server{
		Addr: addr,
		Handler: web.Handler(web.Config{
			Script:   script.JS,
			Apps:     source,
			Position: pos,
			Domain:   os.Getenv("MENU_DOMINIO"),
		}),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()

	slog.Info("domo-menu escuchando", "direccion", addr, "api", source.API, "middleware", source.Middleware, "posicion", pos.File)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// installPlugin replaces the plugin in Traefik's local plugins folder with
// the files in src.
func installPlugin(src, dir string) error {
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	dst := filepath.Join(dir, "src", filepath.FromSlash(pluginModule))
	if err := os.RemoveAll(dst); err != nil {
		return err
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	for _, e := range entries {
		if !e.Type().IsRegular() {
			continue
		}
		if err := copyFile(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
			return err
		}
	}
	fmt.Println("plugin instalado en", dst)
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

func check() error {
	_, port, err := net.SplitHostPort(env("MENU_DIRECCION", ":8080"))
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/__menu/salud")
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("salud: %s", resp.Status)
	}
	return nil
}
