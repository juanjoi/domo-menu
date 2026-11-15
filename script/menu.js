// Menú común del hub domótico.
//
// El plugin de Traefik inserta este script con defer en las páginas de las
// aplicaciones. Pinta un botón pegado al borde de la pantalla que abre la
// lista de aplicaciones. Todo vive dentro de un Shadow DOM cerrado, sin
// variables globales, y cualquier fallo deja la página como estaba.
(function () {
  'use strict';

  // El botón es un círculo alrededor del icono, separado un poco del borde y
  // unido a él por dos curvas que salen tangentes al borde y llegan tangentes
  // al círculo en sus extremos a lo largo del borde. Al abrirse, el círculo
  // crece hasta ser la ventana, unida al borde de la misma forma.
  const RADIUS = 22; // radio del círculo
  const LIFT = 4; // separación entre el círculo y el borde
  const CENTER = LIFT + RADIUS; // distancia del centro del círculo al borde
  const SPREAD = 14; // cuánto se abren las curvas a lo largo del borde
  const SIZE = 2 * (RADIUS + SPREAD); // largo del botón junto al borde
  const OPEN_SPREAD = 20;
  const OPEN_RADIUS = 20; // esquinas de la ventana
  const HEADER = 52; // alto de la cabecera de la ventana, donde queda la X
  const PANEL_WIDTH = 384; // cuatro mosaicos por fila
  const MARGIN = 8; // margen mínimo de la ventana con los bordes
  const KAPPA = 0.5523; // cuarto de elipse con una curva de Bézier
  const OPEN_MS = 420; // duración de la animación al abrir, en ms
  const CLOSE_MS = 320;
  const DRAG_THRESHOLD = 5; // px antes de considerar que es un arrastre
  const DEFAULT_POS = { edge: 'right', offset: 0.5 };
  const EDGES = ['top', 'right', 'bottom', 'left'];

  // --- Funciones puras, probadas en menu.test.mjs ---

  // Dominio común de las aplicaciones: el configurado o el nombre actual sin
  // su primera etiqueta. Vacío en IPs y nombres de una sola etiqueta.
  function commonDomain(hostname, configured) {
    if (configured) return configured.replace(/^\.+/, '').toLowerCase();
    const host = (hostname || '').toLowerCase();
    if (!host || host.indexOf(':') >= 0 || /^[\d.]+$/.test(host)) return '';
    const labels = host.split('.');
    if (labels.length < 2) return '';
    return labels.slice(1).join('.');
  }

  function parsePos(value) {
    const m = /^(top|right|bottom|left):([01](?:\.\d+)?)$/.exec(value || '');
    if (!m) return { edge: DEFAULT_POS.edge, offset: DEFAULT_POS.offset };
    return { edge: m[1], offset: Math.min(1, Math.max(0, parseFloat(m[2]))) };
  }

  function formatPos(pos) {
    return pos.edge + ':' + pos.offset.toFixed(3);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // Borde más cercano al punto (x, y), el centro del botón, y posición a lo
  // largo de ese borde: 0 es una esquina y 1 la otra.
  function snap(x, y, width, height, size) {
    const distances = { top: y, right: width - x, bottom: height - y, left: x };
    let edge = EDGES[0];
    EDGES.forEach(function (e) {
      if (distances[e] < distances[edge]) edge = e;
    });
    const vertical = edge === 'left' || edge === 'right';
    const length = vertical ? height : width;
    const center = vertical ? y : x;
    const range = length - size;
    const offset = range > 0 ? clamp((center - size / 2) / range, 0, 1) : 0;
    return { edge: edge, offset: Math.round(offset * 1000) / 1000 };
  }

  function isVertical(edge) {
    return edge === 'left' || edge === 'right';
  }

  // Centro del círculo del botón, en px de la pantalla, para una posición.
  function buttonCenter(pos, width, height) {
    const along = (Math.max(0, (isVertical(pos.edge) ? height : width) - SIZE) * pos.offset) + SIZE / 2;
    return toScreen(pos.edge, CENTER, along, width, height);
  }

  // De coordenadas del borde (a, distancia al borde; s, posición a lo largo
  // de él) a px de la pantalla.
  function toScreen(edge, a, s, width, height) {
    switch (edge) {
      case 'left':
        return { x: a, y: s };
      case 'right':
        return { x: width - a, y: s };
      case 'top':
        return { x: s, y: a };
      default:
        return { x: s, y: height - a };
    }
  }

  // Forma cerrada: el círculo del botón, centrado en along.
  function closedShape(along) {
    return { depth: 2 * RADIUS, s0: along - RADIUS, s1: along + RADIUS, r: RADIUS, spread: SPREAD };
  }

  // Forma abierta: la ventana junto al borde, con el botón a la altura de la
  // cabecera si cabe. contentWidth y contentHeight son el tamaño que pide el
  // contenido; se recortan para que quepa en la pantalla.
  function openShape(edge, along, width, height, contentWidth, contentHeight) {
    const vertical = isVertical(edge);
    const viewAlong = vertical ? height : width;
    const viewDepth = vertical ? width : height;
    const maxAlong = Math.max(2 * OPEN_RADIUS, viewAlong - 2 * (OPEN_SPREAD + MARGIN));
    const maxDepth = Math.max(2 * OPEN_RADIUS, viewDepth - LIFT - MARGIN);
    const size = Math.min(vertical ? contentHeight : contentWidth, maxAlong);
    const depth = Math.min(vertical ? contentWidth : contentHeight, maxDepth);
    const low = OPEN_SPREAD + MARGIN;
    const s0 = Math.max(low, Math.min(viewAlong - size - low, along - HEADER / 2));
    return { depth: depth, s0: s0, s1: s0 + size, r: OPEN_RADIUS, spread: OPEN_SPREAD };
  }

  function mix(a, b, t) {
    const r = {};
    Object.keys(a).forEach(function (k) {
      r[k] = a[k] + (b[k] - a[k]) * t;
    });
    return r;
  }

  // Contorno de una forma como trazado SVG en px de la pantalla: un
  // rectángulo redondeado a LIFT del borde, de fondo depth, entre s0 y s1 a
  // lo largo del borde y con esquinas de radio r, unido al borde por dos
  // cuartos de elipse. Cada uno sale tangente al borde a spread del
  // rectángulo y llega tangente a su lado donde empieza el tramo recto. Con
  // fondo y largo 2r es el círculo del botón, y las curvas llegan a sus
  // extremos a lo largo del borde.
  function outline(edge, width, height, g) {
    const flip = edge === 'right' || edge === 'top'; // reflejos: los arcos van al revés
    const round = function (v) {
      return Math.round(v * 100) / 100;
    };
    const pt = function (a, s) {
      const p = toScreen(edge, a, s, width, height);
      return round(p.x) + ' ' + round(p.y);
    };
    const arc = function (a, s) {
      return ' A ' + round(g.r) + ' ' + round(g.r) + ' 0 0 ' + (flip ? 0 : 1) + ' ' + pt(a, s);
    };
    const near = LIFT + g.r;
    const far = LIFT + g.depth;
    const sp = g.spread;
    return (
      'M ' + pt(0, g.s0 - sp) +
      ' C ' + pt(0, g.s0 - sp + sp * KAPPA) + ', ' + pt(near * (1 - KAPPA), g.s0) + ', ' + pt(near, g.s0) +
      ' L ' + pt(far - g.r, g.s0) + arc(far, g.s0 + g.r) +
      ' L ' + pt(far, g.s1 - g.r) + arc(far - g.r, g.s1) +
      ' L ' + pt(near, g.s1) +
      ' C ' + pt(near * (1 - KAPPA), g.s1) + ', ' + pt(0, g.s1 + sp - sp * KAPPA) + ', ' + pt(0, g.s1 + sp) +
      ' Z'
    );
  }

  // Rectángulo de una forma en px de la pantalla.
  function shapeRect(edge, width, height, g) {
    const p = toScreen(edge, LIFT, g.s0, width, height);
    const q = toScreen(edge, LIFT + g.depth, g.s1, width, height);
    return {
      x: Math.min(p.x, q.x),
      y: Math.min(p.y, q.y),
      width: Math.abs(q.x - p.x),
      height: Math.abs(q.y - p.y),
    };
  }

  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // Dirección de una aplicación con el esquema y el puerto de la página.
  function appUrl(app, location, domain) {
    const host = app.host || (domain ? app.name + '.' + domain : '');
    if (!host) return '';
    return location.protocol + '//' + host + (location.port ? ':' + location.port : '') + '/';
  }

  function appList(data, location) {
    const domain = commonDomain(location.hostname, data.domain);
    const current = (location.hostname || '').toLowerCase();
    return (data.apps || [])
      .map(function (app) {
        const url = appUrl(app, location, domain);
        const host = url ? new URL(url).hostname : '';
        return {
          name: app.title || app.name,
          url: url,
          current: host === current,
          category: app.category || '',
          icon: app.icon || '',
        };
      })
      .filter(function (app) {
        return app.url;
      });
  }

  // Agrupa las aplicaciones en el orden de las categorías, con las que no
  // tienen al final, en «Otras». Si ninguna tiene categoría, un solo grupo sin
  // nombre: la lista sale plana.
  function groupApps(apps, categories) {
    const groups = (categories || []).map(function (name) {
      return { name: name, apps: [] };
    });
    const others = { name: 'Otras', apps: [] };
    apps.forEach(function (app) {
      const group = groups.filter(function (g) {
        return g.name === app.category;
      })[0];
      (group || others).apps.push(app);
    });
    const result = groups.filter(function (g) {
      return g.apps.length;
    });
    if (!result.length) return others.apps.length ? [{ name: '', apps: others.apps }] : [];
    if (others.apps.length) result.push(others);
    return result;
  }

  // --- Navegador ---

  function fetchList() {
    return fetch('/__menu/apps.json', { credentials: 'omit', cache: 'no-cache' }).then(function (response) {
      if (!response.ok) throw new Error(response.status);
      return response.json();
    });
  }

  // La posición es una sola para toda la casa y la guarda el servicio: con
  // dominios internos como .internal el navegador no comparte nada entre
  // aplicaciones. Si no se puede guardar, se queda en esta página.
  function savePosition(value) {
    fetch('/__menu/posicion', {
      method: 'PUT',
      body: value,
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain' },
    }).catch(function () {});
  }

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .layer, .button, .panel {
      --bg: #ffffff; --fg: #1d2129; --muted: #6b7280; --hover: #eef0f3;
      --tile: #eceef2; --accent: #2563eb;
      font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: var(--fg);
    }
    @media (prefers-color-scheme: dark) {
      .layer, .button, .panel {
        --bg: #1d2026; --fg: #e6e8eb; --muted: #9aa1ab; --hover: #2a2e36;
        --tile: #2a2e36; --accent: #6b9bff;
      }
    }
    .layer {
      position: fixed; left: 0; top: 0; overflow: visible; pointer-events: none;
      filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.35));
    }
    .shape { fill: var(--bg); }
    .button {
      position: fixed; width: ${2 * RADIUS}px; height: ${2 * RADIUS}px; margin: 0; padding: 0;
      display: flex; align-items: center; justify-content: center;
      border: 0; border-radius: 50%; background: none; color: var(--fg);
      cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none;
      -webkit-tap-highlight-color: transparent;
    }
    .button[aria-expanded="true"] { cursor: pointer; }
    .button:focus { outline: none; }
    .button:focus-visible { outline: 3px solid var(--accent); outline-offset: 0; }
    .button.dragging { cursor: grabbing; }
    .button svg { width: 22px; height: 22px; overflow: visible; pointer-events: none; }
    .dots, .cross {
      transform-box: view-box; transform-origin: 12px 12px;
      transition: transform ${OPEN_MS}ms cubic-bezier(0.65, 0, 0.35, 1), opacity ${OPEN_MS}ms;
    }
    .dots { fill: currentColor; }
    .cross { fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; opacity: 0; transform: rotate(-90deg) scale(0.4); }
    .button[aria-expanded="true"] .dots { opacity: 0; transform: rotate(90deg) scale(0.4); }
    .button[aria-expanded="true"] .cross { opacity: 1; transform: none; }
    .panel {
      position: fixed; display: flex; flex-direction: column; margin: 0; padding: 0;
      overflow: hidden; border-radius: ${OPEN_RADIUS}px;
    }
    .panel[hidden] { display: none; }
    .panel[data-edge="bottom"] { flex-direction: column-reverse; }
    .title {
      flex: none; display: flex; align-items: center; height: ${HEADER}px; margin: 0; padding: 0 16px;
      font-size: 12px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted);
    }
    .panel[data-edge="left"] .title, .panel[data-edge="top"] .title, .panel[data-edge="bottom"] .title { padding-left: ${HEADER}px; }
    .panel[data-edge="right"] .title { padding-right: ${HEADER}px; }
    .list { overflow-y: auto; padding: 0 10px 10px; }
    .panel[data-edge="bottom"] .list { padding: 10px 10px 0; }
    ul {
      list-style: none; margin: 0; padding: 0;
      display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px;
    }
    .group {
      margin: 8px 6px 6px; font-size: 11px; font-weight: 600;
      letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted);
    }
    a {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 10px 4px 8px; border-radius: 14px; color: var(--fg);
      text-decoration: none; text-align: center;
    }
    a:hover { background: var(--hover); }
    a:focus-visible { outline: 3px solid var(--accent); outline-offset: -3px; }
    a[aria-current="page"] .icon { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent); }
    a[aria-current="page"] .name { font-weight: 600; }
    .icon {
      flex: none; width: 52px; height: 52px; display: flex; align-items: center; justify-content: center;
      border-radius: 14px; background: var(--tile); color: var(--muted);
      font-size: 22px; font-weight: 600; text-transform: uppercase; overflow: hidden;
    }
    .icon img { width: 38px; height: 38px; object-fit: contain; }
    .name {
      max-width: 100%; font-size: 12px; line-height: 1.25; overflow-wrap: anywhere;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    @media print { .layer, .button, .panel { display: none; } }
    @media (prefers-reduced-motion: reduce) { .dots, .cross { transition: none; } }
  `;

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function svgElement(name, attributes) {
    const el = document.createElementNS(SVG_NS, name);
    Object.keys(attributes).forEach(function (k) {
      el.setAttribute(k, attributes[k]);
    });
    return el;
  }

  // Icono del botón: la cuadrícula, que al abrir gira y se convierte en una
  // X. Creado con el DOM y no con innerHTML para que funcione en páginas con
  // Trusted Types.
  function buttonIcon() {
    const svg = svgElement('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    const dots = svgElement('g', { class: 'dots' });
    [4, 10, 16].forEach(function (y) {
      [4, 10, 16].forEach(function (x) {
        dots.appendChild(svgElement('rect', { x: x, y: y, width: 4, height: 4, rx: 1 }));
      });
    });
    svg.appendChild(dots);
    svg.appendChild(svgElement('path', { class: 'cross', d: 'M6 6 L18 18 M18 6 L6 18' }));
    return svg;
  }

  // Hojas de estilo construidas: las CSP que prohíben estilos en línea no
  // las bloquean, a diferencia de un elemento <style>, que queda como
  // alternativa para navegadores antiguos.
  function applyStyles(shadow) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch (e) {
      const style = document.createElement('style');
      style.textContent = CSS;
      shadow.appendChild(style);
    }
  }

  function viewport() {
    const root = document.documentElement;
    if (document.compatMode === 'CSS1Compat' && root.clientWidth > 0) {
      return { width: root.clientWidth, height: root.clientHeight };
    }
    return { width: window.innerWidth, height: window.innerHeight };
  }

  function appItem(app) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = app.url;
    if (app.current) a.setAttribute('aria-current', 'page');

    const icon = document.createElement('span');
    icon.className = 'icon';
    // La inicial se ve desde el principio; la imagen la sustituye solo si
    // carga. El icono propio se sirve desde este mismo origen; el favicon,
    // desde la otra aplicación, que puede tardar, fallar o estar bloqueada
    // por una CSP.
    icon.textContent = app.name.charAt(0);
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('load', function () {
      icon.textContent = '';
      icon.appendChild(img);
    });
    img.addEventListener('error', function () {
      if (app.icon && img.src.indexOf('favicon.ico') < 0) img.src = app.url + 'favicon.ico';
    });
    img.src = app.icon || app.url + 'favicon.ico';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = app.name;

    a.appendChild(icon);
    a.appendChild(name);
    li.appendChild(a);
    return li;
  }

  function render(data) {
    const apps = appList(data, location);
    if (!apps.length) return;
    const host = document.createElement('domo-menu');
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('z-index', '2147483647', 'important');
    const shadow = host.attachShadow({ mode: 'closed' });
    applyStyles(shadow);

    // La forma del botón y de la ventana, dibujada en una capa del tamaño de
    // la pantalla que no recibe pulsaciones.
    const layer = svgElement('svg', { class: 'layer', 'aria-hidden': 'true' });
    const shape = svgElement('path', { class: 'shape' });
    layer.appendChild(shape);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button';
    button.setAttribute('aria-label', 'Aplicaciones');
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'panel');
    button.appendChild(buttonIcon());

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.id = 'panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Aplicaciones');
    const title = document.createElement('p');
    title.className = 'title';
    title.textContent = 'Aplicaciones';
    const list = document.createElement('div');
    list.className = 'list';
    panel.appendChild(title);
    panel.appendChild(list);

    shadow.appendChild(layer);
    shadow.appendChild(panel);
    shadow.appendChild(button);

    let pos = parsePos(data.position);
    let loaded = false;
    let opened = false;
    let progress = 0; // 0 cerrado, 1 abierto
    let frame = 0;
    let closedGeom = null;
    let openGeom = null;
    let dragPoint = null; // centro del círculo mientras se arrastra

    function reducedMotion() {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function along(p) {
      return isVertical(pos.edge) ? p.y : p.x;
    }

    function fillList() {
      if (loaded) return;
      groupApps(apps, data.categories).forEach(function (group, i) {
        const ul = document.createElement('ul');
        if (group.name) {
          const heading = document.createElement('p');
          heading.className = 'group';
          heading.id = 'grupo-' + i;
          heading.textContent = group.name;
          ul.setAttribute('aria-labelledby', heading.id);
          list.appendChild(heading);
        }
        group.apps.forEach(function (app) {
          ul.appendChild(appItem(app));
        });
        list.appendChild(ul);
      });
      loaded = true;
    }

    // Formas cerrada y abierta para la posición y la pantalla actuales. La
    // abierta mide el contenido con el ancho que tendrá la ventana.
    function computeShapes() {
      const vp = viewport();
      closedGeom = closedShape(along(buttonCenter(pos, vp.width, vp.height)));
      if (!loaded) return;
      const vertical = isVertical(pos.edge);
      const maxWidth = vertical ? vp.width - LIFT - MARGIN : vp.width - 2 * (OPEN_SPREAD + MARGIN);
      const width = Math.min(PANEL_WIDTH, maxWidth);
      const hidden = panel.hidden;
      panel.hidden = false;
      panel.style.visibility = 'hidden';
      panel.style.width = width + 'px';
      panel.style.height = 'auto';
      const height = panel.scrollHeight;
      panel.style.visibility = '';
      panel.hidden = hidden;
      openGeom = openShape(pos.edge, closedGeom.s0 + RADIUS, vp.width, vp.height, width, height);
    }

    // Pinta el estado intermedio según progress.
    function draw() {
      const vp = viewport();
      layer.setAttribute('width', vp.width);
      layer.setAttribute('height', vp.height);
      layer.setAttribute('viewBox', '0 0 ' + vp.width + ' ' + vp.height);
      let center;
      if (dragPoint) {
        center = dragPoint;
        const r = RADIUS;
        shape.setAttribute(
          'd',
          'M ' + (center.x - r) + ' ' + center.y + ' A ' + r + ' ' + r + ' 0 1 0 ' + (center.x + r) + ' ' + center.y +
            ' A ' + r + ' ' + r + ' 0 1 0 ' + (center.x - r) + ' ' + center.y + ' Z'
        );
      } else {
        const t = easeInOut(progress);
        const g = openGeom && progress > 0 ? mix(closedGeom, openGeom, t) : closedGeom;
        shape.setAttribute('d', outline(pos.edge, vp.width, vp.height, g));
        // El botón va del centro del círculo a la esquina de la cabecera.
        center = toScreen(pos.edge, CENTER, g.s0 + (openGeom && progress > 0 ? HEADER / 2 + (RADIUS - HEADER / 2) * (1 - t) : RADIUS), vp.width, vp.height);
        if (openGeom && progress > 0) {
          const rect = shapeRect(pos.edge, vp.width, vp.height, openGeom);
          panel.style.left = rect.x + 'px';
          panel.style.top = rect.y + 'px';
          panel.style.width = rect.width + 'px';
          panel.style.height = rect.height + 'px';
          // El contenido aparece al final, cuando ya casi hay sitio.
          const fade = Math.max(0, Math.min(1, (progress - 0.55) / 0.45));
          panel.style.opacity = fade;
          panel.style.pointerEvents = progress === 1 ? '' : 'none';
        }
      }
      button.style.left = center.x - RADIUS + 'px';
      button.style.top = center.y - RADIUS + 'px';
    }

    function animateTo(to, done) {
      cancelAnimationFrame(frame);
      const from = progress;
      const duration = (to > from ? OPEN_MS : CLOSE_MS) * Math.abs(to - from);
      if (reducedMotion() || duration <= 0) {
        progress = to;
        draw();
        if (done) done();
        return;
      }
      const start = performance.now();
      const step = function (now) {
        const t = Math.min(1, (now - start) / duration);
        progress = from + (to - from) * t;
        draw();
        if (t < 1) frame = requestAnimationFrame(step);
        else if (done) done();
      };
      frame = requestAnimationFrame(step);
    }

    function place() {
      computeShapes();
      button.dataset.edge = pos.edge;
      panel.dataset.edge = pos.edge;
      draw();
    }

    function isOpen() {
      return opened;
    }

    function open() {
      fillList();
      opened = true;
      computeShapes();
      panel.hidden = false;
      panel.style.opacity = 0;
      button.setAttribute('aria-expanded', 'true');
      button.setAttribute('aria-label', 'Cerrar aplicaciones');
      animateTo(1, function () {
        if (!opened) return;
        const target = list.querySelector('a[aria-current="page"]') || list.querySelector('a');
        if (target) target.focus({ preventScroll: true });
      });
    }

    function close(focusButton, instant) {
      if (!isOpen()) return;
      opened = false;
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', 'Aplicaciones');
      if (focusButton) button.focus({ preventScroll: true });
      panel.style.pointerEvents = 'none';
      const hide = function () {
        if (!opened) panel.hidden = true;
      };
      if (instant) {
        cancelAnimationFrame(frame);
        progress = 0;
        hide();
        draw();
      } else {
        animateTo(0, hide);
      }
    }

    // Arrastre con ratón o dedo. Un movimiento corto cuenta como pulsación.
    let drag = null;
    let suppressClickUntil = 0;

    button.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || isOpen()) return;
      const r = button.getBoundingClientRect();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: r.left + RADIUS, cy: r.top + RADIUS, moving: false };
      button.setPointerCapture(e.pointerId);
    });

    button.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moving) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        drag.moving = true;
        button.classList.add('dragging');
      }
      const vp = viewport();
      dragPoint = {
        x: clamp(drag.cx + dx, RADIUS, vp.width - RADIUS),
        y: clamp(drag.cy + dy, RADIUS, vp.height - RADIUS),
      };
      draw();
    });

    function endDrag(e, commit) {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moving;
      drag = null;
      button.classList.remove('dragging');
      if (!moved) return;
      suppressClickUntil = performance.now() + 400;
      if (commit && dragPoint) {
        const vp = viewport();
        pos = snap(dragPoint.x, dragPoint.y, vp.width, vp.height, SIZE);
        savePosition(formatPos(pos));
      }
      dragPoint = null;
      place();
    }

    button.addEventListener('pointerup', function (e) {
      endDrag(e, true);
    });
    button.addEventListener('pointercancel', function (e) {
      endDrag(e, false);
    });

    button.addEventListener('click', function () {
      if (performance.now() < suppressClickUntil) return;
      if (isOpen()) close(false);
      else open();
    });

    shadow.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) {
        e.stopPropagation();
        close(true);
      }
    });

    document.addEventListener(
      'pointerdown',
      function (e) {
        if (isOpen() && e.composedPath().indexOf(host) < 0) close(false);
      },
      true
    );

    window.addEventListener('resize', function () {
      place();
    });

    // Otra pestaña o dispositivo pudo mover el botón mientras esta estaba
    // en segundo plano.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      fetchList()
        .then(function (fresh) {
          const saved = parsePos(fresh.position);
          if (drag || formatPos(saved) === formatPos(pos)) return;
          close(false, true);
          pos = saved;
          place();
        })
        .catch(function () {});
    });

    place();
    document.documentElement.appendChild(host);
  }

  function init() {
    if (window.top !== window.self) return;
    if (document.querySelector('domo-menu')) return;
    fetchList()
      .then(function (data) {
        if (!document.querySelector('domo-menu')) render(data);
      })
      .catch(function () {});
  }

  /* global __DOMO_MENU_TEST__ */
  if (typeof __DOMO_MENU_TEST__ === 'function') {
    __DOMO_MENU_TEST__({
      commonDomain: commonDomain,
      parsePos: parsePos,
      formatPos: formatPos,
      snap: snap,
      buttonCenter: buttonCenter,
      closedShape: closedShape,
      openShape: openShape,
      outline: outline,
      appUrl: appUrl,
      appList: appList,
      groupApps: groupApps,
    });
    return;
  }

  try {
    init();
  } catch (e) {
    // Sin menú, pero la aplicación sigue igual.
  }
})();
