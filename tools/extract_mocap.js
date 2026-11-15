/**
 * Extrae animaciones de captura de movimiento (mocap) de un .glb con esqueleto Mixamo
 * y las guarda como JSON liviano para el astronauta del modo 3D (public/ship3d/mocap.json).
 *
 * Fuente usada: Xbot.glb de los ejemplos de three.js (animaciones de Mixamo, captura de
 * movimiento real de actores): https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf
 *
 *   curl -L -o Xbot.glb https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/Xbot.glb
 *   node tools/extract_mocap.js Xbot.glb public/ship3d/mocap.json
 *
 * Solo se guardan los huesos que usa el traje (sin malla ni dedos): ~100 KB en vez de 2,9 MB.
 */
const fs = require('fs');

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Uso: node tools/extract_mocap.js <entrada.glb> <salida.json>');
  process.exit(1);
}

const BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandMiddle1',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'RightHandMiddle1',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'LeftToe_End',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'RightToe_End'
];
const CLIPS = ['idle', 'walk', 'run'];

const buf = fs.readFileSync(input);
if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('No es un .glb');
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;

const COMPONENTS = { SCALAR: 1, VEC3: 3, VEC4: 4 };
function readAccessor(i) {
  const acc = gltf.accessors[i];
  if (acc.componentType !== 5126) throw new Error('Solo float32');
  const view = gltf.bufferViews[acc.bufferView];
  const n = acc.count * COMPONENTS[acc.type];
  const start = binStart + (view.byteOffset || 0) + (acc.byteOffset || 0);
  const out = new Array(n);
  for (let k = 0; k < n; k++) out[k] = buf.readFloatLE(start + k * 4);
  return out;
}

const round = (v) => Math.round(v * 1e5) / 1e5;
const short = (name) => name.replace(/^mixamorig:?/, '');

// Jerarquía: padre de cada nodo
const parent = {};
gltf.nodes.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)));

// Nodos que se guardan: los huesos pedidos y todos sus antepasados (para tener la pose de reposo completa)
const wanted = new Set();
gltf.nodes.forEach((n, i) => {
  if (!BONES.includes(short(n.name))) return;
  for (let k = i; k !== undefined; k = parent[k]) wanted.add(k);
});
const order = [...wanted].sort((a, b) => depth(a) - depth(b));
function depth(i) {
  let d = 0;
  for (let k = parent[i]; k !== undefined; k = parent[k]) d++;
  return d;
}

const nodes = order.map((i) => {
  const n = gltf.nodes[i];
  return {
    name: short(n.name),
    parent: parent[i] !== undefined ? short(gltf.nodes[parent[i]].name) : null,
    t: (n.translation || [0, 0, 0]).map(round),
    r: (n.rotation || [0, 0, 0, 1]).map(round),
    s: (n.scale || [1, 1, 1]).map(round)
  };
});

const clips = {};
gltf.animations.filter((a) => CLIPS.includes(a.name)).forEach((a) => {
  const tracks = [];
  let duration = 0;
  a.channels.forEach((ch) => {
    const node = ch.target.node;
    if (!wanted.has(node)) return;
    const name = short(gltf.nodes[node].name);
    const path = ch.target.path;
    // Rotaciones de todos los huesos; traslación solo de la cadera (rebote vertical)
    if (path === 'scale' || (path === 'translation' && name !== 'Hips')) return;
    const s = a.samplers[ch.sampler];
    const times = readAccessor(s.input).map(round);
    const values = readAccessor(s.output).map(round);
    duration = Math.max(duration, times[times.length - 1]);
    tracks.push({ bone: name, path, times, values });
  });
  clips[a.name] = { duration: round(duration), tracks };
});

const data = {
  source: 'three.js examples/models/gltf/Xbot.glb (animaciones de Mixamo)',
  nodes,
  clips
};
fs.writeFileSync(output, JSON.stringify(data));
console.log(`OK ${output}: ${nodes.length} nodos, clips: ${Object.entries(clips).map(([k, c]) => `${k} ${c.duration}s/${c.tracks.length} pistas`).join(', ')}`);
console.log(`Tamaño: ${(fs.statSync(output).size / 1024).toFixed(1)} KB`);
