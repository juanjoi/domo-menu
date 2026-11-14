#!/bin/sh
# Prueba de humo del entorno local: Traefik carga el plugin, inserta el
# script solo donde toca y el servicio devuelve la lista. Requiere el entorno
# levantado (docker compose -f dev/compose.yml up -d --build).
set -u
BASE=${BASE:-http://127.0.0.1:8000}
fallos=0

pide() { # app ruta destino [cabeceras curl...]
  app=$1; ruta=$2; destino=$3; shift 3
  curl -s -H "Host: $app.menu.localhost" -H "Sec-Fetch-Dest: $destino" -H "Accept: text/html" "$@" "$BASE$ruta"
}
comprueba() { # descripción resultado esperado
  if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "FALLO $1: '$2', se esperaba '$3'"; fallos=$((fallos + 1)); fi
}

# Traefik tarda unos segundos en leer las etiquetas de Docker.
for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: sencilla.menu.localhost' "$BASE/")" = 200 ] && break
  sleep 1
done

comprueba "página con script" "$(pide sencilla / document | grep -c '__menu/menu.js')" 1
comprueba "ruta de fichero con script" "$(pide fichero / document | grep -c '__menu/menu.js')" 1
comprueba "ruta con Host completo con script" "$(pide completo / document | grep -c '__menu/menu.js')" 1
comprueba "sin middleware, sin script" "$(pide sinmenu / document | grep -c '__menu/menu.js')" 0
comprueba "fragmento sin script" "$(pide fragmentos /fragmento empty | grep -c '__menu')" 0
comprueba "iframe sin script" "$(pide iframe / iframe | grep -c '__menu')" 0
comprueba "página comprimida por Traefik con script" \
  "$(pide sencilla / document -H 'Accept-Encoding: br, gzip' | gunzip -c | grep -c '__menu/menu.js')" 1
comprueba "eventos del servidor en streaming" \
  "$(pide websocket /eventos document -N -m 2 | grep -c 'evento 1')" 1
comprueba "descarga completa" "$(pide websocket /descarga document -o /dev/null -w '%{size_download}')" 209715200
comprueba "websocket" "$(curl -s -m 2 -N --http1.1 -H 'Host: websocket.menu.localhost' -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  "$BASE/ws" | grep -ac 'mensaje 1')" 1
comprueba "script servido" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: csp.menu.localhost' "$BASE/__menu/menu.js")" 200
comprueba "lista sin la aplicación sin middleware" \
  "$(curl -s -H 'Host: csp.menu.localhost' "$BASE/__menu/apps.json" | grep -c sinmenu)" 0
comprueba "lista con la ruta de fichero" \
  "$(curl -s -H 'Host: csp.menu.localhost' "$BASE/__menu/apps.json" | grep -c '"fichero"')" 1

[ "$fallos" -eq 0 ] && echo "Todo bien." || { echo "$fallos fallos."; exit 1; }
