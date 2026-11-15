// Pruebas de las funciones puras del menú: node --test script/menu.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./menu.js', import.meta.url), 'utf8');
let menu;
vm.runInNewContext(source, { URL, __DOMO_MENU_TEST__: (api) => (menu = api) });

const loc = (hostname, port = '', protocol = 'https:') => ({ hostname, port, protocol });

test('commonDomain', () => {
  assert.equal(menu.commonDomain('board.casa.example.com'), 'casa.example.com');
  assert.equal(menu.commonDomain('nas.lan'), 'lan');
  assert.equal(menu.commonDomain('localhost'), '');
  assert.equal(menu.commonDomain('192.168.1.10'), '');
  assert.equal(menu.commonDomain('::1'), '');
  assert.equal(menu.commonDomain('board.example.com', '.Otro.Example'), 'otro.example');
});

test('parsePos y formatPos', () => {
  assert.deepEqual({ ...menu.parsePos('left:0.25') }, { edge: 'left', offset: 0.25 });
  assert.deepEqual({ ...menu.parsePos('top:1') }, { edge: 'top', offset: 1 });
  assert.deepEqual({ ...menu.parsePos('arriba:0.5') }, { edge: 'right', offset: 0.5 });
  assert.deepEqual({ ...menu.parsePos('') }, { edge: 'right', offset: 0.5 });
  assert.equal(menu.formatPos({ edge: 'bottom', offset: 0.5 }), 'bottom:0.500');
});

test('snap pega el botón al borde más cercano', () => {
  // Pantalla de 1000 x 800 y botón de 44.
  assert.deepEqual({ ...menu.snap(10, 400, 1000, 800, 44) }, { edge: 'left', offset: 0.5 });
  assert.deepEqual({ ...menu.snap(990, 22, 1000, 800, 44) }, { edge: 'right', offset: 0 });
  assert.deepEqual({ ...menu.snap(500, 795, 1000, 800, 44) }, { edge: 'bottom', offset: 0.5 });
  // Cerca de una esquina queda exactamente en la esquina.
  assert.deepEqual({ ...menu.snap(5, 3, 1000, 800, 44) }, { edge: 'top', offset: 0 });
  assert.deepEqual({ ...menu.snap(999, 799, 1000, 800, 44) }, { edge: 'right', offset: 1 });
});

test('buttonCenter deja el círculo a 26 px del borde', () => {
  // Pantalla de 1000 x 800; el botón mide 72 a lo largo del borde.
  assert.deepEqual({ ...menu.buttonCenter({ edge: 'right', offset: 0.5 }, 1000, 800) }, { x: 974, y: 400 });
  assert.deepEqual({ ...menu.buttonCenter({ edge: 'left', offset: 0 }, 1000, 800) }, { x: 26, y: 36 });
  assert.deepEqual({ ...menu.buttonCenter({ edge: 'bottom', offset: 1 }, 1000, 800) }, { x: 964, y: 774 });
  assert.deepEqual({ ...menu.buttonCenter({ edge: 'top', offset: 0.5 }, 1000, 800) }, { x: 500, y: 26 });
});

test('snap y buttonCenter son inversos', () => {
  for (const edge of ['top', 'right', 'bottom', 'left']) {
    for (const offset of [0, 0.3, 1]) {
      const c = menu.buttonCenter({ edge, offset }, 1000, 800);
      const back = menu.snap(c.x, c.y, 1000, 800, 72);
      assert.deepEqual({ ...back }, { edge, offset }, `${edge}:${offset}`);
    }
  }
});

test('openShape cabe en la pantalla y deja el botón en la cabecera', () => {
  // Borde derecho, botón a media altura: la ventana se centra en la cabecera.
  const g = menu.openShape('right', 400, 1000, 800, 384, 300);
  assert.deepEqual({ ...g }, { depth: 384, s0: 374, s1: 674, r: 20, spread: 20 });
  // Botón abajo del todo: la ventana sube para caber.
  const low = menu.openShape('right', 790, 1000, 800, 384, 300);
  assert.equal(low.s1, 800 - 28);
  // Contenido más alto que la pantalla: se recorta.
  const tall = menu.openShape('left', 400, 1000, 600, 384, 2000);
  assert.deepEqual([tall.s0, tall.s1], [28, 572]);
  // Pantalla estrecha, borde de abajo: el ancho se recorta.
  const narrow = menu.openShape('bottom', 180, 360, 800, 384, 300);
  assert.deepEqual([narrow.s0, narrow.s1, narrow.depth], [28, 332, 300]);
});

test('appUrl y appList', () => {
  const l = loc('board.casa.example.com', '8443');
  assert.equal(menu.appUrl({ name: 'fotos' }, l, 'casa.example.com'), 'https://fotos.casa.example.com:8443/');
  assert.equal(menu.appUrl({ name: 'nas', host: 'nas.otro.net' }, l, 'casa.example.com'), 'https://nas.otro.net:8443/');
  assert.equal(menu.appUrl({ name: 'fotos' }, l, ''), '');

  const list = menu.appList({ apps: [{ name: 'board' }, { name: 'fotos' }] }, loc('board.casa.example.com'));
  assert.deepEqual(
    list.map((a) => ({ ...a })),
    [
      { name: 'board', url: 'https://board.casa.example.com/', current: true, category: '', icon: '' },
      { name: 'fotos', url: 'https://fotos.casa.example.com/', current: false, category: '', icon: '' },
    ]
  );
  assert.equal(menu.appList({ apps: [{ name: 'a' }] }, loc('192.168.1.2')).length, 0);
  assert.equal(menu.appList({}, loc('a.b.c')).length, 0);
});

test('appList usa el nombre visible, la categoría y el icono', () => {
  const [app] = menu.appList(
    { apps: [{ name: 'immich', title: 'Fotos', category: 'Media', icon: '/__menu/iconos/immich.svg' }] },
    loc('board.casa.example.com')
  );
  assert.equal(app.name, 'Fotos');
  assert.equal(app.category, 'Media');
  assert.equal(app.icon, '/__menu/iconos/immich.svg');
  assert.equal(app.url, 'https://immich.casa.example.com/');
});

test('groupApps', () => {
  const a = (name, category) => ({ name, category });
  const names = (groups) => JSON.parse(JSON.stringify(groups.map((g) => [g.name, g.apps.map((x) => x.name)])));
  const cats = ['Casa', 'Media', 'Administración'];

  assert.deepEqual(names(menu.groupApps([a('fotos', 'Media'), a('panel', 'Administración'), a('raro', '')], cats)), [
    ['Media', ['fotos']],
    ['Administración', ['panel']],
    ['Otras', ['raro']],
  ]);
  // Sin categorías, una lista plana sin encabezado.
  assert.deepEqual(names(menu.groupApps([a('x', ''), a('y', '')], cats)), [['', ['x', 'y']]]);
  assert.deepEqual(names(menu.groupApps([a('x', 'Media')], [])), [['', ['x']]]);
  assert.deepEqual(names(menu.groupApps([], cats)), []);
});

test('outline', () => {
  const nums = (d) => d.match(/-?[\d.]+/g).map(Number);
  const pairs = (d) => {
    const n = nums(d.replace(/A [\d.]+ [\d.]+ 0 0 [01]/g, 'A'));
    const out = [];
    for (let i = 0; i < n.length; i += 2) out.push([n[i], n[i + 1]]);
    return out;
  };
  const closed = menu.closedShape(400);
  // Borde izquierdo: empieza y acaba en el borde, a 36 px del centro.
  let pts = pairs(menu.outline('left', 1000, 800, closed));
  assert.deepEqual(pts[0], [0, 364]);
  assert.deepEqual(pts.at(-1), [0, 436]);
  // Las curvas llegan arriba y abajo del círculo, sobre su centro (26 px).
  assert.ok(pts.some((p) => p[0] === 26 && p[1] === 378));
  assert.ok(pts.some((p) => p[0] === 26 && p[1] === 422));
  // Y el punto más lejano del borde es el del círculo: 48 px.
  assert.equal(Math.max(...pts.map((p) => p[0])), 48);

  // Borde derecho: lo mismo reflejado, con los arcos al revés.
  const right = menu.outline('right', 1000, 800, closed);
  pts = pairs(right);
  assert.deepEqual(pts[0], [1000, 364]);
  assert.equal(Math.min(...pts.map((p) => p[0])), 952);
  assert.match(right, / A 22 22 0 0 0 /);
  assert.match(menu.outline('left', 1000, 800, closed), / A 22 22 0 0 1 /);

  // Borde de arriba: las curvas llegan a los lados del círculo.
  pts = pairs(menu.outline('top', 1000, 800, closed));
  assert.deepEqual(pts[0], [364, 0]);
  assert.ok(pts.some((p) => p[0] === 378 && p[1] === 26));

  // Abierta: el rectángulo de la ventana.
  const open = menu.openShape('bottom', 500, 1000, 800, 384, 300);
  pts = pairs(menu.outline('bottom', 1000, 800, open));
  assert.equal(Math.min(...pts.map((p) => p[1])), 800 - 4 - 300);
});
