# Plan

Pasos hasta la primera versión, en orden. Cada fase termina con algo que se puede probar. El despliegue en la casa no está aquí: va en el repositorio de despliegue.

## 0. Cerrar decisiones

Hecho: todas las decisiones están en [decisiones](decisiones.md), de D-08 a D-23. D-08 condiciona la estructura del repositorio: un plugin local tiene que estar en la raíz de un módulo de Go con su `.traefik.yml`, y la imagen del servicio lleva una copia de ese código para dejarla en el volumen de Traefik.

## 1. Esqueleto y entorno de pruebas

- Licencia GPL v3, `.gitignore` y módulo de Go (D-21, D-23).
- Entorno local con Docker Compose (RNF-09): Traefik en la misma versión que el hub (D-22), el plugin cargado como plugin local y aplicaciones de prueba que cubran los casos difíciles:
  - una página sencilla;
  - una que comprime con gzip y otra con Brotli;
  - una con CSP estricta, también para imágenes;
  - una que pide fragmentos HTML;
  - una que incrusta otra en un iframe;
  - una con websockets y descargas grandes;
  - una ruta declarada en fichero, además de las de etiquetas.
- GitHub Actions: pruebas en cada push.

## 2. Plugin

- Detectar las páginas según D-11 y dejar pasar todo lo demás sin tocar ni cargarlo en memoria (RNF-02).
- Insertar el script antes de `</head>` y ajustar la longitud y las cabeceras (RNF-03).
- Quitar `Accept-Encoding` en las peticiones de página (D-10).
- Pruebas unitarias con `httptest` y prueba en el entorno local, porque Traefik ejecuta el plugin con un intérprete que no admite todo lo que admite el compilador.

Resultado: el entorno local inserta una etiqueta de script en todas las páginas de prueba sin romper ninguna.

## 3. Servicio

- Solo GET (RNF-05). Sirve el script, embebido en el binario, con la caché de D-15.
- Lista de aplicaciones a partir de la API de Traefik, consultada por una entrada interna (RF-07, D-06, D-12):
  - solo los routers que usan el middleware del menú, cuyo nombre va en la configuración (D-16);
  - quitar duplicados, los routers TCP y UDP y las reglas sin nombre;
  - sacar el principio del nombre de `HostRegexp` y el nombre completo de `Host` (D-07);
  - guardar la lista en caché (RNF-06).
- Imagen Docker, que incluye el código del plugin para copiarlo al volumen de Traefik (D-08), y publicación en GitHub Container Registry al etiquetar.

Resultado: el servicio devuelve la lista correcta del entorno local.

## 4. Script

- Botón pegado al borde, dentro de un Shadow DOM (RF-03, RNF-01).
- Arrastre por todo el perímetro con ratón y dedo, pegándose al borde más cercano (RF-04).
- Posición en una cookie del dominio común (RF-05, D-18).
- Ventana con la lista en orden alfabético, nombre y favicon con la inicial de reserva, la aplicación actual marcada y enlaces construidos con el dominio de la página (RF-06, RF-09, RNF-08, D-19, D-20).
- Teclado, tamaño táctil y tema claro u oscuro (RNF-07).
- No aparece en iframes (RF-12) ni en pantallas con el lado corto por debajo de 600 px (RF-10, D-17).
- Si la lista no carga, no pinta nada y no deja errores que afecten a la aplicación (RNF-01).

Resultado: el menú funciona en todas las aplicaciones de prueba, en escritorio y en tablet.

## 5. Primera versión

- Recorrer en el entorno local la lista de casos de la fase 1 y anotar qué aplicaciones bloquean el script por CSP (D-14).
- Completar el README: desarrollo, configuración del plugin y del servicio.
- Etiquetar `v0.1.0`.

Después, en el repositorio de despliegue, añadir el middleware a las aplicaciones, empezando por un par de ellas (D-09).

## Segunda iteración

Categorías (RF-11) y nombres legibles.

[← Volver al README](../README.md)
