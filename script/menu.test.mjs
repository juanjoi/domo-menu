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

test('placement nunca separa el botón del perímetro', () => {
  assert.deepEqual({ ...menu.placement({ edge: 'right', offset: 0.5 }, 1000, 800, 44) }, { x: 956, y: 378 });
  assert.deepEqual({ ...menu.placement({ edge: 'left', offset: 0 }, 1000, 800, 44) }, { x: 0, y: 0 });
  assert.deepEqual({ ...menu.placement({ edge: 'bottom', offset: 1 }, 1000, 800, 44) }, { x: 956, y: 756 });
  assert.deepEqual({ ...menu.placement({ edge: 'top', offset: 0.5 }, 1000, 800, 44) }, { x: 478, y: 0 });
});

test('snap y placement son inversos', () => {
  for (const edge of ['top', 'right', 'bottom', 'left']) {
    for (const offset of [0, 0.3, 1]) {
      const p = menu.placement({ edge, offset }, 1000, 800, 44);
      const s = menu.snap(p.x + 22, p.y + 22, 1000, 800, 44);
      // En las esquinas dos bordes empatan: lo que importa es el punto.
      const back = menu.placement(s, 1000, 800, 44);
      assert.deepEqual({ ...back }, { ...p }, `${edge}:${offset}`);
    }
  }
});

test('panelPlacement queda dentro de la pantalla', () => {
  const p = menu.panelPlacement({ edge: 'right', offset: 1 }, { x: 956, y: 756 }, 260, 300, 1000, 800);
  assert.deepEqual({ ...p }, { x: 688, y: 492 });
  const q = menu.panelPlacement({ edge: 'left', offset: 0 }, { x: 0, y: 0 }, 260, 300, 1000, 800);
  assert.deepEqual({ ...q }, { x: 52, y: 8 });
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
    { apps: [{ name: 'immich', title: 'Fotos', category: 'Familia', icon: '/__menu/iconos/immich.svg' }] },
    loc('board.casa.example.com')
  );
  assert.equal(app.name, 'Fotos');
  assert.equal(app.category, 'Familia');
  assert.equal(app.icon, '/__menu/iconos/immich.svg');
  assert.equal(app.url, 'https://immich.casa.example.com/');
});

test('groupApps', () => {
  const a = (name, category) => ({ name, category });
  const names = (groups) => JSON.parse(JSON.stringify(groups.map((g) => [g.name, g.apps.map((x) => x.name)])));
  const cats = ['Infraestructura', 'Familia', 'Domótica'];

  assert.deepEqual(names(menu.groupApps([a('fotos', 'Familia'), a('panel', 'Infraestructura'), a('raro', '')], cats)), [
    ['Infraestructura', ['panel']],
    ['Familia', ['fotos']],
    ['Otras', ['raro']],
  ]);
  // Sin categorías, una lista plana sin encabezado.
  assert.deepEqual(names(menu.groupApps([a('x', ''), a('y', '')], cats)), [['', ['x', 'y']]]);
  assert.deepEqual(names(menu.groupApps([a('x', 'Familia')], [])), [['', ['x']]]);
  assert.deepEqual(names(menu.groupApps([], cats)), []);
});
