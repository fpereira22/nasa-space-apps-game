/**
 * MODO 3D — Interior de la U.S.S. Aether con un astronauta que camina por la nave.
 *
 * Plano de la nave (vista desde arriba, el norte es -Z):
 *
 *                 [ SALA DE ENERGÍA ]  -> módulo 01 CABLES
 *                         |
 *  [ COMUNICACIONES ] — [ PUENTE ] — [ NÚCLEO DEL REACTOR ]
 *    módulo 04 FASE       (inicio)      módulo 02 NÚCLEO
 *                         |
 *                 [ ESCUDO TÉRMICO ]   -> módulo 03 ESCUDO
 *
 * Cada sala tiene una consola con el módulo como PANEL 3D: se apunta y se hace clic directamente
 * (ship3d/panels.js). Con E se abre además el MISMO tablero de siempre en "vista de cerca",
 * mostrando solo el módulo de esa sala (tablero.html -> ViewMode.openStation).
 *
 * Controles: WASD / flechas = moverse · Shift = correr · Espacio = saltar con baja gravedad
 *            mouse = mirar (clic para capturarlo)
 *            V = cambiar cámara (1ª / 3ª persona) · E = usar consola · Esc = soltar el mouse
 *            Pantalla táctil: arrastrar a la izquierda = moverse, a la derecha = mirar.
 *
 * Módulos: ship3d/textures.js (texturas fotográficas CC0 de Poly Haven + generadas), astronaut.js
 * (traje estilo EMU), props.js (puertas, tuberías, equipos), panels.js (módulos 3D), sfx.js (sonido)
 * y helmet.js (casco en 1ª persona, mira). Controles extra: M = sonido, clic = usar panel.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
// Módulos del modo 3D realista (public/ship3d/)
import { createShipMaterials } from './ship3d/textures.js';
import { buildAstronaut as buildEmuAstronaut } from './ship3d/astronaut.js';
import { loadMocap, createMocapRig } from './ship3d/mocap.js';
import { buildProps } from './ship3d/props.js';
import { createPanels } from './ship3d/panels.js';
import { createSfx } from './ship3d/sfx.js';
import { createHelmetUI } from './ship3d/helmet.js';
import { createHandPad } from './ship3d/handpad.js';
import { BRIDGE, buildBridge, createOrbitalBackdrop, ORBIT } from './ship3d/world.js';

// ---------------------------------------------------------------------------
// Plano
// ---------------------------------------------------------------------------
const WALL_H = BRIDGE.height;
const DOOR_H = BRIDGE.doorHeight;
const PLAYER_R = 0.35; // radio del astronauta para chocar con paredes
const PLAYER_H = 2.15; // casco y luces incluidos, con margen para la animación
const WALK_SPEED = 2;
const RUN_SPEED = 3.4;
const GRAVITY = 1.62; // gravedad artificial baja, de tipo lunar (m/s²)
const JUMP_SPEED = 1.8; // impulso vertical: ~1 m de altura y ~2,2 s en el aire
const USE_DIST = 2.2; // distancia para poder usar una consola

const ROOMS = [
  { key: 'hub', name: 'PUENTE DE MANDO', x0: -BRIDGE.halfWidth, x1: BRIDGE.halfWidth, z0: BRIDGE.front, z1: BRIDGE.back, color: 0x38bdf8 },
  { key: 'wires', name: 'SALA DE ENERGÍA', module: '01 // CABLES', x0: -6, x1: 6, z0: -22, z1: -12, color: 0xfacc15,
    station: { x: 0, z: -19.6, rot: 0 }, window: { edge: 'z0', from: -3, to: 3 } },
  { key: 'button', name: 'NÚCLEO DEL REACTOR', module: '02 // NÚCLEO', x0: -6, x1: 6, z0: 12, z1: 22, color: 0xf97316,
    station: { x: 0, z: 19.6, rot: Math.PI }, window: { edge: 'z1', from: -3, to: 3 } },
  { key: 'simon', name: 'ESCUDO TÉRMICO', module: '03 // ESCUDO', x0: 12, x1: 22, z0: -6, z1: 6, color: 0x22d3ee,
    station: { x: 19.6, z: 0, rot: -Math.PI / 2 }, window: { edge: 'x1', from: -3, to: 3 } },
  { key: 'keypad', name: 'COMUNICACIONES', module: '04 // FASE', x0: -22, x1: -12, z0: -6, z1: 6, color: 0xa78bfa,
    station: { x: -19.6, z: 0, rot: Math.PI / 2 }, window: { edge: 'x0', from: -3, to: 3 } }
];
const CORRIDORS = [
  { key: 'c-wires', to: 'wires', x0: -1.5, x1: 1.5, z0: -12, z1: -6 },
  { key: 'c-button', to: 'button', x0: -BRIDGE.doorHalfWidth, x1: BRIDGE.doorHalfWidth, z0: BRIDGE.back, z1: BRIDGE.reactorDoor },
  { key: 'c-simon', to: 'simon', x0: 6, x1: 12, z0: -1.5, z1: 1.5 },
  { key: 'c-keypad', to: 'keypad', x0: -12, x1: -6, z0: -1.5, z1: 1.5 }
];
const RECTS = [...ROOMS, ...CORRIDORS];
const roomByKey = Object.fromEntries(ROOMS.map((r) => [r.key, r]));
const STATION_ROOMS = ROOMS.filter((r) => r.station);

// Punto frente a cada consola donde se para el astronauta para usarla
STATION_ROOMS.forEach((r) => {
  const s = r.station;
  s.useX = s.x + Math.sin(s.rot) * 1.6;
  s.useZ = s.z + Math.cos(s.rot) * 1.6;
});

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
let renderer, scene, camera, clock;
let built = false;
let running = false;
let rafId = null;
let inputEnabled = true;
let cameraMode = 'third'; // 'third' | 'cinematic' | 'wide' | 'first'

// Modos de cámara (V los recorre en este orden)
//  - focusY: altura del punto que se sigue (pecho/cabeza del astronauta)
//  - dist:   distancia detrás del personaje
//  - shift:  desplazamiento del encuadre (fracción del ancho) para dejar al personaje a un lado
//  - letterbox: franjas negras de cine (2.39:1)
const CAMERA_MODES = {
  third: { label: '3ª PERSONA', fov: 70, dist: 3.4, focusY: 1.45, lookUp: 0.25, shift: 0, letterbox: false },
  cinematic: { label: 'CINEMÁTICA', fov: 48, dist: 4.6, focusY: 1.35, lookUp: 0.2, shift: 0.22, letterbox: true },
  wide: { label: 'GRAN ANGULAR 0.5×', fov: 108, dist: 2.3, focusY: 1.4, lookUp: 0.1, shift: 0, letterbox: false },
  first: { label: '1ª PERSONA', fov: 70, letterbox: false }
};
const CAMERA_ORDER = ['third', 'cinematic', 'wide', 'first'];
const LETTERBOX_RATIO = 2.39;
const camState = { dist: 3.4, fov: 70, shift: 0, side: 1, band: 0 };

const player = { x: 0, y: 0, z: 2, vy: 0, grounded: true, yaw: 0, pitch: -0.12, bodyYaw: Math.PI };
let jumpRequested = false;
const keys = new Set();
const wallMeshes = [];
const roomLights = {}; // key -> PointLight
const stations = {}; // key -> { marker, screen, drawScreen, lastSolved }
let astronaut, emu;
let props, panels, sfx, helmet, handpad, headlamp;
let bridge, orbit;
let hoverPart = null; // parte de un panel 3D bajo la mira
let mousePos = null; // posición del mouse cuando no está capturado
let touchPress = null; // dedo que está presionando un panel
let lastStrikes = 0;
let shake = 0;
let nearStation = null;
let hudTimer = 0;
const touch = { move: null, look: null, vec: { x: 0, y: 0 } };

const $ = (id) => document.getElementById(id);
const game = () => window.GameState;

// ---------------------------------------------------------------------------
// Texturas generadas por código (paneles de metal, rejilla del piso, letreros)
// ---------------------------------------------------------------------------
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function textPlane(lines, { width, height, color = '#e2e8f0', bg = 'rgba(8,12,22,0.92)', border = '#475569', px = 512 }) {
  const h = Math.round((px * height) / width);
  const tex = canvasTexture(px, h, (g, w, hh) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, hh);
    g.strokeStyle = border;
    g.lineWidth = 6;
    g.strokeRect(3, 3, w - 6, hh - 6);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((line, i) => {
      g.fillStyle = line.color || color;
      g.font = `${line.weight || 700} ${line.size}px Orbitron, "Share Tech Mono", monospace`;
      g.fillText(line.text, w / 2, (hh * (i + 1)) / (lines.length + 1));
    });
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
}

// ---------------------------------------------------------------------------
// Construcción de la nave
// ---------------------------------------------------------------------------
const MAT = {};

function buildMaterials() {
  // Paredes y piso con texturas fotográficas (Poly Haven, CC0); techo con paneles generados
  const ship = createShipMaterials();
  MAT.wall = ship.wall;
  MAT.floor = ship.floor;
  MAT.ceiling = ship.ceiling;
  MAT.trim = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.5, metalness: 0.6 });
  MAT.desk = new THREE.MeshStandardMaterial({ color: 0x2d3748, roughness: 0.45, metalness: 0.5 });
  MAT.glass = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.9 });
}

// Todas las paredes comparten un material; las UV van en metros (worldUV) para que la
// textura tenga el mismo tamaño en paredes largas y cortas
function wallMaterial() {
  return MAT.wall;
}

// UV de una caja en metros: cada cara recibe su ancho/alto real
function worldUV(geo, sx, sy, sz) {
  const uv = geo.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]]; // +x, -x, +y, -y, +z, -z
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]);
    }
  }
  uv.needsUpdate = true;
}

// Caja de pared entre dos puntos sobre una línea horizontal o vertical
function addBox(axis, line, a, b, y0, y1, material) {
  const len = b - a;
  if (len <= 0.01) return null;
  const T = 0.2;
  const geo = axis === 'x' ? new THREE.BoxGeometry(len, y1 - y0, T) : new THREE.BoxGeometry(T, y1 - y0, len);
  if (axis === 'x') worldUV(geo, len, y1 - y0, T);
  else worldUV(geo, T, y1 - y0, len);
  const mesh = new THREE.Mesh(geo, material || wallMaterial(len));
  const mid = (a + b) / 2;
  if (axis === 'x') mesh.position.set(mid, (y0 + y1) / 2, line);
  else mesh.position.set(line, (y0 + y1) / 2, mid);
  scene.add(mesh);
  wallMeshes.push(mesh);
  return mesh;
}

function subtractIntervals(a, b, holes) {
  let segs = [[a, b]];
  holes.forEach(([h0, h1]) => {
    segs = segs.flatMap(([s0, s1]) => {
      if (h1 <= s0 || h0 >= s1) return [[s0, s1]];
      const out = [];
      if (h0 > s0) out.push([s0, h0]);
      if (h1 < s1) out.push([h1, s1]);
      return out;
    });
  });
  return segs;
}

function buildWalls() {
  const lintels = new Set();
  RECTS.forEach((r) => {
    if (r.key === 'hub') return; // El puente se construye también en la cinemática.
    // Cada borde: 'z0'/'z1' son paredes a lo largo de X; 'x0'/'x1' a lo largo de Z
    const edges = [
      { edge: 'z0', axis: 'x', line: r.z0, a: r.x0, b: r.x1 },
      { edge: 'z1', axis: 'x', line: r.z1, a: r.x0, b: r.x1 },
      { edge: 'x0', axis: 'z', line: r.x0, a: r.z0, b: r.z1 },
      { edge: 'x1', axis: 'z', line: r.x1, a: r.z0, b: r.z1 }
    ];
    edges.forEach((e) => {
      // Huecos donde otro espacio toca este borde (puertas)
      const holes = [];
      RECTS.forEach((o) => {
        if (o === r) return;
        let touches;
        if (e.axis === 'x') touches = (e.edge === 'z0' ? o.z1 : o.z0) === e.line;
        else touches = (e.edge === 'x0' ? o.x1 : o.x0) === e.line;
        if (!touches) return;
        const lo = Math.max(e.a, e.axis === 'x' ? o.x0 : o.z0);
        const hi = Math.min(e.b, e.axis === 'x' ? o.x1 : o.z1);
        if (hi - lo > 0.01) holes.push([lo, hi, o.key]);
      });

      holes.forEach(([h0, h1, toKey]) => {
        const id = `${e.axis}:${e.line}:${h0}:${h1}`;
        if (lintels.has(id)) return;
        lintels.add(id);
        if (toKey !== 'hub') addBox(e.axis, e.line, h0, h1, DOOR_H, WALL_H);
        // Marco de la puerta con luz del color de la sala de destino
        addDoorFrame(e.axis, e.line, h0, h1, doorColor(r, e));
      });

      const win = r.window && r.window.edge === e.edge ? r.window : null;
      subtractIntervals(e.a, e.b, holes).forEach(([s0, s1]) => {
        if (win && win.from >= s0 && win.to <= s1) {
          addBox(e.axis, e.line, s0, win.from, 0, WALL_H);
          addBox(e.axis, e.line, win.to, s1, 0, WALL_H);
          addBox(e.axis, e.line, win.from, win.to, 0, 1.0);
          addBox(e.axis, e.line, win.from, win.to, 2.3, WALL_H);
          const glass = new THREE.Mesh(
            e.axis === 'x' ? new THREE.PlaneGeometry(win.to - win.from, 1.3) : new THREE.PlaneGeometry(win.to - win.from, 1.3),
            MAT.glass
          );
          if (e.axis === 'x') glass.position.set((win.from + win.to) / 2, 1.65, e.line);
          else {
            glass.position.set(e.line, 1.65, (win.from + win.to) / 2);
            glass.rotation.y = Math.PI / 2;
          }
          scene.add(glass);
        } else {
          addBox(e.axis, e.line, s0, s1, 0, WALL_H);
        }
      });
    });
  });
}

function doorColor(rect, e) {
  // Color de la sala hacia la que lleva la puerta
  const c = CORRIDORS.find((cor) => cor === rect) || CORRIDORS.find((cor) => {
    if (e.axis === 'x') return (e.edge === 'z0' ? cor.z1 : cor.z0) === e.line && cor.x0 >= rect.x0 && cor.x1 <= rect.x1;
    return (e.edge === 'x0' ? cor.x1 : cor.x0) === e.line && cor.z0 >= rect.z0 && cor.z1 <= rect.z1;
  });
  return c ? roomByKey[c.to].color : 0x38bdf8;
}

function addDoorFrame(axis, line, a, b, color) {
  const glow = new THREE.MeshBasicMaterial({ color });
  const T = 0.26;
  const pieces = [
    [a - 0.08, a + 0.08, 0, DOOR_H],
    [b - 0.08, b + 0.08, 0, DOOR_H],
    [a - 0.08, b + 0.08, DOOR_H - 0.08, DOOR_H + 0.04]
  ];
  pieces.forEach(([p0, p1, y0, y1]) => {
    const geo = axis === 'x' ? new THREE.BoxGeometry(p1 - p0, y1 - y0, T) : new THREE.BoxGeometry(T, y1 - y0, p1 - p0);
    const m = new THREE.Mesh(geo, glow);
    const mid = (p0 + p1) / 2;
    if (axis === 'x') m.position.set(mid, (y0 + y1) / 2, line);
    else m.position.set(line, (y0 + y1) / 2, mid);
    scene.add(m);
  });
}

function buildFloorsAndCeilings() {
  RECTS.forEach((r) => {
    if (r.key === 'hub') return;
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    // Piso y techo con UV en metros (un solo material compartido)
    const planeGeo = () => {
      const g = new THREE.PlaneGeometry(w, d);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
      return g;
    };
    const floor = new THREE.Mesh(planeGeo(), MAT.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
    scene.add(floor);

    const ceil = new THREE.Mesh(planeGeo(), MAT.ceiling);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set((r.x0 + r.x1) / 2, WALL_H, (r.z0 + r.z1) / 2);
    scene.add(ceil);

    // Franjas de luz en el techo (delgadas, a lo largo del espacio)
    const along = w >= d;
    const stripMat = new THREE.MeshStandardMaterial({ color: 0x364b63, emissive: 0xbfe6ff, emissiveIntensity: 1.4 });
    const offsets = r.to ? [0] : [-0.3, 0.3].map((f) => f * Math.min(w, d));
    offsets.forEach((off) => {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(along ? w * 0.6 : 0.08, 0.02, along ? 0.08 : d * 0.6), stripMat);
      strip.position.set((r.x0 + r.x1) / 2 + (along ? 0 : off), WALL_H - 0.01, (r.z0 + r.z1) / 2 + (along ? off : 0));
      scene.add(strip);
    });

    // Pasillos: líneas de luz en el piso que guían hacia la sala (color de la sala)
    if (r.to) {
      const color = roomByKey[r.to].color;
      const mat = new THREE.MeshBasicMaterial({ color });
      const horizontal = w > d;
      [-1, 1].forEach((side) => {
        const line = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? w : 0.06, 0.02, horizontal ? 0.06 : d), mat);
        line.position.set(
          (r.x0 + r.x1) / 2 + (horizontal ? 0 : side * 1.2),
          0.01,
          (r.z0 + r.z1) / 2 + (horizontal ? side * 1.2 : 0)
        );
        scene.add(line);
      });
    }
  });
}

const alarmLights = {}; // key -> PointLight roja que pulsa mientras el módulo esté en falla

function buildLights() {
  scene.add(new THREE.HemisphereLight(0xb4c6e6, 0x1a2030, 0.35));
  ROOMS.forEach((r) => {
    const light = new THREE.PointLight(0x9fb6ff, r.key === 'hub' ? 5 : 22, 18, 1.4);
    light.position.set((r.x0 + r.x1) / 2, WALL_H - 0.5, (r.z0 + r.z1) / 2);
    scene.add(light);
    roomLights[r.key] = light;
    const alarm = new THREE.PointLight(0xff2a2a, 0, 14, 1.5);
    alarm.position.set((r.x0 + r.x1) / 2, WALL_H - 0.3, (r.z0 + r.z1) / 2);
    scene.add(alarm);
    alarmLights[r.key] = alarm;
  });
  CORRIDORS.forEach((c) => {
    const light = new THREE.PointLight(0xcfe3ff, 4, 7, 1.8);
    light.position.set((c.x0 + c.x1) / 2, WALL_H - 0.4, (c.z0 + c.z1) / 2);
    scene.add(light);
  });
  const sun = new THREE.DirectionalLight(0xfff3d6, 1.2);
  sun.position.set(...ORBIT.sun).multiplyScalar(200);
  scene.add(sun);
}

function buildSpace() {
  orbit = createOrbitalBackdrop(scene);
}

function buildHub() {
  // Letreros sobre cada pasillo, mirando hacia el puente
  const signs = [
    { room: 'wires', x: 0, z: -5.86, rot: 0, arrow: '▲' },
    { room: 'simon', x: 5.86, z: 0, rot: -Math.PI / 2, arrow: '▶' },
    { room: 'button', x: 0, z: 5.86, rot: Math.PI, arrow: '▼' },
    { room: 'keypad', x: -5.86, z: 0, rot: Math.PI / 2, arrow: '◀' }
  ];
  signs.forEach((s) => {
    const room = roomByKey[s.room];
    const hex = `#${room.color.toString(16).padStart(6, '0')}`;
    const sign = textPlane(
      [
        { text: room.name, size: 34, color: hex },
        { text: room.module, size: 26, color: '#cbd5e1', weight: 500 }
      ],
      { width: 2.9, height: 0.55, border: hex }
    );
    sign.position.set(s.x, DOOR_H + 0.3, s.z);
    sign.rotation.y = s.rot;
    scene.add(sign);
  });

  // Letrero del puente
  const bridge = textPlane([{ text: 'U.S.S. AETHER // PUENTE DE MANDO', size: 30, color: '#7dd3fc' }], { width: 4, height: 0.45 });
  bridge.position.set(-3.6, 2.2, 5.88);
  bridge.rotation.y = Math.PI;
  scene.add(bridge);
}

function buildStations() {
  STATION_ROOMS.forEach((r) => {
    const s = r.station;
    const group = new THREE.Group();
    group.position.set(s.x, 0, s.z);
    group.rotation.y = s.rot;

    const desk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.95, 0.8), MAT.desk);
    desk.position.y = 0.475;
    group.add(desk);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.06, 0.9), MAT.trim);
    top.position.y = 0.98;
    group.add(top);

    // Pantalla inclinada con el nombre y estado del módulo
    const screenCanvas = document.createElement('canvas');
    screenCanvas.width = 512;
    screenCanvas.height = 256;
    const screenTex = new THREE.CanvasTexture(screenCanvas);
    screenTex.colorSpace = THREE.SRGBColorSpace;
    // (va más arriba que antes: delante queda el panel 3D del módulo, ver ship3d/panels.js)
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), new THREE.MeshBasicMaterial({ map: screenTex }));
    screen.position.set(0, 1.86, -0.3);
    screen.rotation.x = -0.12;
    group.add(screen);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.88, 0.06), MAT.trim);
    bezel.position.set(0, 1.86, -0.34);
    bezel.rotation.x = -0.12;
    group.add(bezel);
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.06), MAT.trim);
    mast.position.set(0, 1.3, -0.36);
    group.add(mast);

    const hex = `#${r.color.toString(16).padStart(6, '0')}`;
    const drawScreen = (solved, blink) => {
      const g = screenCanvas.getContext('2d');
      g.fillStyle = solved ? '#03140c' : '#170606';
      g.fillRect(0, 0, 512, 256);
      g.strokeStyle = hex;
      g.lineWidth = 8;
      g.strokeRect(4, 4, 504, 248);
      g.textAlign = 'center';
      g.fillStyle = hex;
      g.font = '700 40px Orbitron, monospace';
      g.fillText(`MÓDULO ${r.module}`, 256, 70);
      g.font = '700 54px Orbitron, monospace';
      g.fillStyle = solved ? '#34d399' : blink ? '#ef4444' : '#7f1d1d';
      g.fillText(solved ? 'REPARADO' : '⚠ FALLA', 256, 150);
      g.font = '500 26px "Share Tech Mono", monospace';
      g.fillStyle = '#cbd5e1';
      g.fillText(solved ? 'SISTEMA ESTABLE' : 'REPARA EL PANEL DE ABAJO', 256, 215);
      screenTex.needsUpdate = true;
    };
    drawScreen(false, true);

    // Marcador holográfico flotante (rojo = falla, verde = reparado)
    const marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22),
      new THREE.MeshBasicMaterial({ color: 0xef4444, wireframe: true })
    );
    marker.position.set(0, 2.62, -0.3);
    group.add(marker);

    scene.add(group);
    stations[r.key] = { marker, drawScreen, lastSolved: null, lastBlink: null };

    // Letrero de la sala en la pared del fondo
    const sign = textPlane([{ text: r.name, size: 40, color: hex }], { width: 3.4, height: 0.5, border: hex });
    const back = 2.25;
    sign.position.set(s.x - Math.sin(s.rot) * back, 2.75, s.z - Math.cos(s.rot) * back);
    sign.rotation.y = s.rot;
    scene.add(sign);
  });

  // Decoración: núcleo del reactor (brillo constante: no revela la temperatura,
  // que es un dato que solo ve control en tierra)
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, WALL_H, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.55 })
  );
  core.position.set(4.2, WALL_H / 2, 16);
  scene.add(core);
  const coreFrame = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.3, 24), MAT.trim);
  coreFrame.position.set(4.2, 0.15, 16);
  scene.add(coreFrame);
  scene.userData.core = core;
}


// ---------------------------------------------------------------------------
// Movimiento y choques
// ---------------------------------------------------------------------------
function insideAny(x, z) {
  return RECTS.some((r) => x >= r.x0 - 1e-6 && x <= r.x1 + 1e-6 && z >= r.z0 - 1e-6 && z <= r.z1 + 1e-6);
}

function canStand(x, z) {
  // Un salto no permite atravesar el dintel de una puerta.
  if (player.y > maxJumpHeight(x, z) + 1e-6) return false;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (!insideAny(x + Math.cos(a) * PLAYER_R, z + Math.sin(a) * PLAYER_R)) return false;
  }
  // No atravesar escritorios de las consolas ni la mesa del puente
  if (bridge && bridge.obstacles.some((o) => Math.abs(x - o.x) < o.halfX + PLAYER_R && Math.abs(z - o.z) < o.halfZ + PLAYER_R)) return false;
  const obstacles = [{ x: 4.2, z: 16, r: 0.8 }];
  STATION_ROOMS.forEach((room) => {
    const s = room.station;
    obstacles.push({ x: s.x, z: s.z, r: 1.15 });
  });
  if (props) obstacles.push(...props.obstacles); // racks, bancos de energía, tanques...
  return obstacles.every((o) => Math.hypot(x - o.x, z - o.z) > o.r + PLAYER_R * 0.6);
}

function maxJumpHeight(x, z) {
  let ceiling = WALL_H - 0.05;
  for (const c of CORRIDORS) {
    const alongZ = c.z1 - c.z0 > c.x1 - c.x0;
    const across = alongZ ? x : z;
    const along = alongZ ? z : x;
    const lo = alongZ ? c.x0 : c.z0;
    const hi = alongZ ? c.x1 : c.z1;
    const ends = alongZ ? [c.z0, c.z1] : [c.x0, c.x1];
    if (across >= lo - PLAYER_R && across <= hi + PLAYER_R &&
        ends.some((end) => Math.abs(along - end) <= PLAYER_R + 0.14)) {
      ceiling = Math.min(ceiling, DOOR_H - 0.08);
    }
  }
  return Math.max(0, ceiling - PLAYER_H);
}

// Sala o pasillo en un punto (para el audio espacial de voice.js)
function areaAt(x, z) {
  const r = ROOMS.find((a) => x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1) ||
    CORRIDORS.find((a) => x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1) || roomByKey.hub;
  return {
    key: r.key,
    kind: r.key === 'hub' ? 'hub' : r.to ? 'corridor' : 'room',
    x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, y0: 0, y1: WALL_H
  };
}

function currentArea() {
  const room = ROOMS.find((r) => player.x >= r.x0 && player.x <= r.x1 && player.z >= r.z0 && player.z <= r.z1);
  if (room) return room.name;
  const cor = CORRIDORS.find((r) => player.x >= r.x0 && player.x <= r.x1 && player.z >= r.z0 && player.z <= r.z1);
  return cor ? `PASILLO → ${roomByKey[cor.to].name}` : '';
}

function update(dt) {
  const gs = game();
  const canMove = inputEnabled && gs && !gs.isOver && !handpad.open && !typingTarget({ target: document.activeElement });
  const prevX = player.x;
  const prevZ = player.z;

  // Dirección deseada (teclado o joystick táctil), relativa a la cámara
  let fx = 0;
  let fz = 0;
  if (canMove) {
    if (keys.has('KeyW') || keys.has('ArrowUp')) fz += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) fz -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) fx += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) fx -= 1;
    fx += touch.vec.x;
    fz += touch.vec.y;
  }
  const mag = Math.min(1, Math.hypot(fx, fz));
  if (mag > 0.05) {
    const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED) * mag;
    const nx = fx / Math.hypot(fx, fz);
    const nz = fz / Math.hypot(fx, fz);
    // Adelante = hacia donde mira la cámara
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    const dx = (-sin * nz + cos * nx) * speed * dt;
    const dz = (-cos * nz - sin * nx) * speed * dt;
    if (canStand(player.x + dx, player.z)) player.x += dx;
    if (canStand(player.x, player.z + dz)) player.z += dz;
    const targetYaw = Math.atan2(dx, dz);
    let diff = targetYaw - player.bodyYaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    player.bodyYaw += diff * Math.min(1, dt * 12);
  }
  if (cameraMode === 'first') player.bodyYaw = player.yaw + Math.PI;

  if (jumpRequested && canMove && player.grounded && dt > 0) {
    player.vy = JUMP_SPEED;
    player.grounded = false;
  }
  if (dt > 0 || !canMove) jumpRequested = false;
  // La caída continúa aunque se abra una consola o se bloquee la entrada.
  if (!player.grounded && dt > 0) {
    player.y += player.vy * dt - 0.5 * GRAVITY * dt * dt;
    player.vy -= GRAVITY * dt;
    const maxY = maxJumpHeight(player.x, player.z);
    if (player.y >= maxY) {
      player.y = maxY;
      player.vy = Math.min(0, player.vy);
    }
    if (player.y <= 0) {
      player.y = 0;
      player.vy = 0;
      player.grounded = true;
    }
  }

  // Astronauta
  astronaut.position.set(player.x, player.y, player.z);
  astronaut.rotation.y = player.bodyYaw;
  astronaut.visible = cameraMode !== 'first';
  // La animación recibe m/s reales, después de las colisiones (0 al parar o chocar).
  const speed = dt > 0 ? Math.hypot(player.x - prevX, player.z - prevZ) / dt : 0;
  const groundSpeed = player.grounded ? speed : 0;
  const stepped = emu.animate(dt, groundSpeed);
  if (stepped && player.grounded && speed > 0.15) sfx.step(cameraMode === 'first');

  updateCamera(dt);

  // Sacudida de cámara tras un error
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.12;
    camera.position.y += (Math.random() - 0.5) * shake * 0.12;
    shake = Math.max(0, shake - dt * 1.6);
  }

  syncHandPad();
  handpad.update(dt, camera, groundSpeed, gs);

  // Linterna del casco: ilumina hacia donde mira el astronauta
  const lookDir = new THREE.Vector3(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch));
  headlamp.position.set(player.x, player.y + 1.85, player.z).addScaledVector(lookDir, 0.25);
  headlamp.target.position.copy(headlamp.position).addScaledVector(lookDir, 4);

  // Errores: destello rojo, sacudida y zumbido corto (la voz de la nave ya lo anuncia)
  if (gs) {
    if (gs.strikes > lastStrikes) {
      helmet.flashStrike();
      sfx.strike();
      shake = 1;
    }
    lastStrikes = gs.strikes;
  }

  // Puertas automáticas, pantallas y equipos animados
  props.update(dt, clock.elapsedTime, player).forEach((e) => {
    if (e.type === 'door') sfx.door(e.open, e.x, e.z);
  });

  // Paneles 3D: copiar el estado del tablero y ver qué se está apuntando
  panels.update();
  updateAim();

  sfx.update({ game: gs, firstPerson: cameraMode === 'first' });
  helmet.setFirstPerson(cameraMode === 'first');
  helmet.update(dt, gs);

  // Consolas: estado, parpadeo y proximidad
  const t = clock.elapsedTime;
  if (orbit) orbit.update(dt, t);
  if (bridge) bridge.update(dt, t, {
    critical: Boolean(gs && !gs.isOver && (gs.timeLeft <= 30 || gs.strikes >= 2)),
    repaired: gs && gs.solved ? Object.values(gs.solved).filter(Boolean).length : 0
  });
  const blink = Math.floor(t * 2) % 2 === 0;
  nearStation = null;
  STATION_ROOMS.forEach((r) => {
    const st = stations[r.key];
    const solved = Boolean(gs && gs.solved && gs.solved[r.key]);
    if (solved !== st.lastSolved || (!solved && blink !== st.lastBlink)) {
      st.drawScreen(solved, blink);
      st.lastSolved = solved;
      st.lastBlink = blink;
    }
    st.marker.material.color.setHex(solved ? 0x34d399 : 0xef4444);
    st.marker.rotation.y = t * 1.5;
    st.marker.position.y = 2.62 + Math.sin(t * 2) * 0.08;

    // Luz de la sala siempre encendida; además una alarma roja que pulsa mientras haya falla
    roomLights[r.key].intensity = solved ? 26 : 14;
    alarmLights[r.key].intensity = solved ? 0 : 10 + Math.sin(t * 5) * 9;
    if (!solved && Math.hypot(player.x - r.station.useX, player.z - r.station.useZ) < USE_DIST) nearStation = r;
  });
  // Puente: alarma cuando quedan 30 segundos o menos
  const critical = gs && !gs.isOver && gs.timeLeft <= 30;
  alarmLights.hub.intensity = critical ? 12 + Math.sin(t * 8) * 10 : 0;

  if (scene.userData.core) scene.userData.core.material.opacity = 0.45 + Math.sin(t * 3) * 0.1;

  updateHud(dt);
}

// ---------------------------------------------------------------------------
// Apuntar a los paneles 3D: con el mouse capturado se usa la mira del centro;
// si no, la posición del mouse (o del dedo)
// ---------------------------------------------------------------------------
const _aimRay = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

function rayFromScreen(x, y) {
  if (x === null) {
    _ndc.set(0, 0);
  } else {
    // El área dibujada puede tener franjas de cine arriba y abajo (modo cinemático)
    const H = window.innerHeight;
    const viewH = Math.round(H + (Math.min(H, window.innerWidth / LETTERBOX_RATIO) - H) * camState.band);
    const y0 = (H - viewH) / 2;
    _ndc.set((x / window.innerWidth) * 2 - 1, -((y - y0) / viewH) * 2 + 1);
  }
  _aimRay.setFromCamera(_ndc, camera);
  return _aimRay;
}

function pickAt(x, y) {
  const gs = game();
  if (!inputEnabled || !gs || gs.isOver) return null;
  return panels.pick(rayFromScreen(x, y), player);
}

function updateAim() {
  const locked = document.pointerLockElement === renderer.domElement;
  const padOpen = handpad.open;
  const overPad = padOpen && handpad.hover(mousePos ? mousePos.x : null, mousePos ? mousePos.y : null);
  const pick = padOpen ? null : locked ? pickAt(null, null) : mousePos ? pickAt(mousePos.x, mousePos.y) : null;
  if (pick && (!hoverPart || hoverPart.mesh !== pick.mesh)) sfx.hover();
  hoverPart = pick;
  panels.setHover(pick);
  renderer.domElement.style.cursor = overPad || (!locked && pick) ? 'pointer' : '';
  helmet.setAim({
    show: running && inputEnabled && !padOpen,
    locked,
    label: pick ? pick.label : null,
    x: mousePos ? mousePos.x : 0,
    y: mousePos ? mousePos.y : 0
  });
}

// Presionar una parte del panel (mismo efecto que hacer clic en el tablero)
function pressPart(part) {
  panels.press(part);
  if (part.kind === 'wire') sfx.cut();
  else if (part.kind === 'button') sfx.buttonDown();
  else sfx.key();
}

function releasePart() {
  if (panels.release()) sfx.buttonUp();
}

// ---------------------------------------------------------------------------
// Cámara
// ---------------------------------------------------------------------------
const _focus = new THREE.Vector3();
const _back = new THREE.Vector3();
const _ray = new THREE.Raycaster();

function updateCamera(dt) {
  const cfg = CAMERA_MODES[cameraMode];
  const k = Math.min(1, dt * 8);

  // Transiciones suaves de lente, encuadre y franjas de cine
  camState.fov += (cfg.fov - camState.fov) * k;
  camState.shift += ((cfg.shift || 0) * camState.side - camState.shift) * k;
  camState.band += ((cfg.letterbox ? 1 : 0) - camState.band) * k;

  if (cameraMode === 'first') {
    camera.position.set(player.x, player.y + 1.68, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    return;
  }

  // Orbita alrededor del astronauta: siempre apunta a él, así queda centrado
  // (en modo cinemático el encuadre se corre con setViewOffset, no la cámara).
  _focus.set(player.x, player.y + cfg.focusY, player.z);
  _back.set(
    Math.sin(player.yaw) * Math.cos(player.pitch),
    -Math.sin(player.pitch),
    Math.cos(player.yaw) * Math.cos(player.pitch)
  );

  // Evitar que la cámara atraviese paredes: acercarla al instante, alejarla suave
  _ray.set(_focus, _back);
  _ray.far = cfg.dist;
  const hit = _ray.intersectObjects(wallMeshes, false)[0];
  const want = hit ? Math.max(0.5, hit.distance - 0.3) : cfg.dist;
  camState.dist = want < camState.dist ? want : camState.dist + (want - camState.dist) * Math.min(1, dt * 5);

  camera.position.copy(_focus).addScaledVector(_back, camState.dist);
  camera.position.y = Math.min(WALL_H - 0.3, Math.max(0.35, camera.position.y));
  camera.lookAt(_focus.x, _focus.y + cfg.lookUp, _focus.z);
}

// Proyección: lente (fov), franjas de cine y desplazamiento lateral del encuadre
function applyProjection() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const cineH = Math.min(H, W / LETTERBOX_RATIO);
  const viewH = Math.round(H + (cineH - H) * camState.band);
  const y0 = Math.round((H - viewH) / 2);

  renderer.setScissorTest(viewH < H);
  renderer.setViewport(0, y0, W, viewH);
  renderer.setScissor(0, y0, W, viewH);

  camera.fov = camState.fov;
  camera.aspect = W / viewH;
  if (Math.abs(camState.shift) > 0.002) camera.setViewOffset(W, viewH, camState.shift * W, 0, W, viewH);
  else if (camera.view) camera.clearViewOffset();
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------
// HUD (textos en tablero.html) y minimapa
// ---------------------------------------------------------------------------
function updateHud(dt) {
  const prompt = $('interactPrompt');
  const gs = game();
  const showPrompt = nearStation && inputEnabled && gs && !gs.isOver && !handpad.open;
  if (prompt) {
    prompt.classList.toggle('hidden', !showPrompt);
    prompt.classList.toggle('flex', Boolean(showPrompt));
    if (showPrompt) $('interactText').textContent = `VISTA DE CERCA · ${nearStation.module} (o apunta al panel y haz clic)`;
  }

  hudTimer -= dt;
  if (hudTimer > 0) return;
  hudTimer = 0.2;
  if (gs) {
    const mm = String(Math.floor(gs.timeLeft / 60)).padStart(2, '0');
    const ss = String(gs.timeLeft % 60).padStart(2, '0');
    setText('hudTimer', `${mm}:${ss}`);
    setText('hudStrikes', '✕'.repeat(gs.strikes) + '·'.repeat(Math.max(0, gs.maxStrikes - gs.strikes)));
    setText('hudSerial', gs.serial);
    setText('hudBatteries', `${gs.batteries} AA`);
    setText('hudModules', `${Object.values(gs.solved).filter(Boolean).length} / 4`);
  }
  setText('hudRoom', currentArea());
  setText('cameraModeLabel', CAMERA_MODES[cameraMode].label);
  const lockHint = $('lockHint');
  if (lockHint) lockHint.classList.toggle('hidden', document.pointerLockElement === renderer.domElement || !inputEnabled || handpad.open || isTouch());
  drawMinimap();
}

function setText(id, text) {
  const el = $(id);
  if (el && el.textContent !== text) el.textContent = text;
}

function drawMinimap() {
  const c = $('minimap');
  if (!c) return;
  const g = c.getContext('2d');
  const S = c.width;
  const scale = S / 48;
  const X = (x) => (x + 24) * scale;
  const Z = (z) => (z + 24) * scale;
  const gs = game();
  g.clearRect(0, 0, S, S);
  CORRIDORS.forEach((r) => {
    g.fillStyle = '#334155';
    g.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * scale, (r.z1 - r.z0) * scale);
  });
  ROOMS.forEach((r) => {
    const solved = r.station && gs && gs.solved[r.key];
    g.fillStyle = !r.station ? '#1e3a5f' : solved ? '#065f46' : '#7f1d1d';
    g.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * scale, (r.z1 - r.z0) * scale);
    g.strokeStyle = `#${r.color.toString(16).padStart(6, '0')}`;
    g.lineWidth = 1.5;
    g.strokeRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * scale, (r.z1 - r.z0) * scale);
    if (r.station) {
      g.fillStyle = solved ? '#34d399' : '#f87171';
      g.font = 'bold 9px monospace';
      g.textAlign = 'center';
      g.fillText(r.module.slice(0, 2), X((r.x0 + r.x1) / 2), Z((r.z0 + r.z1) / 2) + 3);
    }
  });
  // Astronauta: flecha en la dirección de la cámara
  g.save();
  g.translate(X(player.x), Z(player.z));
  g.rotate(-player.yaw);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(0, -6);
  g.lineTo(4.5, 5);
  g.lineTo(0, 2.5);
  g.lineTo(-4.5, 5);
  g.closePath();
  g.fill();
  g.restore();
}

// ---------------------------------------------------------------------------
// Entrada: teclado, mouse (pointer lock) y táctil
// ---------------------------------------------------------------------------
const isTouch = () => window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
const typingTarget = (e) => e.target && e.target.closest && e.target.closest('input, textarea, [contenteditable]');

function onKeyDown(e) {
  if (!running || typingTarget(e)) return;
  if (e.code === 'KeyQ' || (handpad.open && e.code === 'Escape')) {
    e.preventDefault();
    if (!e.repeat) toggleHandPad();
    return;
  }
  if (!e.repeat && handpad.key(e.code, true)) {
    e.preventDefault();
    return;
  }
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space' && !e.repeat && !keys.has('Space') && inputEnabled &&
      game() && !game().isOver && !handpad.open && player.grounded) jumpRequested = true;
  keys.add(e.code);
  if (e.code === 'KeyV' && !e.repeat) toggleCamera();
  if (e.code === 'KeyC' && !e.repeat) swapCinematicSide();
  if (e.code === 'KeyE' && !e.repeat && inputEnabled && !handpad.open) useStation();
  if (e.code === 'KeyM' && !e.repeat) toggleSound();
}

function toggleSound() {
  sfx.setEnabled(!sfx.enabled);
  helmet.renderSound();
}
function onKeyUp(e) {
  keys.delete(e.code);
  handpad.key(e.code, false);
}

function syncHandPad() {
  if (!handpad) return;
  const gs = game();
  handpad.setVisible(Boolean(running && inputEnabled && cameraMode === 'first' && gs && !gs.isOver));
  helmet.setHandPad({ visible: handpad.visible, open: handpad.open });
}

function clearInput() {
  keys.clear();
  jumpRequested = false;
  touch.move = touch.look = null;
  touch.vec.x = touch.vec.y = 0;
  mouseDrag = null;
  if (handpad) handpad.releaseInput();
  showStick();
}

function toggleHandPad() {
  if (!handpad || !handpad.visible) return;
  clearInput();
  releasePart();
  handpad.toggle();
  if (handpad.open && document.pointerLockElement) document.exitPointerLock();
  mousePos = null;
  syncHandPad();
}

function useStation() {
  if (!nearStation || !window.ViewMode) return;
  if (document.pointerLockElement) document.exitPointerLock();
  window.ViewMode.openStation(nearStation.key);
}

function look(dx, dy) {
  player.yaw -= dx * 0.0026;
  // Detrás del personaje no tiene sentido mirar tan arriba/abajo (la cámara chocaría con piso/techo)
  const [lo, hi] = cameraMode === 'first' ? [-1.1, 0.9] : [-0.75, 0.55];
  player.pitch = Math.max(lo, Math.min(hi, player.pitch - dy * 0.0022));
}

let mouseDrag = null;
function onPointerDown(e) {
  if (!running || !inputEnabled) return;
  if (handpad.open) {
    if (e.button === 0) handpad.pointerDown(e.clientX, e.clientY);
    return;
  }
  const locked = document.pointerLockElement === renderer.domElement;
  // ¿Se está tocando/apuntando una parte de un panel 3D? Entonces se usa el panel
  const part = locked ? hoverPart : pickAt(e.clientX, e.clientY);
  if (part && e.button === 0) {
    pressPart(part);
    if (e.pointerType === 'touch') touchPress = e.pointerId;
    return;
  }
  if (e.pointerType === 'touch') {
    if (e.clientX < window.innerWidth * 0.45 && !touch.move) touch.move = { id: e.pointerId, x: e.clientX, y: e.clientY };
    else if (!touch.look) touch.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    showStick();
    return;
  }
  // Mouse: capturarlo para mirar libremente; si el navegador no lo permite, arrastrar
  if (document.pointerLockElement !== renderer.domElement) {
    try {
      const p = renderer.domElement.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (err) {
      // sin pointer lock: se mira arrastrando
    }
    mouseDrag = { x: e.clientX, y: e.clientY };
  }
}
function onPointerMove(e) {
  if (!running) return;
  if (e.pointerType !== 'touch' && e.target === renderer.domElement) mousePos = { x: e.clientX, y: e.clientY };
  else if (e.pointerType !== 'touch') mousePos = null;
  if (handpad.open) return;
  if (document.pointerLockElement === renderer.domElement) {
    if (inputEnabled) look(e.movementX, e.movementY);
    return;
  }
  if (e.pointerType === 'touch') {
    if (touch.move && e.pointerId === touch.move.id) {
      const dx = e.clientX - touch.move.x;
      const dy = e.clientY - touch.move.y;
      const len = Math.min(60, Math.hypot(dx, dy));
      const a = Math.atan2(dy, dx);
      touch.vec.x = (Math.cos(a) * len) / 60;
      touch.vec.y = -(Math.sin(a) * len) / 60;
      showStick();
    } else if (touch.look && e.pointerId === touch.look.id) {
      look((e.clientX - touch.look.x) * 2, (e.clientY - touch.look.y) * 2);
      touch.look.x = e.clientX;
      touch.look.y = e.clientY;
    }
    return;
  }
  if (mouseDrag && e.buttons & 1) {
    look(e.clientX - mouseDrag.x, e.clientY - mouseDrag.y);
    mouseDrag.x = e.clientX;
    mouseDrag.y = e.clientY;
  }
}
function onPointerUp(e) {
  handpad.pointerUp();
  // Soltar el botón del núcleo (u otra parte que se mantenga presionada)
  if (e.pointerType !== 'touch' || e.pointerId === touchPress) {
    releasePart();
    touchPress = null;
  }
  if (touch.move && e.pointerId === touch.move.id) {
    touch.move = null;
    touch.vec.x = touch.vec.y = 0;
  }
  if (touch.look && e.pointerId === touch.look.id) touch.look = null;
  mouseDrag = null;
  showStick();
}

function showStick() {
  const base = $('stickBase');
  const knob = $('stickKnob');
  if (!base || !knob) return;
  const on = Boolean(touch.move);
  base.classList.toggle('hidden', !on);
  if (!on) return;
  base.style.left = `${touch.move.x - 50}px`;
  base.style.top = `${touch.move.y - 50}px`;
  knob.style.transform = `translate(${touch.vec.x * 35}px, ${-touch.vec.y * 35}px)`;
}

// ---------------------------------------------------------------------------
// Bucle y API pública
// ---------------------------------------------------------------------------
function resize() {
  if (!renderer) return;
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  applyProjection();
}

// Calidad automática: si el computador no alcanza ~40 cuadros por segundo se baja la
// resolución interna (hasta 60%); si sobra rendimiento se vuelve a subir.
const quality = { max: Math.min(window.devicePixelRatio || 1, 2), ratio: Math.min(window.devicePixelRatio || 1, 2), min: 0.6, time: 0, frames: 0 };

function adaptQuality(rawDt) {
  if (rawDt > 0.5) return; // pestaña en segundo plano: no cuenta
  quality.time += rawDt;
  quality.frames++;
  if (quality.time < 2) return;
  const fps = quality.frames / quality.time;
  quality.time = 0;
  quality.frames = 0;
  let next = quality.ratio;
  if (fps < 40 && quality.ratio > quality.min) next = Math.max(quality.min, quality.ratio * 0.8);
  else if (fps > 57 && quality.ratio < quality.max) next = Math.min(quality.max, quality.ratio * 1.15);
  if (Math.abs(next - quality.ratio) > 0.01) {
    quality.ratio = next;
    renderer.setPixelRatio(next);
    resize();
  }
  quality.fps = Math.round(fps);
}

function frame() {
  if (!running) return;
  rafId = requestAnimationFrame(frame);
  const rawDt = clock.getDelta();
  adaptQuality(rawDt);
  const dt = Math.min(0.1, rawDt);
  update(dt);
  // Limpiar todo el lienzo (las franjas de cine quedan negras) y dibujar la escena
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.clear();
  applyProjection();
  renderer.render(scene, camera);
  if (handpad.visible) {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderer.clearDepth();
    renderer.render(handpad.scene, handpad.camera);
  }
}

function build() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.autoClear = false; // nave y manos se dibujan por separado en el mismo fotograma
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 1);
  const canvas = renderer.domElement;
  canvas.id = 'shipCanvas';
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:5;touch-action:none;display:none';
  document.body.prepend(canvas);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02040a);
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, ORBIT.far);
  clock = new THREE.Clock();

  // Reflejos realistas en metales y en la visera: mapa de entorno de un "cuarto" neutro
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  // Bruma muy leve del aire de la cabina (da profundidad a los pasillos)
  scene.fog = new THREE.FogExp2(0x0a0e16, 0.018);

  buildMaterials();
  bridge = buildBridge({ scene, materials: { wall: MAT.wall, floor: MAT.floor, ceiling: MAT.ceiling } });
  wallMeshes.push(...bridge.walls);
  buildFloorsAndCeilings();
  buildWalls();
  buildLights();
  const before = scene.children.length;
  buildSpace();
  // El espacio exterior está lejos: sin bruma (si no, el planeta desaparecería)
  scene.children.slice(before).forEach((o) => {
    if (o.material) o.material.fog = false;
  });
  buildHub();
  buildStations();

  // Astronauta con traje estilo EMU de la NASA (ship3d/astronaut.js)
  emu = buildEmuAstronaut();
  astronaut = emu.root;
  scene.add(astronaut);
  // La caminata procedural sigue disponible mientras carga el mocap o si falla la carga.
  loadMocap(new URL('./ship3d/mocap.json', import.meta.url))
    .then((data) => emu.setMocap(createMocapRig(data)))
    .catch((error) => console.warn('No se pudo cargar el mocap; se usa la caminata procedural.', error));

  // Linterna del casco
  headlamp = new THREE.SpotLight(0xfff4dc, 14, 14, 0.42, 0.55, 1.4);
  scene.add(headlamp, headlamp.target);

  // Puertas, tuberías, equipos, letreros (ship3d/props.js) y paneles 3D (ship3d/panels.js)
  props = buildProps({ scene, ROOMS, CORRIDORS, WALL_H, DOOR_H, roomByKey });
  panels = createPanels({ scene, stationRooms: STATION_ROOMS });

  // Sonido (ship3d/sfx.js) e interfaz del casco (ship3d/helmet.js)
  sfx = createSfx({ getListener: () => Ship3D.audioListener(), stationRooms: STATION_ROOMS });
  handpad = createHandPad({ materials: emu.materials, environment: scene.environment, isSoundEnabled: () => sfx.enabled, toggleSound });
  helmet = createHelmetUI({ onToggleSound: toggleSound, isSoundEnabled: () => sfx.enabled, onToggleHandPad: toggleHandPad });
  helmet.renderSound();

  window.addEventListener('resize', resize);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearInput);
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  const prompt = $('interactPrompt');
  if (prompt) prompt.addEventListener('click', useStation);
  built = true;
}

function resetPlayer() {
  clearInput();
  if (handpad) handpad.setOpen(false);
  player.x = 0;
  player.y = 0;
  player.z = 2.5;
  player.vy = 0;
  player.grounded = true;
  player.yaw = 0;
  player.pitch = -0.12;
  player.bodyYaw = Math.PI;
  camState.dist = CAMERA_MODES[cameraMode].dist || 3.4;
}

const Ship3D = {
  available: true,
  start() {
    if (!built) build();
    resize();
    renderer.domElement.style.display = 'block';
    sfx.setActive(true);
    helmet.setVisible(true);
    if (running) return;
    running = true;
    clock.getDelta();
    frame();
  },
  stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    clearInput();
    syncHandPad();
    if (document.pointerLockElement) document.exitPointerLock();
    if (renderer) renderer.domElement.style.display = 'none';
    if (built) {
      releasePart();
      sfx.setActive(false);
      helmet.setVisible(false);
    }
  },
  resetPlayer,
  setInputEnabled(on) {
    inputEnabled = on;
    clearInput();
    syncHandPad();
    if (!on) releasePart();
    if (!on && document.pointerLockElement) document.exitPointerLock();
  },
  toggleCamera,
  setCameraMode,
  swapCinematicSide,
  get cameraMode() {
    return cameraMode;
  },
  get running() {
    return running;
  },
  // --- Audio espacial (voice.js) ---
  // Oyente = la cámara (lo que ves es lo que oyes); la sala se decide por la posición del astronauta
  audioListener() {
    if (!camera) return null;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const p = camera.position;
    return { x: p.x, y: p.y, z: p.z, fx: f.x, fy: f.y, fz: f.z, ux: u.x, uy: u.y, uz: u.z, area: areaAt(player.x, player.z) };
  },
  // De dónde sale la voz: la consola de un módulo, o el altavoz del techo de la sala donde está el astronauta
  audioSource(key) {
    const room = roomByKey[key];
    if (room && room.station) return { x: room.station.x, y: 1.45, z: room.station.z, area: areaAt(room.station.x, room.station.z) };
    const area = areaAt(player.x, player.z);
    return { x: (area.x0 + area.x1) / 2, y: WALL_H - 0.25, z: (area.z0 + area.z1) / 2, area };
  },
  // Para pruebas automáticas
  _debug: {
    player,
    quality,
    stations: STATION_ROOMS,
    get near() { return nearStation && nearStation.key; },
    get hover() { return hoverPart && { station: hoverPart.station, kind: hoverPart.kind, label: hoverPart.label }; },
    // Apunta la cámara (1ª persona) a una parte del panel: { station, kind, index?, color? }
    aimAt(match) {
      const mesh = panels.parts.find((m) => Object.entries(match).every(([k, v]) => m.userData.part[k] === v));
      if (!mesh) return false;
      const p = new THREE.Vector3();
      mesh.getWorldPosition(p);
      const dx = p.x - player.x;
      const dz = p.z - player.z;
      player.yaw = Math.atan2(-dx, -dz);
      player.pitch = Math.atan2(p.y - player.y - 1.68, Math.hypot(dx, dz));
      return true;
    },
    press() { if (hoverPart) pressPart(hoverPart); return Boolean(hoverPart); },
    release: releasePart
  }
};

function setCameraMode(mode) {
  if (!CAMERA_MODES[mode]) return;
  cameraMode = mode;
  if (mode !== 'first') player.pitch = Math.max(-0.6, Math.min(0.5, player.pitch));
  syncHandPad();
  setText('cameraModeLabel', CAMERA_MODES[mode].label);
}

function toggleCamera() {
  const i = CAMERA_ORDER.indexOf(cameraMode);
  setCameraMode(CAMERA_ORDER[(i + 1) % CAMERA_ORDER.length]);
}

// Cinemática: personaje a la izquierda (side 1) o a la derecha (side -1) del encuadre
function swapCinematicSide() {
  camState.side = -camState.side;
}

// Verificar WebGL antes de anunciar el modo 3D
try {
  const test = document.createElement('canvas');
  if (!(test.getContext('webgl2') || test.getContext('webgl'))) throw new Error('sin WebGL');
  window.Ship3D = Ship3D;
} catch (e) {
  window.Ship3D = { available: false, reason: 'Este navegador no soporta gráficos 3D (WebGL).' };
}
window.dispatchEvent(new Event('ship3d-ready'));
