// Menú común del hub domótico.
//
// El plugin de Traefik inserta este script con defer en las páginas de las
// aplicaciones. Pinta un botón pegado al borde de la pantalla que abre la
// lista de aplicaciones. Todo vive dentro de un Shadow DOM cerrado, sin
// variables globales, y cualquier fallo deja la página como estaba.
(function () {
  'use strict';

  const SIZE = 44; // lado del botón, en px
  const PANEL_WIDTH = 304; // tres mosaicos por fila
  const GENIE_OPEN = 380; // duración del efecto genio, en ms
  const GENIE_CLOSE = 280;
  const GENIE_STEPS = 16;
  const GAP = 8; // separación entre el botón y la ventana
  const MIN_SCREEN = 600; // lado corto mínimo de la pantalla
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

  // Esquina superior izquierda del botón para una posición.
  function placement(pos, width, height, size) {
    const along = function (length) {
      return Math.max(0, length - size) * pos.offset;
    };
    switch (pos.edge) {
      case 'top':
        return { x: along(width), y: 0 };
      case 'bottom':
        return { x: along(width), y: Math.max(0, height - size) };
      case 'left':
        return { x: 0, y: along(height) };
      default:
        return { x: Math.max(0, width - size), y: along(height) };
    }
  }

  // Esquina superior izquierda de la ventana, junto al botón y dentro de la
  // pantalla.
  function panelPlacement(pos, button, panelWidth, panelHeight, width, height) {
    const maxX = Math.max(GAP, width - panelWidth - GAP);
    const maxY = Math.max(GAP, height - panelHeight - GAP);
    switch (pos.edge) {
      case 'left':
        return { x: clamp(button.x + SIZE + GAP, GAP, maxX), y: clamp(button.y, GAP, maxY) };
      case 'top':
        return { x: clamp(button.x, GAP, maxX), y: clamp(button.y + SIZE + GAP, GAP, maxY) };
      case 'bottom':
        return { x: clamp(button.x, GAP, maxX), y: clamp(button.y - panelHeight - GAP, GAP, maxY) };
      default:
        return { x: clamp(button.x - panelWidth - GAP, GAP, maxX), y: clamp(button.y, GAP, maxY) };
    }
  }

  function smoothstep(a, b, x) {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // Silueta del efecto genio: un polígono, en px de la ventana, que recorta
  // la ventana para que salga del botón. progress va de 0, todo dentro del
  // botón, a 1, la ventana entera. from y to son el tramo del lado de la
  // ventana junto al botón que ocupa el botón. Primero sale un chorro del
  // ancho del botón y luego se ensancha desde el extremo lejano, con los
  // lados curvos.
  function genieShape(edge, width, height, from, to, progress, samples) {
    const n = samples || 12;
    const horizontal = edge === 'left' || edge === 'right';
    const axis = horizontal ? width : height;
    const across = horizontal ? height : width;
    const reach = axis * smoothstep(0, 0.6, progress);
    const center = 2 * progress - 0.5;
    const point = function (a, q) {
      const r = function (v) {
        return Math.round(v * 10) / 10 + 'px';
      };
      switch (edge) {
        case 'left':
          return r(a) + ' ' + r(q);
        case 'top':
          return r(q) + ' ' + r(a);
        case 'bottom':
          return r(q) + ' ' + r(height - a);
        default:
          return r(width - a) + ' ' + r(q);
      }
    };
    const near = [];
    const far = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n; // 0 en el extremo lejano, 1 junto al botón
      const pinch = smoothstep(center - 0.5, center + 0.5, u);
      const a = reach * (1 - u); // distancia al lado del botón
      near.push(point(a, from * pinch));
      far.push(point(a, across + (to - across) * pinch));
    }
    return 'polygon(' + near.concat(far.reverse()).join(', ') + ')';
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
    .button, .panel {
      --bg: #f6f7f9; --surface: #ffffff; --fg: #1d2129; --muted: #6b7280;
      --line: #d1d5db; --tile: #eceef2; --accent: #2563eb;
      font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: var(--fg);
    }
    @media (prefers-color-scheme: dark) {
      .button, .panel {
        --bg: #14161a; --surface: #1d2026; --fg: #e6e8eb; --muted: #9aa1ab;
        --line: #2f343d; --tile: #2a2e36; --accent: #6b9bff;
      }
    }
    .button {
      position: fixed; width: ${SIZE}px; height: ${SIZE}px; margin: 0; padding: 0;
      display: flex; align-items: center; justify-content: center;
      background: var(--bg); border: 1px solid var(--line); border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25); cursor: grab;
      touch-action: none; user-select: none; -webkit-user-select: none;
      opacity: 0.85; transition: opacity 0.15s;
    }
    .button:hover, .button:focus-visible, .button[aria-expanded="true"] { opacity: 1; }
    .button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
    .button.dragging { cursor: grabbing; opacity: 1; transition: none; }
    .button[data-edge="left"] { border-top-left-radius: 0; border-bottom-left-radius: 0; border-left: 0; }
    .button[data-edge="right"] { border-top-right-radius: 0; border-bottom-right-radius: 0; border-right: 0; }
    .button[data-edge="top"] { border-top-left-radius: 0; border-top-right-radius: 0; border-top: 0; }
    .button[data-edge="bottom"] { border-bottom-left-radius: 0; border-bottom-right-radius: 0; border-bottom: 0; }
    .button svg { width: 22px; height: 22px; fill: var(--fg); pointer-events: none; }
    .panel {
      position: fixed; width: ${PANEL_WIDTH}px; max-height: min(520px, calc(100vh - 16px));
      display: flex; flex-direction: column; margin: 0; padding: 0;
      background: var(--bg); border: 1px solid var(--line); border-radius: 16px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); overflow: hidden;
    }
    .panel[hidden] { display: none; }
    .title {
      margin: 0; padding: 14px 16px 4px; font-size: 12px; font-weight: 600;
      letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted);
    }
    .list { overflow-y: auto; padding: 0 10px 10px; }
    ul {
      list-style: none; margin: 0; padding: 0;
      display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px;
    }
    .group {
      margin: 12px 6px 6px; font-size: 11px; font-weight: 600;
      letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted);
    }
    a {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 10px 4px 8px; border-radius: 14px; color: var(--fg);
      text-decoration: none; text-align: center;
    }
    a:hover { background: var(--surface); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.13); }
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
    @media print { .button, .panel { display: none; } }
    @media (prefers-reduced-motion: reduce) { .button { transition: none; } }
  `;

  // Icono de cuadrícula, creado con el DOM y no con innerHTML para que
  // funcione en páginas con Trusted Types.
  function gridIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    [4, 10, 16].forEach(function (y) {
      [4, 10, 16].forEach(function (x) {
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', 4);
        rect.setAttribute('height', 4);
        rect.setAttribute('rx', 1);
        svg.appendChild(rect);
      });
    });
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

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button';
    button.setAttribute('aria-label', 'Aplicaciones');
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'panel');
    button.appendChild(gridIcon());

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

    shadow.appendChild(button);
    shadow.appendChild(panel);

    let pos = parsePos(data.position);
    let point = { x: 0, y: 0 };
    let loaded = false;

    function moveButton(x, y) {
      point = { x: x, y: y };
      button.style.left = x + 'px';
      button.style.top = y + 'px';
    }

    function placeButton() {
      const vp = viewport();
      const p = placement(pos, vp.width, vp.height, SIZE);
      button.dataset.edge = pos.edge;
      moveButton(p.x, p.y);
    }

    function placePanel() {
      const vp = viewport();
      const rect = panel.getBoundingClientRect();
      const p = panelPlacement(pos, point, rect.width, rect.height, vp.width, vp.height);
      panel.style.left = p.x + 'px';
      panel.style.top = p.y + 'px';
    }

    let opened = false;
    let animation = null;

    function isOpen() {
      return opened;
    }

    function canAnimate() {
      return (
        typeof panel.animate === 'function' &&
        !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) &&
        !!(window.CSS && window.CSS.supports && window.CSS.supports('clip-path', 'polygon(0px 0px, 1px 0px, 0px 1px)'))
      );
    }

    // Fotogramas del efecto genio, con la ventana ya colocada y visible.
    function genieFrames() {
      const p = panel.getBoundingClientRect();
      const horizontal = pos.edge === 'left' || pos.edge === 'right';
      const across = horizontal ? p.height : p.width;
      const start = horizontal ? point.y - p.top : point.x - p.left;
      const half = Math.min(SIZE, across) / 2;
      const middle = clamp(start + SIZE / 2, half, across - half);
      const frames = [];
      for (let i = 0; i <= GENIE_STEPS; i++) {
        const progress = i / GENIE_STEPS;
        frames.push({
          clipPath: genieShape(pos.edge, p.width, p.height, middle - half, middle + half, progress),
          opacity: Math.min(1, progress * 4),
        });
      }
      return frames;
    }

    function genie(opening, done) {
      if (animation) animation.cancel();
      animation = null;
      if (!canAnimate()) return done && done();
      try {
        const current = panel.animate(genieFrames(), {
          duration: opening ? GENIE_OPEN : GENIE_CLOSE,
          easing: opening ? 'cubic-bezier(0.2, 0.7, 0.3, 1)' : 'cubic-bezier(0.6, 0, 0.8, 0.4)',
          direction: opening ? 'normal' : 'reverse',
          fill: opening ? 'none' : 'forwards',
        });
        animation = current;
        current.onfinish = function () {
          if (animation !== current) return;
          animation = null;
          if (done) done();
          current.cancel();
        };
      } catch (e) {
        if (done) done();
      }
    }

    function open() {
      if (!loaded) {
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
      opened = true;
      panel.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      placePanel();
      genie(true);
      const target = list.querySelector('a[aria-current="page"]') || list.querySelector('a');
      if (target) target.focus({ preventScroll: true });
    }

    // Al arrastrar se cierra sin efecto: el botón ya no está donde salió.
    function close(focusButton, instant) {
      if (!isOpen()) return;
      opened = false;
      button.setAttribute('aria-expanded', 'false');
      if (focusButton) button.focus();
      const hide = function () {
        if (!opened) panel.hidden = true;
      };
      if (instant) {
        if (animation) animation.cancel();
        animation = null;
        hide();
      } else {
        genie(false, hide);
      }
    }

    // Arrastre con ratón o dedo. Un movimiento corto cuenta como pulsación.
    let drag = null;
    let suppressClickUntil = 0;

    button.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, bx: point.x, by: point.y, moving: false };
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
        close(false, true);
      }
      const vp = viewport();
      moveButton(clamp(drag.bx + dx, 0, vp.width - SIZE), clamp(drag.by + dy, 0, vp.height - SIZE));
    });

    function endDrag(e, commit) {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moving;
      drag = null;
      button.classList.remove('dragging');
      if (!moved) return;
      suppressClickUntil = performance.now() + 400;
      if (commit) {
        const vp = viewport();
        pos = snap(point.x + SIZE / 2, point.y + SIZE / 2, vp.width, vp.height, SIZE);
        savePosition(formatPos(pos));
      }
      placeButton();
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
      placeButton();
      if (isOpen()) placePanel();
    });

    // Otra pestaña o dispositivo pudo mover el botón mientras esta estaba
    // en segundo plano.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      fetchList()
        .then(function (fresh) {
          const saved = parsePos(fresh.position);
          if (drag || formatPos(saved) === formatPos(pos)) return;
          pos = saved;
          placeButton();
          if (isOpen()) placePanel();
        })
        .catch(function () {});
    });

    placeButton();
    document.documentElement.appendChild(host);
  }

  function init() {
    if (window.top !== window.self) return;
    if (Math.min(screen.width, screen.height) < MIN_SCREEN) return;
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
      placement: placement,
      panelPlacement: panelPlacement,
      appUrl: appUrl,
      appList: appList,
      groupApps: groupApps,
      genieShape: genieShape,
    });
    return;
  }

  try {
    init();
  } catch (e) {
    // Sin menú, pero la aplicación sigue igual.
  }
})();
