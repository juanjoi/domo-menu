# Decisiones

## Tomadas

| Id | Decisión | Por qué |
| --- | --- | --- |
| D-01 | **Repositorio propio**, separado del panel de gestión | Cada aplicación propia tiene su repositorio. Además, el panel controla Docker sin login: si respondiera bajo `/__menu/` en todos los nombres, cualquier página de cualquier aplicación podría enviarle formularios que pasarían su comprobación de mismo origen. |
| D-02 | **Insertar un script con un plugin de Traefik**, no envolver las aplicaciones en un iframe | La mayoría de aplicaciones prohíben que las carguen en un iframe de otro origen. Con un iframe la dirección del navegador no reflejaría la aplicación, y no funcionaría al entrar directamente por el nombre de cada una. |
| D-03 | **Script en el mismo origen**, bajo `/__menu/`, con una ruta de Traefik de alta prioridad que lo envía al servicio en cualquier nombre | Las aplicaciones con CSP suelen permitir solo scripts de su propio origen; un script de otro nombre lo bloquearían. |
| D-04 | **Shadow DOM y JavaScript sin framework** para el menú | Aísla los estilos en los dos sentidos y mantiene el script pequeño. |
| D-05 | **Go con la librería estándar** para el plugin y el servicio | Traefik ejecuta los plugins en Go con un intérprete (Yaegi) que solo admite la librería estándar. El servicio sigue la misma línea. |
| D-06 | **La lista sale de la API de Traefik**, no de las etiquetas de Docker | Incluye las rutas declaradas en ficheros, como los servicios aún no migrados, y el servicio no necesita acceso a Docker. |
| D-07 | **Las rutas de los servicios miran solo el principio del nombre**, como en el resto del hub (`` HostRegexp(`^nombre\.`) ``) | El dominio no aparece en ningún repositorio: el menú construye los enlaces con el dominio de la página actual. Las reglas `` Host(`nombre.completo`) `` se enlazan tal cual. |
| D-08 | **Plugin local, copiado desde la imagen del servicio** a un volumen que Traefik monta (P-01) | Traefik no depende de Internet al arrancar, y el plugin y el servicio salen siempre de la misma versión. Traefik lee los plugins locales al arrancar: actualizar el plugin exige reiniciarlo. |
| D-09 | **Inyección por servicio**, no global (P-02) | Cada aplicación activa el menú con el middleware en sus etiquetas, y los servicios declarados en ficheros lo añaden en su fichero. Si Traefik no puede cargar el plugin, solo dejan de responder las aplicaciones que lo usan, no todas. Excluir una aplicación es no ponerle el middleware, así que el plugin no necesita lista de exclusiones. |
| D-10 | **Quitar `Accept-Encoding` en las peticiones de página** (P-10) | La librería estándar de Go no descomprime Brotli ni zstd. Sin `Accept-Encoding`, la aplicación responde sin comprimir, el plugin inserta el script y el middleware de compresión de Traefik vuelve a comprimir. Solo afecta a las páginas, que son pequeñas; el resto de respuestas conserva su compresión. |
| D-11 | **Solo navegaciones, con el script antes de `</head>`** (P-11) | Es página una petición GET con `Sec-Fetch-Dest: document` (o con `Accept` que incluya `text/html` si el navegador no envía esa cabecera) cuya respuesta es 200, `text/html` y sin `Content-Range`. Así quedan fuera los fragmentos HTML que piden las aplicaciones. El script se inserta con `defer` antes de `</head>`, que se busca en los primeros kilobytes para no cargar la página entera; si no aparece, la respuesta pasa sin tocar. |
| D-12 | **El servicio consulta la API de Traefik por una entrada interna sin publicar** (P-03) | Solo es accesible desde la red de Docker: no se expone nada nuevo hacia fuera ni depende de cómo esté protegido el panel de Traefik. |
| D-13 | **Script y lista públicos** (P-12) | La ruta `/__menu/` tiene prioridad sobre las de las aplicaciones y se salta su autenticación, así que cualquiera que llegue a cualquier nombre puede leer qué aplicaciones hay. Se acepta: la lista solo contiene nombres, sin datos ni accesos, y protegerla complicaría el despliegue. |
| D-14 | **No tocar las CSP en la primera versión** (P-09) | Ajustarlas desde el plugin rebajaría la seguridad de las aplicaciones. En el entorno de pruebas se anota qué aplicaciones bloquean el script; en esas no hay menú. |
| D-15 | **El script se revalida siempre** (`no-cache` con `ETag`) (P-15) | Su dirección es fija en todas las páginas. Revalidar hace que una versión nueva llegue al momento, y el script es tan pequeño que la respuesta 304 apenas cuesta. |
| D-16 | **La lista son las aplicaciones que llevan el middleware del menú** (P-04) | La API de Traefik indica qué middlewares usa cada router, así que el servicio lista los routers que usan el del menú. Todo se decide en cada stack: poner el middleware añade la aplicación a la lista y le inserta el script, y quitarlo la saca de las dos. No hace falta una lista de ocultas. A cambio, una aplicación sin script, como un gestor de contraseñas, no aparece en la lista. El nombre del middleware se indica en la configuración del servicio. |

## Pendientes

| Id | Pregunta | Opciones y recomendación |
| --- | --- | --- |
| P-05 | **Móvil** | Ocultarlo por debajo de un ancho de pantalla, o mostrarlo con una opción. Hay que decidir el umbral, y si en tablet en vertical sigue apareciendo. |
| P-06 | **Dónde se guarda la posición del botón** | *Cookie en el dominio común* de las aplicaciones: la misma posición en todas. *Almacenamiento local del navegador*: una posición por aplicación, porque cada nombre es un origen distinto. Recomendación: cookie en el dominio común, que cumple RF-05. |
| P-07 | **Idioma del código** | El panel de gestión usa identificadores en español; las aplicaciones más recientes, en inglés, y la interfaz de plugins de Traefik ya está en inglés. Recomendación: código en inglés, documentación e interfaz en español. |
| P-08 | **Qué se muestra de cada aplicación** | El principio del nombre (`jellyfin`), un nombre legible configurado aparte o el título de la página. Iconos: el favicon de cada aplicación o ninguno. Recomendación: el principio del nombre en la primera versión, y nombres e iconos con las categorías. |
| P-13 | **Dominio común para la cookie de la posición** | El script no sabe por sí solo cuál es el dominio común (`app.casa.example.co.uk` frente a `app.example.com`). *Deducirlo* quitando el principio del nombre, coherente con D-07. *Configurarlo* en el servicio, que se lo pasa al script. Recomendación: deducirlo, con la opción de fijarlo por configuración; si la página está en una IP o en un nombre sin dominio, la posición se guarda solo en ese origen. |
| P-14 | **Orden y apertura de los enlaces** | Orden alfabético o configurable. Abrir en la misma pestaña o en una nueva. Recomendación: alfabético y en la misma pestaña, como un menú de navegación; con Ctrl o Cmd el navegador ya abre en otra. |
| P-16 | **Versión de Traefik** | Para qué versión se desarrolla y se prueba el plugin. Recomendación: Traefik v3, la que se use en el hub, fijada en el entorno de pruebas. |
| P-17 | **Licencia** | El repositorio es público y no tiene licencia. Recomendación: MIT. |

[← Volver al README](../README.md)
