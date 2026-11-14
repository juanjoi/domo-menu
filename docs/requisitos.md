# Requisitos

## Funcionales

| Id | Requisito |
| --- | --- |
| RF-01 | **Inyección.** Toda respuesta HTML que sirva Traefik incluye el script del menú, sin cambios en las aplicaciones. |
| RF-02 | **Exclusiones.** Se puede indicar en qué aplicaciones no se inyecta el script, por ejemplo un gestor de contraseñas. |
| RF-03 | **Botón pegado al borde.** El menú es un botón flotante pegado a un lateral de la pantalla, por encima de la aplicación, que sigue en su sitio al hacer scroll. |
| RF-04 | **Moverlo por el perímetro.** El botón se puede arrastrar, con ratón o con el dedo, a cualquier punto del perímetro de la pantalla, incluidas las esquinas, para que no tape nada de la aplicación. Al soltarlo se pega al borde más cercano: nunca queda separado del perímetro. |
| RF-05 | **Recordar la posición.** La posición del botón se recuerda y es la misma en todas las aplicaciones. |
| RF-06 | **Ventana de aplicaciones.** Al pulsar el botón se abre una ventana con todas las aplicaciones que sirve Traefik, incluidas las de infraestructura como el propio Traefik o el panel de gestión. Cada una es un enlace a su nombre, con el mismo dominio y esquema que la página actual. |
| RF-07 | **Lista automática.** La lista sale de las rutas de Traefik, incluidas las declaradas en ficheros y no solo las de etiquetas de Docker. Una aplicación nueva aparece sin darla de alta en el menú. Cada aplicación aparece una sola vez aunque tenga varios routers (por ejemplo, el que redirige de http a https). Quedan fuera la propia ruta del menú, los routers TCP y UDP y las reglas sin un nombre reconocible, como las de solo `PathPrefix`. |
| RF-08 | **Ocultar aplicaciones.** Se pueden ocultar aplicaciones de la lista, por ejemplo rutas técnicas o aplicaciones que no interesa ver. |
| RF-09 | **Aplicación actual.** La ventana marca la aplicación en la que se está. |
| RF-10 | **Dispositivos.** Aparece en escritorio y en tablet. En el móvil puede estorbar más que ayudar: por defecto no aparece, a falta de decidir si se puede activar. |
| RF-11 | **Categorías** (segunda iteración). Las aplicaciones se agrupan por categorías en la ventana. |
| RF-12 | **Solo en la ventana principal.** Si la página está dentro de un iframe, el script no pinta nada, para que el menú no aparezca dos veces cuando una aplicación incrusta otra. |

## No funcionales

| Id | Requisito |
| --- | --- |
| RNF-01 | **No romper la aplicación.** El menú se pinta dentro de un Shadow DOM, sin estilos ni variables globales. Si el script falla o no carga, la aplicación funciona igual. |
| RNF-02 | **Solo HTML.** El plugin solo modifica respuestas HTML completas de páginas, según un criterio explícito (P-11). La API, los fragmentos HTML que piden las propias aplicaciones, los ficheros, los vídeos, los websockets, las descargas, las peticiones HEAD, las respuestas 304 y las parciales pasan sin tocar y sin cargarse enteras en memoria. |
| RNF-03 | **Compresión.** El plugin funciona aunque la aplicación comprima sus respuestas, también con codificaciones que la librería estándar de Go no sabe descomprimir, como Brotli o zstd (P-10), y deja la longitud y las cabeceras de la respuesta coherentes. |
| RNF-04 | **Mismo origen.** El script se carga desde la propia dirección de la aplicación, bajo `/__menu/`, para que lo acepten las políticas de seguridad (CSP) que solo permiten scripts propios. Si una CSP lo bloquea igualmente, la aplicación funciona sin menú. |
| RNF-05 | **Servicio de solo lectura.** El servicio solo atiende peticiones GET, no tiene acceso a Docker y no recibe las cookies ni las cabeceras de autenticación de las aplicaciones, aunque las peticiones a `/__menu/` vayan al mismo origen: la ruta del menú quita esas cabeceras antes de llegar al servicio. La lista de aplicaciones se puede proteger por separado del script (P-12). |
| RNF-06 | **Ligero.** El script es pequeño y no tiene dependencias. La lista de aplicaciones se guarda en caché en el servicio. El plugin apenas añade latencia. |
| RNF-07 | **Accesible y táctil.** El botón y la ventana se manejan con teclado (Escape cierra la ventana) y tienen un tamaño táctil cómodo. Siguen el tema claro u oscuro del sistema. |
| RNF-08 | **Sin datos de la casa.** Ni el código ni la configuración por defecto incluyen dominios, IPs ni nombres de servicios concretos. Los enlaces se construyen con el dominio de la página actual. |
| RNF-09 | **Probado sin el servidor.** El repositorio incluye un entorno local (Traefik y un par de aplicaciones de prueba) para probar el plugin y el menú antes de desplegar: un fallo en Traefik deja sin web a todas las aplicaciones. Si Traefik no puede cargar el plugin, los routers que usan su middleware dejan de responder, así que la puesta en marcha es gradual y desactivarlo es inmediato (P-02). |

[← Volver al README](../README.md)
