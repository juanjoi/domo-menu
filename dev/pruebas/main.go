// Aplicación de pruebas del entorno local. Se comporta de una forma u otra
// según el principio del nombre por el que se entra, para cubrir los casos
// difíciles del plugin y del menú.
package main

import (
	"bufio"
	"compress/gzip"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"html"
	"log"
	"net/http"
	"strings"
	"time"
)

var descriptions = map[string]string{
	"sencilla":   "Página sencilla y larga, para probar el scroll.",
	"compresion": "La aplicación comprime con gzip si se lo piden. El plugin quita el Accept-Encoding del navegador; el proxy de Traefik pide gzip por su cuenta y descomprime él mismo, así que como mucho llega gzip, nunca Brotli ni zstd.",
	"csp":        "CSP con default-src 'self': el script del menú carga, pero los iconos de otras aplicaciones no (se ve la inicial).",
	"cspnonce":   "CSP que solo admite scripts con nonce: el script del menú se bloquea y la página funciona sin menú.",
	"fragmentos": "Carga un fragmento HTML con fetch. El fragmento no debe llevar el script. Sin favicon.",
	"iframe":     "Incrusta otra aplicación en un iframe. El menú solo debe aparecer una vez.",
	"websocket":  "Abre un websocket y recibe mensajes. También enlaza a una descarga grande y a eventos del servidor.",
	"completo":   "Ruta con Host(`nombre.completo`) en vez de HostRegexp.",
	"fichero":    "Ruta declarada en el fichero de configuración de Traefik, no en etiquetas.",
	"sinmenu":    "Sin el middleware del menú: no aparece en la lista y no lleva el script.",
}

var colors = []string{"#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c", "#0891b2", "#ca8a04", "#db2777"}

func appName(r *http.Request) string {
	name, _, _ := strings.Cut(r.Host, ".")
	return name
}

func main() {
	http.HandleFunc("/", page)
	http.HandleFunc("/favicon.ico", favicon)
	http.HandleFunc("/fragmento", fragment)
	http.HandleFunc("/ws", websocket)
	http.HandleFunc("/descarga", download)
	http.HandleFunc("/eventos", events)
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func page(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	name := appName(r)
	ae := r.Header.Get("Accept-Encoding")
	if ae == "" {
		ae = "(ninguno)"
	}

	var extra string
	switch name {
	case "csp":
		w.Header().Set("Content-Security-Policy", "default-src 'self'")
	case "cspnonce":
		w.Header().Set("Content-Security-Policy", "script-src 'nonce-pruebas'; default-src 'self'")
		extra = `<p id="estado">El script propio de la página no ha cargado.</p>
<script nonce="pruebas">document.getElementById('estado').textContent = 'El script propio de la página funciona.';</script>`
	case "fragmentos":
		extra = `<button id="cargar">Cargar fragmento</button><div id="destino"></div>
<script>
document.getElementById('cargar').onclick = async () => {
  const html = await (await fetch('/fragmento')).text();
  document.getElementById('destino').innerHTML = html +
    '<p>El fragmento ' + (html.includes('__menu') ? '<strong>LLEVA</strong>' : 'no lleva') + ' el script.</p>';
};
</script>`
	case "iframe":
		extra = `<iframe src="/" style="width:100%;height:300px" title="iframe"></iframe>`
		if r.Header.Get("Sec-Fetch-Dest") == "iframe" {
			extra = "<p>Esto es el contenido del iframe.</p>"
		}
	case "websocket":
		extra = `<p id="ws">Conectando…</p>
<p><a href="/descarga" download>Descarga de 200 MB</a> · <a href="/eventos">Eventos del servidor</a></p>
<script>
const out = document.getElementById('ws');
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
ws.onmessage = (e) => { out.textContent = 'Websocket: ' + e.data; };
ws.onerror = () => { out.textContent = 'Websocket: error'; };
</script>`
	}

	body := fmt.Sprintf(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%[1]s</title>
<link rel="stylesheet" href="data:,">
</head>
<body style="font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem">
<h1>%[1]s</h1>
<p>%[2]s</p>
<p>Accept-Encoding recibido por la aplicación: <code>%[3]s</code></p>
%[4]s
%[5]s
</body>
</html>
`, html.EscapeString(name), html.EscapeString(descriptions[name]), html.EscapeString(ae), extra, filler(name))

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if name == "compresion" && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		w.Header().Set("Content-Encoding", "gzip")
		gz := gzip.NewWriter(w)
		defer gz.Close()
		fmt.Fprint(gz, body)
		return
	}
	fmt.Fprint(w, body)
}

func filler(name string) string {
	if name != "sencilla" {
		return ""
	}
	var b strings.Builder
	for i := 1; i <= 60; i++ {
		fmt.Fprintf(&b, "<p>Párrafo %d de relleno para probar que el botón sigue en su sitio al hacer scroll.</p>\n", i)
	}
	return b.String()
}

func favicon(w http.ResponseWriter, r *http.Request) {
	name := appName(r)
	if name == "fragmentos" || name == "" {
		http.NotFound(w, r)
		return
	}
	color := colors[int(name[0])%len(colors)]
	w.Header().Set("Content-Type", "image/svg+xml")
	fmt.Fprintf(w, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="%s"/><text x="8" y="12" font-size="11" font-family="sans-serif" text-anchor="middle" fill="#fff">%s</text></svg>`,
		color, strings.ToUpper(name[:1]))
}

func fragment(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, `<html><head></head><body><p>Fragmento cargado a las `+time.Now().Format("15:04:05")+`.</p></body></html>`)
}

func download(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="grande.bin"`)
	chunk := make([]byte, 1<<20)
	for i := 0; i < 200; i++ {
		if _, err := w.Write(chunk); err != nil {
			return
		}
	}
}

func events(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	flusher, _ := w.(http.Flusher)
	for i := 1; i <= 10; i++ {
		fmt.Fprintf(w, "data: evento %d a las %s\n\n", i, time.Now().Format("15:04:05"))
		if flusher != nil {
			flusher.Flush()
		}
		select {
		case <-r.Context().Done():
			return
		case <-time.After(time.Second):
		}
	}
}

// websocket implementa lo mínimo del protocolo: el saludo y mensajes de
// texto cortos del servidor.
func websocket(w http.ResponseWriter, r *http.Request) {
	key := r.Header.Get("Sec-WebSocket-Key")
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") || key == "" {
		http.Error(w, "se esperaba un websocket", http.StatusBadRequest)
		return
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "sin hijack", http.StatusInternalServerError)
		return
	}
	conn, rw, err := hj.Hijack()
	if err != nil {
		return
	}
	defer conn.Close()

	sum := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	fmt.Fprintf(rw, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n",
		base64.StdEncoding.EncodeToString(sum[:]))
	rw.Flush()

	for i := 1; i <= 30; i++ {
		if err := sendText(rw.Writer, fmt.Sprintf("mensaje %d a las %s", i, time.Now().Format("15:04:05"))); err != nil {
			return
		}
		time.Sleep(time.Second)
	}
}

func sendText(w *bufio.Writer, msg string) error {
	w.WriteByte(0x81) // FIN y texto
	w.WriteByte(byte(len(msg)))
	w.WriteString(msg)
	return w.Flush()
}
