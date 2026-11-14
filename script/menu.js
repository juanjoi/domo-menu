// Menú común del hub domótico.
//
// El plugin de Traefik inserta este script con defer en las páginas de las
// aplicaciones. Pinta un botón pegado al borde de la pantalla que abre la
// lista de aplicaciones. Todo vive dentro de un Shadow DOM cerrado, sin
// variables globales, y cualquier fallo deja la página como estaba.
(function () {
  'use strict';

  const SIZE = 44; // lado del botón, en px
  const GAP = 8; // separación entre el botón y la ventana
  const MIN_SCREEN = 600; // lado corto mínimo de la pantalla
  const DRAG_THRESHOLD = 5; // px antes de considerar que es un arrastre
  const COOKIE = 'domo-menu-pos';
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
        return { name: app.name, url: url, current: host === current };
      })
      .filter(function (app) {
        return app.url;
      });
  }

  // --- Navegador ---

  function readCookie() {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  // Guarda la posición en el dominio común; si el navegador no acepta la
  // cookie en ese dominio, solo en el nombre actual.
  function writeCookie(value, domain) {
    const base =
      COOKIE + '=' + value +
      '; path=/; max-age=31536000; SameSite=Lax' +
      (location.protocol === 'https:' ? '; Secure' : '');
    if (domain) {
      document.cookie = base + '; domain=' + domain;
      if (readCookie() === value) return;
    }
    document.cookie = base;
  }

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .button, .panel {
      --bg: #ffffff; --fg: #1f2937; --muted: #6b7280; --line: #d1d5db;
      --hover: #f3f4f6; --accent: #2563eb; --accent-bg: #dbeafe;
      font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: var(--fg);
    }
    @media (prefers-color-scheme: dark) {
      .button, .panel {
        --bg: #1f2937; --fg: #f3f4f6; --muted: #9ca3af; --line: #374151;
        --hover: #374151; --accent: #93c5fd; --accent-bg: #1e3a8a;
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
      position: fixed; width: 260px; max-height: min(480px, calc(100vh - 16px));
      display: flex; flex-direction: column; margin: 0; padding: 0;
      background: var(--bg); border: 1px solid var(--line); border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); overflow: hidden;
    }
    .panel[hidden] { display: none; }
    .title {
      margin: 0; padding: 12px 16px 8px; font-size: 12px; font-weight: 600;
      letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted);
    }
    ul { list-style: none; margin: 0; padding: 0 8px 8px; overflow-y: auto; }
    a {
      display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 6px 8px;
      border-radius: 8px; color: var(--fg); text-decoration: none;
    }
    a:hover { background: var(--hover); }
    a:focus-visible { outline: 3px solid var(--accent); outline-offset: -3px; }
    a[aria-current="page"] { background: var(--accent-bg); font-weight: 600; }
    .icon {
      flex: none; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
      border-radius: 6px; background: var(--hover); color: var(--muted);
      font-size: 13px; font-weight: 600; text-transform: uppercase; overflow: hidden;
    }
    .icon img { width: 20px; height: 20px; object-fit: contain; }
    .empty { padding: 4px 16px 16px; color: var(--muted); }
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
    const initial = function () {
      icon.textContent = app.name.charAt(0);
    };
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('error', initial);
    img.src = app.url + 'favicon.ico';
    icon.appendChild(img);

    const name = document.createElement('span');
    name.textContent = app.name;

    a.appendChild(icon);
    a.appendChild(name);
    li.appendChild(a);
    return li;
  }

  function render(data) {
    const apps = appList(data, location);
    if (!apps.length) return;
    const domain = commonDomain(location.hostname, data.domain);

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
    const list = document.createElement('ul');
    panel.appendChild(title);
    panel.appendChild(list);

    shadow.appendChild(button);
    shadow.appendChild(panel);

    let pos = parsePos(readCookie());
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

    function isOpen() {
      return !panel.hidden;
    }

    function open() {
      if (!loaded) {
        apps.forEach(function (app) {
          list.appendChild(appItem(app));
        });
        loaded = true;
      }
      panel.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      placePanel();
      const target = list.querySelector('a[aria-current="page"]') || list.querySelector('a');
      if (target) target.focus();
    }

    function close(focusButton) {
      if (!isOpen()) return;
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (focusButton) button.focus();
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
        close(false);
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
        writeCookie(formatPos(pos), domain);
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

    // Otra aplicación pudo cambiar la posición mientras esta pestaña estaba
    // en segundo plano.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible' || drag) return;
      const saved = parsePos(readCookie());
      if (formatPos(saved) !== formatPos(pos)) {
        pos = saved;
        placeButton();
        if (isOpen()) placePanel();
      }
    });

    placeButton();
    document.documentElement.appendChild(host);
  }

  function init() {
    if (window.top !== window.self) return;
    if (Math.min(screen.width, screen.height) < MIN_SCREEN) return;
    if (document.querySelector('domo-menu')) return;
    fetch('/__menu/apps.json', { credentials: 'omit', cache: 'no-cache' })
      .then(function (response) {
        if (!response.ok) throw new Error(response.status);
        return response.json();
      })
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
    });
    return;
  }

  try {
    init();
  } catch (e) {
    // Sin menú, pero la aplicación sigue igual.
  }
})();
