# Plan

Pasos hasta la primera versión, en orden. Cada fase termina con algo que se puede probar. El despliegue en la casa no está aquí: va en el repositorio de despliegue.

## 0. Cerrar decisiones

Antes de escribir código, cerrar las decisiones pendientes, agrupadas por la pieza a la que afectan:

| Pieza | Decisiones |
| --- | --- |
| General | P-07 idioma del código, P-16 versión de Traefik, P-17 licencia |
| Plugin | P-01 cómo llega a Traefik, P-02 dónde se activa, P-09 CSP, P-10 compresión, P-11 qué es una página |
| Servicio | P-03 acceso a la API de Traefik, P-04 ocultar aplicaciones, P-12 quién ve la lista, P-15 caché del script |
| Script | P-05 móvil, P-06 y P-13 posición del botón, P-08 qué se muestra, P-14 orden y enlaces |

P-01 condiciona la estructura del repositorio: un plugin local tiene que estar en la raíz de un módulo de Go con su `.traefik.yml`.

## 1. Esqueleto y entorno de pruebas

- Licencia, `.gitignore` y módulo de Go.
- Entorno local con Docker Compose (RNF-09): Traefik en la versión fijada, el plugin cargado como plugin local y aplicaciones de prueba que cubran los casos difíciles:
  - una página sencilla;
  - una que comprime con gzip y otra con Brotli;
  - una con CSP estricta;
  - una que pide fragmentos HTML;
  - una que incrusta otra en un iframe;
  - una con websockets y descargas grandes;
  - una ruta declarada en fichero, además de las de etiquetas.
- GitHub Actions: pruebas en cada push.

## 2. Plugin

- Detectar las páginas según P-11 y dejar pasar todo lo demás sin tocar ni cargarlo en memoria (RNF-02).
- Insertar el script antes de `</head>` y ajustar la longitud y las cabeceras (RNF-03).
- Compresión según P-10.
- Exclusiones por aplicación (RF-02).
- Pruebas unitarias con `httptest` y prueba en el entorno local, porque Traefik ejecuta el plugin con un intérprete que no admite todo lo que admite el compilador.

Resultado: el entorno local inserta una etiqueta de script en todas las páginas de prueba sin romper ninguna.

## 3. Servicio

- Solo GET (RNF-05). Sirve el script, embebido en el binario, con la caché de P-15.
- Lista de aplicaciones a partir de la API de Traefik (RF-07, D-06), en una ruta separada del script (P-12):
  - quitar duplicados, la ruta del menú, los routers TCP y UDP y las reglas sin nombre;
  - sacar el principio del nombre de `HostRegexp` y el nombre completo de `Host` (D-07);
  - quitar las aplicaciones ocultas por configuración (RF-08, P-04);
  - guardar la lista en caché (RNF-06).
- Imagen Docker y publicación en GitHub Container Registry al etiquetar.

Resultado: el servicio devuelve la lista correcta del entorno local.

## 4. Script

- Botón pegado al borde, dentro de un Shadow DOM (RF-03, RNF-01).
- Arrastre por todo el perímetro con ratón y dedo, pegándose al borde más cercano (RF-04).
- Posición en una cookie del dominio común (RF-05, P-06, P-13).
- Ventana con la lista, la aplicación actual marcada y enlaces construidos con el dominio de la página (RF-06, RF-09, RNF-08).
- Teclado, tamaño táctil y tema claro u oscuro (RNF-07).
- No aparece en iframes (RF-12) ni en el móvil (RF-10, P-05).
- Si la lista no carga, no pinta nada y no deja errores que afecten a la aplicación (RNF-01).

Resultado: el menú funciona en todas las aplicaciones de prueba, en escritorio y en tablet.

## 5. Primera versión

- Recorrer en el entorno local la lista de casos de la fase 1 y anotar qué aplicaciones bloquean el script por CSP (P-09).
- Completar el README: desarrollo, configuración del plugin y del servicio.
- Etiquetar `v0.1.0`.

Después, en el repositorio de despliegue, poner el menú en marcha de forma gradual (P-02).

## Segunda iteración

Categorías (RF-11), nombres legibles e iconos (P-08) y, si interesa, ocultar aplicaciones desde la interfaz (P-04).

[← Volver al README](../README.md)
