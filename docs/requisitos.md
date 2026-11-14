# Requisitos

## Funcionales

| Id | Requisito |
| --- | --- |
| RF-01 | **Inyección.** Las páginas HTML de las aplicaciones que activan el menú incluyen su script, sin cambios en el código de las aplicaciones: basta con añadir un middleware de Traefik a su ruta (D-09). |
| RF-02 | **Exclusiones.** Una aplicación puede no llevar el script, por ejemplo un gestor de contraseñas: basta con no ponerle el middleware. Entonces tampoco aparece en la lista (D-16). |
| RF-03 | **Botón pegado al borde.** El menú es un botón flotante pegado a un lateral de la pantalla, por encima de la aplicación, que sigue en su sitio al hacer scroll. |
| RF-04 | **Moverlo por el perímetro.** El botón se puede arrastrar, con ratón o con el dedo, a cualquier punto del perímetro de la pantalla, incluidas las esquinas, para que no tape nada de la aplicación. Al soltarlo se pega al borde más cercano: nunca queda separado del perímetro. |
| RF-05 | **Recordar la posición.** La posición del botón se recuerda y es la misma en todas las aplicaciones (D-18). |
| RF-06 | **Ventana de aplicaciones.** Al pulsar el botón se abre una ventana con todas las aplicaciones que llevan el menú, incluidas las de infraestructura como el propio Traefik o el panel de gestión si se les pone el middleware. Cada una se muestra con el principio de su nombre y su icono (D-19), en orden alfabético, y es un enlace a su nombre, con el mismo dominio y esquema que la página actual, que se abre en la misma pestaña (D-20). |
| RF-07 | **Lista automática.** La lista sale de las rutas de Traefik que usan el middleware del menú, incluidas las declaradas en ficheros y no solo las de etiquetas de Docker (D-16). Una aplicación nueva aparece al ponerle el middleware, sin darla de alta en el servicio. Cada aplicación aparece una sola vez aunque tenga varios routers (por ejemplo, el que redirige de http a https). Quedan fuera la propia ruta del menú, los routers TCP y UDP y las reglas sin un nombre reconocible, como las de solo `PathPrefix`. |
| RF-08 | **Sin rutas técnicas.** Las rutas que no son aplicaciones, como la del propio menú, no aparecen. Para sacar una aplicación de la lista basta con quitarle el middleware (D-16). |
| RF-09 | **Aplicación actual.** La ventana marca la aplicación en la que se está. |
| RF-10 | **Dispositivos.** Aparece en escritorio y en tablet, en cualquier orientación. En el móvil no aparece (D-17). |
| RF-11 | **Categorías** (segunda iteración). Las aplicaciones se agrupan por categorías en la ventana. |
| RF-12 | **Solo en la ventana principal.** Si la página está dentro de un iframe, el script no pinta nada, para que el menú no aparezca dos veces cuando una aplicación incrusta otra. |

## No funcionales

| Id | Requisito |
| --- | --- |
| RNF-01 | **No romper la aplicación.** El menú se pinta dentro de un Shadow DOM, sin estilos ni variables globales. Si el script falla o no carga, la aplicación funciona igual. |
| RNF-02 | **Solo HTML.** El plugin solo modifica respuestas HTML completas de páginas, según el criterio de D-11. La API, los fragmentos HTML que piden las propias aplicaciones, los ficheros, los vídeos, los websockets, las descargas, las peticiones HEAD, las respuestas 304 y las parciales pasan sin tocar y sin cargarse enteras en memoria. |
| RNF-03 | **Compresión.** El plugin funciona aunque la aplicación comprima sus respuestas, también con codificaciones que la librería estándar de Go no sabe descomprimir, como Brotli o zstd (D-10), y deja la longitud y las cabeceras de la respuesta coherentes. |
| RNF-04 | **Mismo origen.** El script se carga desde la propia dirección de la aplicación, bajo `/__menu/`, para que lo acepten las políticas de seguridad (CSP) que solo permiten scripts propios. Si una CSP lo bloquea igualmente, la aplicación funciona sin menú. |
| RNF-05 | **Servicio de solo lectura.** El servicio solo atiende peticiones GET, no tiene acceso a Docker y no recibe las cookies ni las cabeceras de autenticación de las aplicaciones, aunque las peticiones a `/__menu/` vayan al mismo origen: la ruta del menú quita esas cabeceras antes de llegar al servicio. |
| RNF-06 | **Ligero.** El script es pequeño y no tiene dependencias. La lista de aplicaciones se guarda en caché en el servicio. El plugin apenas añade latencia. |
| RNF-07 | **Accesible y táctil.** El botón y la ventana se manejan con teclado (Escape cierra la ventana) y tienen un tamaño táctil cómodo. Siguen el tema claro u oscuro del sistema. |
| RNF-08 | **Sin datos de la casa.** Ni el código ni la configuración por defecto incluyen dominios, IPs ni nombres de servicios concretos. Los enlaces se construyen con el dominio de la página actual. |
| RNF-09 | **Probado sin el servidor.** El repositorio incluye un entorno local (Traefik y un par de aplicaciones de prueba) para probar el plugin y el menú antes de desplegar: un fallo en Traefik deja sin web a todas las aplicaciones. Si Traefik no puede cargar el plugin, los routers que usan su middleware dejan de responder, así que quitar el middleware de una aplicación tiene que ser inmediato (D-09). |

[← Volver al README](../README.md)
