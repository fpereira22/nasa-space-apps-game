/**
 * Interior de la cinemática: puente de mando con ventanal al planeta, consola de alerta,
 * balizas rojas giratorias y un pasillo que termina en la compuerta del reactor.
 * El astronauta (mismo traje EMU del modo 3D) lleva la visera dorada levantada para que
 * se le vea la cara, con cejas, párpados, boca y lágrima animables (expresión de tristeza).
 */
import * as THREE from 'three';
import { buildAstronaut } from '../ship3d/astronaut.js';
import { createShipMaterials, canvasTex } from '../ship3d/textures.js';
import { BRIDGE, buildBridge, createOrbitalBackdrop } from '../ship3d/world.js';

// Plano con UV en metros (las texturas de la nave se repiten por metro)
function plane(w, h, mat) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  return new THREE.Mesh(g, mat);
}

function buildFace(head) {
  const face = new THREE.Group();
  face.position.set(0, -0.015, 0.0);
  head.add(face);
  const skin = new THREE.MeshStandardMaterial({ color: 0xc8906f, roughness: 0.55, metalness: 0 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a1d17, roughness: 0.8 });
  const capWhite = new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.85 });
  const capBrown = new THREE.MeshStandardMaterial({ color: 0x5a3b26, roughness: 0.8 });

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 32, 24), skin);
  skull.scale.set(0.88, 1.12, 0.98);
  face.add(skull);
  // Gorro de comunicaciones ("Snoopy cap") con auriculares
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.106, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), capBrown);
  cap.scale.set(0.9, 1.14, 1.0);
  cap.rotation.x = -0.45;
  face.add(cap);
  const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.108, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.28), capWhite);
  capTop.scale.set(0.9, 1.14, 1.0);
  capTop.rotation.x = -0.45;
  face.add(capTop);
  [-1, 1].forEach((s) => {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 20), dark);
    ear.rotation.z = Math.PI / 2;
    ear.position.set(s * 0.09, -0.005, -0.005);
    face.add(ear);
  });
  // Micrófono
  const micCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.09, -0.02, 0.01),
    new THREE.Vector3(0.07, -0.07, 0.06),
    new THREE.Vector3(0.025, -0.075, 0.095)
  ]);
  face.add(new THREE.Mesh(new THREE.TubeGeometry(micCurve, 12, 0.003, 6), dark));

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 10), skin);
  nose.scale.set(0.8, 1, 1);
  nose.position.set(0, -0.012, 0.1);
  face.add(nose);

  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xf2eee8, roughness: 0.25 });
  const irisMat = new THREE.MeshStandardMaterial({ color: 0x3b2516, roughness: 0.15 });
  const eyes = [];
  [-1, 1].forEach((s) => {
    const eye = new THREE.Group();
    eye.position.set(s * 0.031, 0.018, 0.082);
    face.add(eye);
    eye.add(new THREE.Mesh(new THREE.SphereGeometry(0.0135, 16, 12), eyeWhite));
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0072, 12, 10), irisMat);
    iris.position.z = 0.009;
    eye.add(iris);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.0148, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), skin);
    eye.add(lid);
    const lower = new THREE.Mesh(new THREE.SphereGeometry(0.0146, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), skin);
    lower.rotation.x = 0.9;
    eye.add(lower);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.008), dark);
    brow.position.set(s * 0.031, 0.043, 0.088);
    face.add(brow);
    eyes.push({ s, eye, iris, lid, brow });
  });

  const lipMat = new THREE.MeshStandardMaterial({ color: 0x8a4a3f, roughness: 0.5 });
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.0032, 6, 24, Math.PI), lipMat);
  mouth.position.set(0, -0.058, 0.088);
  face.add(mouth);

  const tearMat = new THREE.MeshStandardMaterial({ color: 0xcfe8ff, roughness: 0.02, metalness: 0.2, emissive: 0x335577, emissiveIntensity: 0.6, transparent: true, opacity: 0.9 });
  const tear = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 10, 8), tearMat);
  tear.scale.set(1, 1.4, 1);
  tear.visible = false;
  face.add(tear);

  const state = { sad: 0, lookDown: 0, closed: 0, blink: 0, tear: -1, quiver: 0 };
  function update(t) {
    const sad = state.sad;
    const closed = Math.max(state.closed, state.blink);
    eyes.forEach(({ s, iris, lid, brow }) => {
      // Párpado: -0.55 abierto, +1.55 cerrado; la tristeza los baja un poco
      lid.rotation.x = THREE.MathUtils.lerp(-0.55 + sad * 0.5 + state.lookDown * 0.3, 1.55, closed);
      iris.position.y = -0.004 * state.lookDown - 0.001 * sad;
      // Cejas: extremo interior hacia arriba (gesto de pena)
      brow.rotation.z = -s * (0.05 + sad * 0.42);
      brow.position.y = 0.043 + sad * 0.004;
    });
    // Boca: arco hacia abajo; tiembla un poco al contener el llanto
    const q = state.quiver * Math.sin(t * 38) * 0.08;
    mouth.scale.set(1 - sad * 0.15, 0.12 + sad * 0.55 + q, 1);
    mouth.position.y = -0.058 - sad * 0.004;
    // Lágrima que baja por la mejilla derecha
    if (state.tear >= 0) {
      tear.visible = true;
      const k = Math.min(1, state.tear);
      tear.position.set(0.04 + k * 0.006, 0.006 - k * 0.07, 0.086 - k * 0.006);
      tearMat.opacity = 0.9 * (1 - Math.max(0, k - 0.85) / 0.15);
    } else tear.visible = false;
  }
  return { face, state, update };
}

export function buildInterior({ planet } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const mats = createShipMaterials();
  const bridge = buildBridge({ scene, materials: mats });
  const { height: H, back: zBack, doorHalfWidth: dw, doorHeight: dh } = BRIDGE;
  const { screenLight } = bridge.fx;
  createOrbitalBackdrop(scene, { planet });

  // ------------------------------------------------------------------ pasillo al reactor
  const cLen = BRIDGE.reactorDoor - zBack;
  const cz0 = zBack;
  const cz1 = zBack + cLen;
  const cf = plane(2 * dw, cLen, mats.floor);
  cf.rotation.x = -Math.PI / 2;
  cf.position.set(0, 0, (cz0 + cz1) / 2);
  scene.add(cf);
  const cc = plane(2 * dw, cLen, mats.ceiling);
  cc.rotation.x = Math.PI / 2;
  cc.position.set(0, dh, (cz0 + cz1) / 2);
  scene.add(cc);
  [-1, 1].forEach((s) => {
    const w = plane(cLen, dh, mats.wall);
    w.rotation.y = -s * Math.PI / 2;
    w.position.set(s * dw, dh / 2, (cz0 + cz1) / 2);
    scene.add(w);
  });
  // Tiras de luz del pasillo (parpadean)
  const stripMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xbfe6ff, emissiveIntensity: 2 });
  for (let z = cz0 + 1; z < cz1; z += 2.5) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 0.3), stripMat);
    s.position.set(0, dh - 0.03, z);
    scene.add(s);
  }
  // Compuerta del reactor
  const doorGlow = { value: 0 };
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.8, roughness: 0.45, emissive: 0xff7a30, emissiveIntensity: 0 });
  const door = new THREE.Group();
  door.position.set(0, 0, cz1 - 0.05);
  scene.add(door);
  [-1, 1].forEach((s) => {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(dw - 0.03, dh, 0.15), doorMat);
    leaf.position.set(s * (dw / 2 + 0.015), dh / 2, 0);
    door.add(leaf);
  });
  const seamMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const seam = new THREE.Mesh(new THREE.PlaneGeometry(0.03, dh), seamMat);
  seam.rotation.y = Math.PI;
  seam.position.set(0, dh / 2, -0.08);
  door.add(seam);
  const hazard = canvasTex(256, 64, (g, w, h) => {
    for (let i = -2; i < 12; i++) {
      g.fillStyle = i % 2 ? '#111' : '#eab308';
      g.beginPath();
      g.moveTo(i * 32, 0);
      g.lineTo(i * 32 + 32, 0);
      g.lineTo(i * 32, h);
      g.lineTo(i * 32 - 32, h);
      g.fill();
    }
  });
  const hz = new THREE.Mesh(new THREE.PlaneGeometry(2 * dw, 0.25), new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.7 }));
  hz.rotation.y = Math.PI;
  hz.position.set(0, dh + -0.15, -0.1);
  door.add(hz);
  const doorLight = new THREE.PointLight(0xff8a40, 0, 30, 1.5);
  doorLight.position.set(0, 1.3, cz1 - 1);
  scene.add(doorLight);

  // ------------------------------------------------------------------ astronauta con cara
  const astro = buildAstronaut();
  astro.root.position.set(0, 0, -2.25);
  astro.root.rotation.y = Math.PI; // mira hacia la consola (-Z)
  scene.add(astro.root);
  // Levantar la visera dorada para ver la cara
  astro.root.traverse((o) => {
    if (o.isMesh && o.material && o.material.metalness === 1 && o.material.color && o.material.color.getHex() === 0xffc93c) o.visible = false;
  });
  // Sin luces del casco apuntando a cámara y con vidrio simple (la transmisión empaña el primer plano)
  (astro.lamps || []).forEach((l) => (l.visible = false));
  astro.root.traverse((o) => {
    if (o.isMesh && o.material && o.material.isMeshPhysicalMaterial && o.material.transmission > 0) {
      o.material = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0, depthWrite: false });
    }
  });
  const face = buildFace(astro.head);
  const faceLight = new THREE.PointLight(0xffd8c0, 0.05, 1.5, 2);
  faceLight.position.set(0.25, 0.15, 0.6);
  astro.head.add(faceLight);
  // Articulaciones (por posición, si existen en el modelo)
  const body = astro.root.children[0];
  const shoulders = body ? body.children.filter((o) => o.isGroup && Math.abs(Math.abs(o.position.x) - 0.37) < 0.02 && o.position.y > 1.4) : [];
  const joints = shoulders.map((sh) => ({ sh, side: Math.sign(sh.position.x), elbow: sh.children.find((c) => c.isGroup) }));

  const fx = { doorGlow, stripMat, doorLight, ...bridge.fx };

  let alarmT = 0;
  const pose = { slump: 0, handsUp: 0, headDown: 0, breathe: 1 };
  function update(dt, t) {
    alarmT += dt;
    bridge.update(dt, alarmT, { critical: true });
    // Pose del cuerpo
    if (body) {
      body.rotation.x = pose.slump * 0.12 + Math.sin(t * 1.4) * 0.006 * pose.breathe;
      body.position.y = -pose.slump * 0.03;
    }
    joints.forEach(({ sh, side, elbow }) => {
      sh.rotation.x = -0.9 * pose.handsUp - 0.1 * pose.slump;
      sh.rotation.z = side * (0.12 - pose.slump * 0.05);
      if (elbow) elbow.rotation.x = -0.5 - 0.6 * pose.handsUp;
    });
    face.face.rotation.x = pose.headDown * 0.32;
    face.face.position.y = -0.015 - pose.headDown * 0.012;
    face.face.position.z = pose.headDown * 0.01;
    face.update(t);
  }
  function reset() {
    alarmT = 0;
    doorGlow.value = 0;
    Object.assign(pose, { slump: 0, handsUp: 0, headDown: 0, breathe: 1 });
    Object.assign(face.state, { sad: 0, lookDown: 0, closed: 0, blink: 0, tear: -1, quiver: 0 });
    doorMat.emissiveIntensity = 0;
    doorLight.intensity = 0;
    seamMat.color.setRGB(0.2, 0.05, 0.02);
    stripMat.emissiveIntensity = 2;
  }
  function setDoorGlow(v) {
    doorGlow.value = v;
    doorMat.emissiveIntensity = v * 2.5;
    doorLight.intensity = v * 80;
    seamMat.color.setRGB(0.2 + v * 6, 0.05 + v * 4, 0.02 + v * 2.5);
  }
  reset();

  return {
    scene,
    astro,
    face,
    pose,
    fx,
    update,
    reset,
    setDoorGlow,
    points: {
      head: () => astro.head.getWorldPosition(new THREE.Vector3()),
      door: new THREE.Vector3(0, 1.2, cz1 - 0.3),
      corridorDir: new THREE.Vector3(0, 0, -1)
    }
  };
}
