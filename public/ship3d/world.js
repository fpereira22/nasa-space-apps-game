/** Elementos del mundo compartidos por la partida y las cinemáticas. */
import * as THREE from 'three';
import { createPlanet } from '../cinema/planet.js';
import { canvasTex } from './textures.js';

export const BRIDGE = Object.freeze({ halfWidth: 6, front: -6, back: 6, height: 3.2, doorHalfWidth: 1.5, doorHeight: 2.6, reactorDoor: 12 });
export const ORBIT = Object.freeze({ radius: 1000, position: [-200, -900, -1500], sun: [0.9, 0.4, 0.12], far: 9000 });

// La semilla mantiene las mismas constelaciones al cambiar de escena.
export function createStarfield({ count = 9000, radius = 4000 } = {}) {
  let seed = 741;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const u = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    positions.set([Math.cos(angle) * s * radius, u * radius, Math.sin(angle) * s * radius], i * 3);
    const temperature = random();
    color.setHSL(temperature < 0.7 ? 0.6 : 0.08, temperature < 0.7 ? 0.25 : 0.55, 0.85);
    const brightness = 0.35 + Math.pow(random(), 6) * 2.5;
    colors.set([color.r * brightness, color.g * brightness, color.b * brightness], i * 3);
    sizes[i] = 1 + Math.pow(random(), 5) * 3.5;
    phases[i] = random() * 100;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const uniforms = { uTime: { value: 0 }, uPR: { value: Math.min(globalThis.devicePixelRatio || 1, 2) } };
  const pts = new THREE.Points(geometry, new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `attribute float aSize; attribute vec3 aColor; attribute float aPhase; uniform float uTime; uniform float uPR;
      varying vec3 vColor; varying float vTw;
      void main(){ vColor = aColor; vTw = 0.8 + 0.2*sin(uTime*1.7 + aPhase);
        gl_PointSize = aSize*uPR; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vColor; varying float vTw;
      void main(){ float a = smoothstep(0.5, 0.0, length(gl_PointCoord-0.5)); gl_FragColor = vec4(vColor*a*vTw, 1.0); }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
  }));
  pts.frustumCulled = false;
  return { pts, uniforms };
}

export function createOrbitalBackdrop(scene, { planet = createPlanet({ radius: ORBIT.radius, sunDir: new THREE.Vector3(...ORBIT.sun) }) } = {}) {
  planet.group.position.set(...ORBIT.position);
  scene.add(planet.group);
  const stars = createStarfield();
  scene.add(stars.pts);
  return { planet, update(dt, time) { planet.update(dt); stars.uniforms.uTime.value = time; } };
}

function surface(w, h, material) {
  const geometry = new THREE.PlaneGeometry(w, h);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  return new THREE.Mesh(geometry, material);
}

export function buildBridge({ scene, materials }) {
  const walls = [];
  const root = new THREE.Group();
  root.name = 'aether-shared-bridge';
  scene.add(root);
  const { halfWidth: W, front, back, height: H, doorHalfWidth: D, doorHeight: DH } = BRIDGE;
  const trim = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.8, roughness: 0.35 });
  const box = (w, h, d, x, y, z, mat = trim) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  };
  const floor = surface(2 * W, back - front, materials.floor);
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);
  const ceiling = surface(2 * W, back - front, materials.ceiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  root.add(ceiling);
  const wall = (a, b, y0, y1, edge) => {
    const mesh = surface(b - a, y1 - y0, materials.wall);
    if (edge === 'front' || edge === 'back') {
      mesh.position.set((a + b) / 2, (y0 + y1) / 2, edge === 'front' ? front : back);
      if (edge === 'back') mesh.rotation.y = Math.PI;
    } else {
      mesh.position.set(edge === 'left' ? -W : W, (y0 + y1) / 2, (a + b) / 2);
      mesh.rotation.y = edge === 'left' ? Math.PI / 2 : -Math.PI / 2;
    }
    root.add(mesh);
    walls.push(mesh);
  };
  // Cuatro salidas reales; las ventanas dejan libre el acceso frontal a energía.
  for (const edge of ['back', 'left', 'right']) {
    wall(-W, -D, 0, H, edge);
    wall(D, W, 0, H, edge);
    wall(-D, D, DH, H, edge);
  }
  wall(-D, D, DH, H, 'front');
  const glass = new THREE.MeshStandardMaterial({ color: 0xabc9e7, transparent: true, opacity: 0.055, roughness: 0.08, metalness: 0.15, depthWrite: false, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const a = side < 0 ? -5.3 : 1.85;
    const b = side < 0 ? -1.85 : 5.3;
    wall(side < 0 ? -W : 5.3, side < 0 ? -5.3 : W, 0, H, 'front');
    wall(side < 0 ? -1.85 : D, side < 0 ? -D : 1.85, 0, H, 'front');
    wall(a, b, 0, 0.9, 'front');
    wall(a, b, 2.7, H, 'front');
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(b - a, 1.8), glass);
    pane.position.set((a + b) / 2, 1.8, front);
    root.add(pane);
    for (const y of [0.9, 2.7]) box(b - a + 0.16, 0.12, 0.25, (a + b) / 2, y, front);
    for (const x of [a, (a + b) / 2, b]) box(0.1, 1.8, 0.25, x, 1.8, front);
  }
  const stripMat = new THREE.MeshStandardMaterial({ color: 0x364b63, emissive: 0xbfe6ff, emissiveIntensity: 1.4 });
  for (const x of [-3.5, 3.5]) box(0.06, 0.025, 9.5, x, H - 0.035, 0, stripMat);
  // Costillas y zócalos de la misma cabina, visibles desde cualquier cámara.
  for (const z of [-4.5, 4.5]) {
    box(2 * W, 0.14, 0.16, 0, H - 0.1, z);
    for (const side of [-1, 1]) box(0.14, H, 0.16, side * (W - 0.1), H / 2, z);
  }
  for (const side of [-1, 1]) for (const z of [-3.75, 3.75]) box(0.1, 0.18, 4.5, side * (W - 0.08), 0.15, z);

  const deskMat = new THREE.MeshStandardMaterial({ color: 0x272c34, metalness: 0.6, roughness: 0.5 });
  const consoleRoot = new THREE.Group();
  consoleRoot.position.z = -3.4;
  root.add(consoleRoot);
  const desk = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 0.8), deskMat);
  desk.position.y = 0.45;
  consoleRoot.add(desk);
  const top = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 0.9), deskMat);
  top.position.set(0, 0.95, 0.05);
  top.rotation.x = 0.35;
  consoleRoot.add(top);
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 512;
  screenCanvas.height = 256;
  const screenTex = new THREE.CanvasTexture(screenCanvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTex });
  let lastScreen = '';
  function drawScreen(t, critical, repaired) {
    const blink = Math.floor(t * 3) % 2 === 0;
    const key = `${critical}:${repaired}:${blink}`;
    if (key === lastScreen) return;
    lastScreen = key;
    const g = screenCanvas.getContext('2d');
    g.fillStyle = critical ? '#120202' : '#04111d';
    g.fillRect(0, 0, 512, 256);
    g.strokeStyle = critical ? 'rgba(255,60,40,0.18)' : 'rgba(100,190,240,0.18)';
    for (let y = 0; y < 256; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
    g.textAlign = 'center';
    g.fillStyle = critical ? (blink ? '#ff5040' : '#b94738') : '#9bd8f2';
    g.font = 'bold 40px Orbitron, monospace';
    g.fillText(critical ? '⚠ FALLA CRÍTICA' : 'U.S.S. AETHER', 256, 64);
    g.font = '25px "Share Tech Mono", monospace';
    g.fillText('PROTOCOLO DE REPARACIÓN', 256, 119);
    g.font = 'bold 48px Orbitron, monospace';
    g.fillText(`${repaired} / 4 SISTEMAS`, 256, 184);
    g.font = '21px "Share Tech Mono", monospace';
    g.fillText('ENLACE CON TIERRA · CUBIERTA B', 256, 231);
    screenTex.needsUpdate = true;
  }
  drawScreen(0, true, 0);
  for (const side of [-1, 0, 1]) {
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(side ? 0.7 : 1.3, side ? 0.45 : 0.65), screenMat);
    screen.position.set(side * 1.1, side ? 1.32 : 1.42, side ? -0.08 : -0.15);
    screen.rotation.set(-0.12, -side * 0.35, 0);
    consoleRoot.add(screen);
  }
  for (let i = 0; i < 24; i++) {
    const button = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.05), new THREE.MeshBasicMaterial({ color: [0xff3020, 0xffb020, 0x30ff70, 0x30a0ff][i % 4] }));
    button.position.set(-1.2 + (i % 12) * 0.22, 1 + Math.floor(i / 12) * 0.06, 0.25 - Math.floor(i / 12) * 0.15);
    button.rotation.x = 0.35;
    consoleRoot.add(button);
  }
  const nameplate = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.22), new THREE.MeshBasicMaterial({ map: canvasTex(768, 64, (g, w, h) => {
    g.fillStyle = '#151c26'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c4d6e7'; g.font = '26px monospace'; g.textAlign = 'center'; g.fillText('U.S.S. AETHER / PUENTE DE MANDO', w / 2, 42);
  }, { repeat: false }) }));
  nameplate.position.set(0, 0.6, 0.405);
  consoleRoot.add(nameplate);
  const screenLight = new THREE.PointLight(0xff3020, 1.2, 5, 1.5);
  screenLight.position.set(0, 1.55, -3.1);
  root.add(screenLight);
  root.add(new THREE.AmbientLight(0x1a2233, 0.6));
  const fill = new THREE.PointLight(0x9fb6ff, 7, 14, 1.5);
  fill.position.set(-1.5, 2.6, 0);
  root.add(fill);
  const moonlight = new THREE.DirectionalLight(0x9fc4ff, 0.9);
  moonlight.position.set(-3, 3, -10);
  root.add(moonlight);
  const beacons = [-2.6, 2.6].map((x, i) => {
    box(0.24, 0.16, 0.24, x, H - 0.09, 1, new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1a0a, emissiveIntensity: 1.5 }));
    const spot = new THREE.SpotLight(0xff1a0a, 45, 14, 0.5, 0.6, 1.5);
    spot.position.set(x, H - 0.15, 1);
    const target = new THREE.Object3D();
    spot.target = target;
    root.add(spot, target);
    return { spot, target, phase: i * Math.PI, x };
  });
  return {
    walls,
    obstacles: [{ x: 0, z: -3.4, halfX: 1.65, halfZ: 0.6 }],
    fx: { beacons, screenLight },
    update(dt, t, { critical = true, repaired = 0 } = {}) {
      drawScreen(t, critical, repaired);
      beacons.forEach((b) => {
        const angle = t * 4 + b.phase;
        b.target.position.set(b.x + Math.cos(angle) * 3, 0, 1 + Math.sin(angle) * 3);
        b.spot.intensity = critical ? 45 : 0;
      });
      screenLight.color.setHex(critical ? 0xff3020 : 0x79c8ff);
      screenLight.intensity = critical ? 0.9 + Math.sin(t * 6 * Math.PI) * 0.4 : 0.8;
    }
  };
}
