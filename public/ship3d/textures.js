/**
 * Texturas del modo 3D.
 *
 *  - Fotográficas (Poly Haven, CC0, en public/textures/): paneles de pared y piso diamantado,
 *    cada una con color + relieve (normal) + rugosidad.
 *  - Generadas por código: tela del traje, cinta de peligro, rejillas de ventilación, paneles del
 *    techo, letreros y un generador de "normal maps" a partir de un dibujo en escala de grises.
 *
 * Las fotográficas cargan en segundo plano: mientras tanto se usa una versión generada por código.
 */
import * as THREE from 'three';

const TEX_DIR = '/textures/';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
export function canvasTex(w, h, draw, { srgb = true, repeat = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Ruido de valor suave (para tela, suciedad, etc.)
function makeNoise(w, h, scale, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const gw = Math.ceil(w / scale) + 2;
  const gh = Math.ceil(h / scale) + 2;
  const grid = Array.from({ length: gw * gh }, rnd);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = x / scale;
      const gy = y / scale;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const a = grid[y0 * gw + x0];
      const b = grid[y0 * gw + x0 + 1];
      const c = grid[(y0 + 1) * gw + x0];
      const d = grid[(y0 + 1) * gw + x0 + 1];
      out[y * w + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

// Convierte un mapa de alturas (canvas en grises) en un normal map
export function normalFromHeight(heightCanvas, strength = 2) {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// Texturas fotográficas (con reemplazo procedural mientras cargan)
// ---------------------------------------------------------------------------
const loader = new THREE.TextureLoader();

function loadMap(file, { srgb = false } = {}) {
  return loader.loadAsync(TEX_DIR + file).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

// La textura de pared original es azul: se pasa a gris claro conservando rayones y uniones
function recolorToLightGray(texture) {
  const img = texture.image;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    const v = Math.min(255, 118 + lum * 1.55);
    d[i] = v * 0.97;
    d[i + 1] = v * 0.99;
    d[i + 2] = v;
  }
  g.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/**
 * Crea los materiales de la nave. Devuelve materiales listos para usar; las texturas
 * fotográficas se aplican solas cuando terminan de cargar.
 * Las UV de paredes y pisos se calculan en metros (ver worldUV en props.js), así que
 * "repeat" indica cuántos metros abarca una copia de la textura.
 */
export function createShipMaterials() {
  // Provisionales generadas por código
  const wallFallback = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#b9c0c8';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#8d959f';
    g.lineWidth = 3;
    g.strokeRect(1, 1, w - 2, h - 2);
  });
  const floorFallback = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#2a2d31';
    g.fillRect(0, 0, w, h);
  });

  const wall = new THREE.MeshStandardMaterial({
    map: wallFallback,
    color: 0xffffff,
    roughness: 0.6,
    metalness: 0.35,
    envMapIntensity: 0.6
  });
  const floor = new THREE.MeshStandardMaterial({
    map: floorFallback,
    color: 0x9aa3ad,
    roughness: 0.55,
    metalness: 0.75,
    envMapIntensity: 0.7
  });

  const WALL_TILE = 1 / 2.4; // una copia cada 2,4 m
  const FLOOR_TILE = 1 / 1.2;

  Promise.all([
    loadMap('blue_metal_plate_diff_1k.jpg'),
    loadMap('blue_metal_plate_nor_gl_1k.jpg'),
    loadMap('blue_metal_plate_rough_1k.jpg')
  ])
    .then(([diff, nor, rough]) => {
      wall.map = recolorToLightGray(diff);
      wall.normalMap = nor;
      wall.normalScale.set(1.2, 1.2);
      wall.roughnessMap = rough;
      wall.roughness = 1;
      [wall.map, nor, rough].forEach((t) => t.repeat.set(WALL_TILE, WALL_TILE));
      wall.needsUpdate = true;
    })
    .catch((e) => console.warn('[3D] texturas de pared no disponibles, se usa la versión simple', e));

  Promise.all([
    loadMap('metal_plate_diff_1k.jpg', { srgb: true }),
    loadMap('metal_plate_nor_gl_1k.jpg'),
    loadMap('metal_plate_rough_1k.jpg')
  ])
    .then(([diff, nor, rough]) => {
      floor.map = diff;
      floor.normalMap = nor;
      floor.roughnessMap = rough;
      floor.roughness = 1;
      [diff, nor, rough].forEach((t) => t.repeat.set(FLOOR_TILE, FLOOR_TILE));
      floor.needsUpdate = true;
    })
    .catch((e) => console.warn('[3D] texturas de piso no disponibles, se usa la versión simple', e));

  // Techo: paneles modulares con uniones (procedural)
  const ceilHeight = document.createElement('canvas');
  ceilHeight.width = ceilHeight.height = 256;
  {
    const g = ceilHeight.getContext('2d');
    g.fillStyle = '#808080';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#303030';
    g.fillRect(0, 0, 256, 4);
    g.fillRect(0, 0, 4, 256);
    g.fillStyle = '#9a9a9a';
    g.fillRect(16, 16, 224, 224);
    g.fillStyle = '#5a5a5a';
    for (const [x, y] of [[10, 10], [246, 10], [10, 246], [246, 246]]) {
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  const ceilColor = canvasTex(256, 256, (g) => {
    g.fillStyle = '#4b525c';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#2b3037';
    g.fillRect(0, 0, 256, 4);
    g.fillRect(0, 0, 4, 256);
    g.fillStyle = '#555d68';
    g.fillRect(16, 16, 224, 224);
  });
  const ceiling = new THREE.MeshStandardMaterial({
    map: ceilColor,
    normalMap: normalFromHeight(ceilHeight, 3),
    roughness: 0.7,
    metalness: 0.4,
    envMapIntensity: 0.4
  });
  [ceiling.map, ceiling.normalMap].forEach((t) => t.repeat.set(1 / 1.5, 1 / 1.5));

  return { wall, floor, ceiling };
}

// ---------------------------------------------------------------------------
// Texturas generadas por código para objetos
// ---------------------------------------------------------------------------

// Tela del traje (capa térmica TMG): blanco hueso con tejido fino y costuras acolchadas
export function suitFabric() {
  const S = 256;
  const n = makeNoise(S, S, 3, 7);
  const n2 = makeNoise(S, S, 24, 11);
  const height = document.createElement('canvas');
  height.width = height.height = S;
  const hg = height.getContext('2d');
  const himg = hg.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const weave = (Math.sin(x * 1.6) * Math.sin(y * 1.6) + 1) * 0.12;
      const quilt = (y % 64 < 2 || x % 128 < 2) ? -0.35 : 0;
      const v = Math.max(0, Math.min(1, 0.5 + weave + n[y * S + x] * 0.15 + quilt));
      const i = (y * S + x) * 4;
      himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = v * 255;
      himg.data[i + 3] = 255;
    }
  }
  hg.putImageData(himg, 0, 0);

  const color = canvasTex(S, S, (g) => {
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const v = 232 + n[y * S + x] * 10 - n2[y * S + x] * 14 - ((y % 64 < 2 || x % 128 < 2) ? 22 : 0);
        const i = (y * S + x) * 4;
        img.data[i] = v;
        img.data[i + 1] = v * 0.995;
        img.data[i + 2] = v * 0.975;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
  return { map: color, normalMap: normalFromHeight(height, 2.5) };
}

// Cinta de peligro amarilla y negra
export function hazardStripes() {
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#e5b20d';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#16161a';
    for (let x = -h; x < w + h; x += 48) {
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + 24, h);
      g.lineTo(x + 24 + h, 0);
      g.lineTo(x + h, 0);
      g.fill();
    }
    g.fillStyle = 'rgba(0,0,0,0.15)';
    for (let i = 0; i < 400; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 1);
  });
}

// Rejilla de ventilación
export function ventGrille() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#2f343b';
    g.fillRect(0, 0, w, h);
    for (let y = 10; y < h - 6; y += 10) {
      g.fillStyle = '#0b0d10';
      g.fillRect(8, y, w - 16, 5);
      g.fillStyle = '#4a515b';
      g.fillRect(8, y + 5, w - 16, 1);
    }
    g.strokeStyle = '#59616c';
    g.lineWidth = 4;
    g.strokeRect(2, 2, w - 4, h - 4);
  }, { repeat: false });
}

// Letrero/etiqueta de texto (tipo placa técnica)
export function labelTex(lines, { w = 512, h = 128, bg = '#e9ecef', fg = '#111827', border = '#111827', font = 'Share Tech Mono, monospace' } = {}) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    if (border) {
      g.strokeStyle = border;
      g.lineWidth = 6;
      g.strokeRect(4, 4, w - 8, h - 8);
    }
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((line, i) => {
      const size = line.size || Math.floor(h / (lines.length + 1.2));
      g.font = `${line.weight || 700} ${size}px ${line.font || font}`;
      g.fillStyle = line.color || fg;
      g.fillText(line.text, w / 2, (h * (i + 1)) / (lines.length + 1));
    });
  }, { repeat: false });
}
