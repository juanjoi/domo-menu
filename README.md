# Menú del hub domótico

Menú común para todas las aplicaciones web de un hub domótico publicado con Traefik. Se entre por la aplicación que se entre, en un borde de la pantalla aparece un botón que abre la lista de aplicaciones, mientras la página de la aplicación carga con normalidad.

```
navegador ──► Traefik ──► aplicación
                 │
                 ├─ en las respuestas HTML inserta:
                 │    <script src="/__menu/menu.js"></script>
                 │
                 └─ /__menu/* en cualquier nombre ──► servicio domo-menu
```

- **Plugin de Traefik:** middleware que se añade a cada aplicación y que inserta el script en sus páginas HTML. No toca la API, los vídeos ni los websockets de las aplicaciones.
- **Servicio:** sirve el script y la lista de aplicaciones que llevan el menú, que saca de la API de Traefik. Se publica bajo `/__menu/` en todos los nombres, para que el script sea del mismo origen que la aplicación.
- **Script:** pinta el botón y la ventana del menú dentro de un Shadow DOM, sin afectar a la aplicación.

## Funciones

| Función | Estado |
| --- | --- |
| Botón flotante pegado al borde, que se puede mover por todo el perímetro | Pendiente |
| Ventana con todas las aplicaciones que llevan el menú | Pendiente |
| Clasificar las aplicaciones por categorías | Segunda iteración |

Requisitos y decisiones cerrados; el desarrollo sigue el [plan](docs/plan.md). Ver también [requisitos](docs/requisitos.md) y [decisiones](docs/decisiones.md).

## Licencia

GPL v3.
