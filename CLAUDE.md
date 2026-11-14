# domo-menu

Menú común para todas las aplicaciones web del hub domótico. Traefik inserta un script en cada página HTML que sirve, y ese script pinta un botón flotante pegado al borde de la pantalla que abre la lista de aplicaciones. Repositorio público: no debe contener datos de ninguna casa concreta (nombres de servicios, dominios, IPs ni secretos).

Antes de escribir código, leer `docs/requisitos.md`, `docs/decisiones.md` y `docs/plan.md`. El desarrollo sigue las fases del plan; una decisión nueva se cierra con el usuario y se anota antes de construirla.

## Convenciones

- En español: documentación, mensajes de commit y textos de la interfaz.
- Los requisitos viven en `docs/requisitos.md` con identificadores (`RF-xx`, `RNF-xx`). Un cambio de alcance se refleja ahí antes que en el código.
- Las decisiones, tomadas o pendientes, van en `docs/decisiones.md` con su porqué.
- Go con la librería estándar para el plugin de Traefik y el servicio; JavaScript sin framework ni dependencias para el script del menú. Cualquier dependencia externa necesita un motivo claro.
- Versiones con etiquetas `vX.Y.Z`. GitHub Actions publica la imagen en GitHub Container Registry al etiquetar.
- Este repositorio no sabe nada de la casa: el despliegue (stack del servicio y cambios en Traefik) va en el repositorio de despliegue, que no se enlaza desde aquí.

## Estructura

- `README.md`: qué es, funciones y su estado, desarrollo y configuración.
- `docs/requisitos.md`: requisitos funcionales y no funcionales.
- `docs/decisiones.md`: decisiones tomadas y pendientes.
- `docs/plan.md`: fases hasta la primera versión.
- `menu.go`, `.traefik.yml`: el plugin de Traefik, en la raíz del módulo porque así lo exige Traefik para los plugins locales. Solo librería estándar y construcciones sencillas: lo ejecuta Yaegi.
- `cmd/domo-menu/`: el ejecutable (`servir`, `instalar-plugin`, `comprobar`).
- `internal/apps/`: lista de aplicaciones a partir de la API de Traefik.
- `internal/web/`: rutas HTTP del servicio.
- `script/`: el script del menú, embebido en el servicio, y sus pruebas con Node.
- `dev/`: entorno local con Traefik y una aplicación de pruebas, y `comprobar.sh`, la prueba de humo. Cualquier cambio en el plugin se prueba ahí, no solo con `go test`.
