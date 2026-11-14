# Menú del hub domótico

Menú común para todas las aplicaciones web de un hub domótico publicado con Traefik. Se entre por la aplicación que se entre, en un borde de la pantalla aparece un botón que abre la lista de aplicaciones, mientras la página de la aplicación carga con normalidad.

```
navegador ──► Traefik ──► aplicación
                 │
                 ├─ middleware "menu" en cada aplicación: en sus páginas HTML inserta
                 │    <script src="/__menu/menu.js" defer></script>
                 │
                 └─ /__menu/* en cualquier nombre ──► servicio domo-menu ──► API de Traefik
```

- **Plugin de Traefik:** middleware que se añade a cada aplicación y que inserta el script en sus páginas HTML. No toca la API, los fragmentos, los vídeos, las descargas ni los websockets de las aplicaciones.
- **Servicio:** sirve el script y la lista de aplicaciones que llevan el menú, que saca de la API de Traefik. Se publica bajo `/__menu/` en todos los nombres, para que el script sea del mismo origen que la aplicación.
- **Script:** pinta el botón y la ventana del menú dentro de un Shadow DOM, sin afectar a la aplicación.

## Funciones

| Función | Estado |
| --- | --- |
| Botón flotante pegado al borde, que se puede mover por todo el perímetro con ratón o dedo | Hecho |
| Misma posición del botón en todas las aplicaciones | Hecho |
| Ventana con las aplicaciones que llevan el menú, con su icono y la actual marcada | Hecho |
| Tema claro u oscuro, teclado; oculto en móviles | Hecho |
| Clasificar las aplicaciones por categorías | Segunda iteración |

El porqué de cada cosa está en [requisitos](docs/requisitos.md) y [decisiones](docs/decisiones.md), y el avance en el [plan](docs/plan.md).

## Configuración

La imagen es `ghcr.io/juanjoi/domo-menu:X.Y.Z`. Sirve a la vez para el servicio y para llevar el plugin a Traefik. El entorno de [dev/](dev/) es un ejemplo completo y funcional.

### Plugin

Traefik carga el plugin como plugin local desde un volumen. Un contenedor de la propia imagen lo copia ahí antes de que arranque Traefik:

```yaml
services:
  traefik:
    command:
      - --experimental.localplugins.menu.modulename=github.com/juanjoi/domo-menu
    volumes:
      - plugins:/plugins-local
    depends_on:
      plugin-menu:
        condition: service_completed_successfully

  plugin-menu:
    image: ghcr.io/juanjoi/domo-menu:X.Y.Z
    command: ["instalar-plugin", "/plugins-local"]
    volumes:
      - plugins:/plugins-local

volumes:
  plugins:
```

Traefik lee los plugins al arrancar: al cambiar de versión hay que reiniciarlo. Si no puede cargar el plugin, las rutas que usan el middleware dejan de responder; basta con quitárselo para recuperarlas.

El middleware se define en la configuración dinámica, junto con el de compresión:

```yaml
http:
  middlewares:
    menu:
      plugin:
        menu: {}
    compress:
      compress: {}
```

| Opción | Por defecto | Uso |
| --- | --- | --- |
| `scriptPath` | `/__menu/menu.js` | Dirección del script, en el mismo origen que la aplicación. |
| `maxHeadSize` | `131072` | Bytes que se leen buscando `</head>`. Si no aparece antes, la página pasa sin menú. |

### Aplicaciones

Cada aplicación que quiera el menú añade los dos middlewares a su ruta, **con `compress` antes que `menu`**, para que Traefik comprima la página ya con el script:

```yaml
labels:
  traefik.http.routers.miapp.middlewares: compress@file,menu@file
```

Las rutas declaradas en ficheros hacen lo mismo con `middlewares: [compress, menu]`. Poner el middleware añade la aplicación a la lista; quitarlo la saca.

### Servicio

El servicio necesita su ruta en todos los nombres, por encima de las de las aplicaciones y sin las cookies ni las credenciales de estas:

```yaml
http:
  middlewares:
    menu-sin-credenciales:
      headers:
        customRequestHeaders:
          Cookie: ""
          Authorization: ""
  routers:
    menu:
      rule: PathPrefix(`/__menu/`)
      priority: 1000000
      service: menu
      middlewares: [menu-sin-credenciales]
  services:
    menu:
      loadBalancer:
        servers:
          - url: http://menu:8080
```

Lee la API de Traefik por la entrada interna `traefik`, sin publicarla, que Traefik crea con `--api.insecure=true`. Si el panel ya se publica con su propia ruta, esa opción solo añade la entrada interna, que no debe publicarse.

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `MENU_API_TRAEFIK` | `http://traefik:8080` | Dirección de la API de Traefik. |
| `MENU_MIDDLEWARE` | `menu` | Middleware que marca las aplicaciones del menú. Sin `@proveedor`, vale cualquiera. |
| `MENU_DOMINIO` | | Dominio común de las aplicaciones. Vacío: el script lo deduce quitando el principio del nombre de la página. |
| `MENU_CACHE` | `30s` | Tiempo que se guarda la lista antes de volver a pedirla. |
| `MENU_DIRECCION` | `:8080` | Dirección en la que escucha. |

Las rutas `` HostRegexp(`^nombre\.`) `` se enlazan con el dominio de la página actual y las `` Host(`nombre.completo`) ``, tal cual.

## Desarrollo

Requiere Go, Node y Docker.

```sh
go test ./...                        # plugin, lista de aplicaciones y servicio
node --test script/menu.test.mjs     # funciones del script

docker compose -f dev/compose.yml up -d --build
dev/comprobar.sh                     # prueba de humo contra Traefik
```

El entorno local levanta Traefik en la misma versión que el hub, con el plugin instalado como en producción, el servicio y una aplicación de pruebas publicada con varios nombres. Cada nombre cubre un caso difícil: compresión, CSP, fragmentos HTML, iframes, websockets, descargas, una ruta declarada en fichero y otra sin menú. Se abre en el navegador en `http://sencilla.menu.localhost:8000`; cada página explica qué hay que comprobar en ella. El panel de Traefik está en `http://traefik.menu.localhost:8000/dashboard/`.

Al cambiar el plugin hay que reconstruir y reiniciar Traefik: `docker compose -f dev/compose.yml up -d --build && docker compose -f dev/compose.yml restart traefik`.

Una versión se publica etiquetando `vX.Y.Z`: GitHub Actions pasa las pruebas y la prueba de humo y sube la imagen.

## Licencia

[GPL v3](LICENSE).
