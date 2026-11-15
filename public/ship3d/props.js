/**
 * Objetos del interior de la nave: puertas corredizas automáticas, pasamanos, tuberías,
 * rejillas, bolsas de carga, equipos de emergencia, pantallas animadas, racks y letreros.
 *
 * buildProps(...) devuelve { update(dt, t, player) } que anima puertas, pantallas y luces, y
 * devuelve eventos de puertas ({ type: 'door', open, x, z }) para los efectos de sonido.
 */
import * as THREE from 'three';
import { canvasTex, hazardStripes, ventGrille, labelTex, suitFabric } from './textures.js';

const DOOR_OPEN_DIST = 3.3;

export function buildProps({ scene, ROOMS, CORRIDORS, WALL_H, DOOR_H, roomByKey }) {
  const animated = []; // funciones (dt, t, player) => evento | null
  const M = {
    panel: new THREE.MeshStandardMaterial({ color: 0xd5dae0, roughness: 0.45, metalness: 0.4 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x2a2f37, roughness: 0.45, metalness: 0.8 }),
    rail: new THREE.MeshStandardMaterial({ color: 0x4a6fa5, roughness: 0.3, metalness: 0.85 }),
    pipeGray: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.9 }),
    pipeBlue: new THREE.MeshStandardMaterial({ color: 0x2f5d8a, roughness: 0.4, metalness: 0.6 }),
    pipeYellow: new THREE.MeshStandardMaterial({ color: 0xc89b1a, roughness: 0.45, metalness: 0.5 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazardStripes(), roughness: 0.6 }),
    red: new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.35, metalness: 0.4 }),
    green: new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.35, metalness: 0.4 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.05, metalness: 0.9 }),
    vent: new THREE.MeshStandardMaterial({ map: ventGrille(), roughness: 0.6, metalness: 0.6 })
  };
  const fabric = suitFabric();
  M.bag = new THREE.MeshStandardMaterial({ color: 0xf1f1ec, map: fabric.map, normalMap: fabric.normalMap, roughness: 0.95 });

  const add = (geo, mat, x, y, z, parent = scene) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  // ------------------------------------------------------------------ puertas
  // Cada pasillo tiene una puerta en cada extremo (lado puente y lado sala)
  const doors = [];
  CORRIDORS.forEach((c) => {
    const alongX = c.x1 - c.x0 < c.z1 - c.z0; // pasillo norte-sur: la puerta es una pared a lo largo de X
    const ends = alongX ? [c.z0, c.z1] : [c.x0, c.x1];
    ends.forEach((line) => {
      const center = alongX ? { x: (c.x0 + c.x1) / 2, z: line } : { x: line, z: (c.z0 + c.z1) / 2 };
      const width = alongX ? c.x1 - c.x0 : c.z1 - c.z0;
      const door = new THREE.Group();
      door.position.set(center.x, 0, center.z);
      if (!alongX) door.rotation.y = Math.PI / 2;
      scene.add(door);
      const leaves = [-1, 1].map((side) => {
        const leaf = new THREE.Group();
        door.add(leaf);
        add(new THREE.BoxGeometry(width / 2, DOOR_H, 0.08), M.panel, side * width / 4, DOOR_H / 2, 0, leaf);
        // Cinta de peligro diagonal y ventanilla
        const tape = add(new THREE.BoxGeometry(width / 2, 0.16, 0.085), M.hazard, side * width / 4, 0.55, 0, leaf);
        tape.material = M.hazard.clone();
        tape.material.map = M.hazard.map.clone();
        tape.material.map.repeat.set(2, 1);
        tape.material.map.needsUpdate = true;
        add(new THREE.BoxGeometry(0.28, 0.5, 0.09), M.glass, side * (width / 4 - 0.1), 1.65, 0, leaf);
        add(new THREE.BoxGeometry(0.05, DOOR_H, 0.1), M.darkMetal, side * 0.025, DOOR_H / 2, 0, leaf); // borde de cierre
        return { leaf, side };
      });
      // Franja de peligro en el piso, en el umbral
      const sill = add(new THREE.PlaneGeometry(width, 0.35), M.hazard, 0, 0.012, 0, door);
      sill.rotation.x = -Math.PI / 2;
      sill.material = M.hazard.clone();
      sill.material.map = M.hazard.map.clone();
      sill.material.map.repeat.set(width * 1.5, 1);
      sill.material.map.needsUpdate = true;

      const state = { open: 0, isOpen: false };
      doors.push(state);
      animated.push((dt, t, player) => {
        const near = Math.hypot(player.x - center.x, player.z - center.z) < DOOR_OPEN_DIST;
        let event = null;
        if (near !== state.isOpen) {
          state.isOpen = near;
          event = { type: 'door', open: near, x: center.x, z: center.z };
        }
        state.open += ((near ? 1 : 0) - state.open) * Math.min(1, dt * 6);
        leaves.forEach(({ leaf, side }) => {
          leaf.position.x = side * state.open * (width / 2 - 0.02);
        });
        return event;
      });
    });
  });

  // ------------------------------------------------------------------ pasamanos y tuberías de pasillos
  CORRIDORS.forEach((c) => {
    const alongZ = c.z1 - c.z0 > c.x1 - c.x0;
    const len = alongZ ? c.z1 - c.z0 : c.x1 - c.x0;
    const mid = { x: (c.x0 + c.x1) / 2, z: (c.z0 + c.z1) / 2 };
    const half = (alongZ ? c.x1 - c.x0 : c.z1 - c.z0) / 2;
    [-1, 1].forEach((side) => {
      const off = side * (half - 0.14);
      const px = alongZ ? mid.x + off : mid.x;
      const pz = alongZ ? mid.z : mid.z + off;
      // Pasamanos a 1 m de altura con soportes
      const rail = add(new THREE.CylinderGeometry(0.025, 0.025, len - 0.8, 12), M.rail, px, 1.0, pz);
      rail.rotation[alongZ ? 'x' : 'z'] = Math.PI / 2;
      for (let d = -len / 2 + 0.6; d <= len / 2 - 0.6; d += 1.2) {
        const bx = alongZ ? mid.x + side * (half - 0.07) : mid.x + d;
        const bz = alongZ ? mid.z + d : mid.z + side * (half - 0.07);
        const b = add(new THREE.BoxGeometry(alongZ ? 0.14 : 0.04, 0.04, alongZ ? 0.04 : 0.14), M.rail, bx, 1.0, bz);
        b.userData.bracket = true;
      }
      // Tuberías cerca del techo
      [[2.92, 0.05, M.pipeGray, 0.1], [2.8, 0.035, M.pipeBlue, 0.22], [3.02, 0.03, M.pipeYellow, 0.28]].forEach(([y, r, mat, inset]) => {
        const o = side * (half - inset);
        const p = add(new THREE.CylinderGeometry(r, r, len, 12), mat, alongZ ? mid.x + o : mid.x, y, alongZ ? mid.z : mid.z + o);
        p.rotation[alongZ ? 'x' : 'z'] = Math.PI / 2;
      });
    });
  });

  // ------------------------------------------------------------------ tuberías en salas (dos paredes)
  ROOMS.forEach((r) => {
    // Solo en las paredes laterales de las salas de módulos (no tapan letreros ni puertas)
    if (r.station) {
      const sideAlongZ = Math.abs(Math.sin(r.station.rot)) < 0.5; // consola mira a ±Z -> paredes laterales x0/x1
      const len = sideAlongZ ? r.z1 - r.z0 : r.x1 - r.x0;
      const lines = sideAlongZ ? [r.x0 + 0.2, r.x1 - 0.2] : [r.z0 + 0.2, r.z1 - 0.2];
      const midAlong = sideAlongZ ? (r.z0 + r.z1) / 2 : (r.x0 + r.x1) / 2;
      lines.forEach((line, i) => {
        [[2.9, 0.06, M.pipeGray], [3.04, 0.035, i ? M.pipeBlue : M.pipeYellow]].forEach(([y, rad, mat]) => {
          const p = add(new THREE.CylinderGeometry(rad, rad, len - 0.3, 14), mat, sideAlongZ ? line : midAlong, y, sideAlongZ ? midAlong : line);
          p.rotation[sideAlongZ ? 'x' : 'z'] = Math.PI / 2;
        });
        // Bridas cada 2 m
        const start = sideAlongZ ? r.z0 : r.x0;
        for (let d = start + 1; d < start + len - 0.5; d += 2) {
          const f = add(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 14), M.darkMetal, sideAlongZ ? line : d, 2.9, sideAlongZ ? d : line);
          f.rotation[sideAlongZ ? 'x' : 'z'] = Math.PI / 2;
        }
      });
    }
    // Rejillas de ventilación bajas en las paredes este/oeste
    [r.x0 + 0.105, r.x1 - 0.105].forEach((x, i) => {
      [r.z0 + (r.z1 - r.z0) * 0.25, r.z0 + (r.z1 - r.z0) * 0.75].forEach((z) => {
        if (Math.abs(z) < 2 && r.key === 'hub') return; // no tapar las puertas del puente
        const v = add(new THREE.PlaneGeometry(0.6, 0.35), M.vent, x, 0.35, z);
        v.rotation.y = i ? -Math.PI / 2 : Math.PI / 2;
      });
    });
  });

  // ------------------------------------------------------------------ bolsas de carga (estilo CTB)
  function bag(x, z, rotY, w = 0.5, h = 0.32, d = 0.4, label = 'CTB 2.0') {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    scene.add(g);
    const b = add(new THREE.BoxGeometry(w, h, d, 2, 2, 2), M.bag, 0, h / 2, 0, g);
    // Hinchar un poco los lados para que parezca tela acolchada
    const pos = b.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);
      const vy = pos.getY(i);
      const bulge = 1 + 0.06 * (1 - Math.abs(vy) / (h / 2));
      pos.setXYZ(i, vx * bulge, vy, vz * bulge);
    }
    b.geometry.computeVertexNormals();
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x3b4252, roughness: 0.9 });
    add(new THREE.BoxGeometry(w * 1.07, 0.04, 0.05), strapMat, 0, h * 0.7, 0, g);
    const tag = add(new THREE.PlaneGeometry(0.2, 0.07), new THREE.MeshStandardMaterial({ map: labelTex([{ text: label }], { w: 256, h: 90 }) }), 0, h * 0.45, d / 2 + 0.03, g);
    tag.userData.label = true;
    return g;
  }
  [[-5.2, 4.6, 0.2], [-4.6, 5.2, -0.4], [-5.2, 4.6, 0, 0.34], [4.9, -4.9, 0.6], [5.2, -4.3, 1.4]].forEach(([x, z, r, y]) => {
    const g = bag(x, z, r);
    if (y) g.position.y = y;
  });
  bag(-4.8, -18, 0.3, 0.6, 0.38, 0.45, 'REPUESTOS');
  bag(18.4, -4.7, Math.PI / 2 - 0.5, 0.55, 0.34, 0.42, 'O₂ FILTROS');

  // ------------------------------------------------------------------ emergencia: extintores y tanques O2
  function extinguisher(x, z) {
    add(new THREE.CylinderGeometry(0.08, 0.08, 0.45, 16), M.red, x, 0.7, z);
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 10), M.darkMetal, x, 0.97, z);
  }
  function o2Tank(x, z) {
    add(new THREE.CylinderGeometry(0.11, 0.11, 0.9, 18), M.green, x, 0.45, z);
    add(new THREE.SphereGeometry(0.11, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.green, x, 0.9, z);
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 10), M.pipeGray, x, 1.04, z);
  }
  extinguisher(-2.2, -5.75);
  extinguisher(2.2, 5.75);
  extinguisher(5.75, 2.2);
  extinguisher(-5.75, -2.2);
  o2Tank(5.5, 5.5);
  o2Tank(5.2, 5.6);
  o2Tank(-5.5, -5.4);

  // Panel rojo de emergencia junto a cada puerta del puente
  [[2.4, -5.89, 0], [-2.4, 5.89, Math.PI], [5.89, -2.5, -Math.PI / 2], [-5.89, 2.5, Math.PI / 2]].forEach(([x, z, rot]) => {
    const p = add(new THREE.PlaneGeometry(0.42, 0.3), new THREE.MeshStandardMaterial({
      map: labelTex([{ text: 'EMERGENCIA', size: 72 }, { text: 'O₂ · FUEGO', size: 44 }, { text: 'DESPRESURIZACIÓN', size: 40 }], { w: 512, h: 360, bg: '#b91c1c', fg: '#ffffff', border: '#fef2f2' }),
      roughness: 0.5
    }), x, 1.5, z);
    p.rotation.y = rot;
  });

  // ------------------------------------------------------------------ letreros técnicos
  const signs = [
    { t: ['MÓDULO PRESURIZADO', '101,3 kPa · 21% O₂'], x: -3.4, y: 2.3, z: -5.89, r: 0 },
    { t: ['NO OBSTRUIR', 'RETORNO DE AIRE'], x: -5.89, y: 0.75, z: 4.2, r: Math.PI / 2 },
    { t: ['⚠ ALTO VOLTAJE', '480 V CC'], x: 5.89, y: 1.8, z: -17, r: -Math.PI / 2 },
    { t: ['⚠ RADIACIÓN', 'ZONA CONTROLADA'], x: 5.89, y: 1.9, z: 14.2, r: -Math.PI / 2 },
    { t: ['GENERADOR DE ESCUDO', 'CAMPO DEFLECTOR'], x: 15.5, y: 1.9, z: 5.89, r: Math.PI },
    { t: ['ANTENA DE ALTA GANANCIA', 'BANDA Ka'], x: -16.5, y: 2.1, z: 5.89, r: Math.PI }
  ];
  signs.forEach((s) => {
    const p = add(new THREE.PlaneGeometry(0.9, 0.3), new THREE.MeshStandardMaterial({
      map: labelTex([{ text: s.t[0] }, { text: s.t[1], weight: 500 }], { w: 512, h: 170, bg: '#f8fafc', fg: '#0f172a' }),
      roughness: 0.5
    }), s.x, s.y, s.z);
    p.rotation.y = s.r;
  });

  // ------------------------------------------------------------------ pantallas animadas del puente
  function screen(x, y, z, rot, kind) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 288;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const g = c.getContext('2d');
    const frame = add(new THREE.BoxGeometry(1.5, 0.9, 0.06), M.darkMetal, x, y, z);
    frame.rotation.y = rot;
    const s = add(new THREE.PlaneGeometry(1.4, 0.8), new THREE.MeshBasicMaterial({ map: tex }), 0, 0, 0.032, frame);
    s.userData.screen = true;
    let acc = 0;
    const hist = Array.from({ length: 60 }, () => 0.5);
    animated.push((dt, t) => {
      acc += dt;
      if (acc < 0.25) return null;
      acc = 0;
      g.fillStyle = '#04111d';
      g.fillRect(0, 0, 512, 288);
      g.strokeStyle = '#0e3a5c';
      g.lineWidth = 1;
      for (let i = 0; i < 512; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 288); g.stroke(); }
      for (let i = 0; i < 288; i += 32) { g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
      g.font = '700 22px "Share Tech Mono", monospace';
      g.fillStyle = '#7dd3fc';
      if (kind === 'life') {
        g.fillText('SOPORTE VITAL', 16, 30);
        hist.shift();
        hist.push(0.5 + Math.sin(t * 1.3) * 0.15 + (Math.random() - 0.5) * 0.08);
        g.strokeStyle = '#34d399';
        g.lineWidth = 3;
        g.beginPath();
        hist.forEach((v, i) => (i ? g.lineTo(16 + i * 8, 260 - v * 200) : g.moveTo(16, 260 - v * 200)));
        g.stroke();
        g.fillStyle = '#a7f3d0';
        g.fillText(`O₂ ${(20.8 + Math.sin(t) * 0.2).toFixed(1)}%   CO₂ ${(0.31 + Math.sin(t * 0.7) * 0.03).toFixed(2)}%`, 16, 62);
      } else {
        g.fillText('NAVEGACIÓN // ÓRBITA', 16, 30);
        g.strokeStyle = '#38bdf8';
        g.lineWidth = 2;
        g.beginPath();
        g.ellipse(256, 160, 180, 80, 0, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = '#1d4ed8';
        g.beginPath();
        g.arc(256, 160, 34, 0, Math.PI * 2);
        g.fill();
        const a = t * 0.4;
        g.fillStyle = '#facc15';
        g.beginPath();
        g.arc(256 + Math.cos(a) * 180, 160 + Math.sin(a) * 80, 7, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#7dd3fc';
        g.fillText(`ALT ${(412 + Math.sin(a) * 6).toFixed(1)} km   V 7,66 km/s`, 16, 275);
      }
      tex.needsUpdate = true;
      return null;
    });
  }
  screen(-5.86, 1.7, -3.8, Math.PI / 2, 'life');
  screen(5.86, 1.7, 3.8, -Math.PI / 2, 'nav');

  // ------------------------------------------------------------------ equipo de cada sala
  // Comunicaciones: racks con luces parpadeantes
  const ledMats = [0x22c55e, 0x38bdf8, 0xf59e0b].map((c) => new THREE.MeshBasicMaterial({ color: c }));
  const offMat = new THREE.MeshBasicMaterial({ color: 0x111827 });
  [[-21.4, -3.6], [-21.4, 3.6]].forEach(([x, z]) => {
    add(new THREE.BoxGeometry(0.7, 2.1, 1.0), M.darkMetal, x, 1.05, z);
    const leds = [];
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 5; col++) {
        const led = add(new THREE.BoxGeometry(0.01, 0.025, 0.05), ledMats[(row + col) % 3], x + 0.355, 0.4 + row * 0.13, z - 0.3 + col * 0.15);
        leds.push(led);
      }
    }
    animated.push((dt, t) => {
      leds.forEach((l, i) => {
        l.material = Math.sin(t * (2 + (i % 7)) + i) > 0.2 ? ledMats[i % 3] : offMat;
      });
      return null;
    });
  });
  // Antena parabólica pequeña sobre una base (decorativa)
  const dish = add(new THREE.SphereGeometry(0.45, 24, 12, 0, Math.PI * 2, 0, Math.PI / 3.2), M.panel, -15, 2.2, -4.8);
  dish.rotation.x = Math.PI / 2.4;
  add(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 10), M.pipeGray, -15, 1.1, -5.2);

  // Energía: bancos de baterías con barras de carga
  const barMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  [-5.4, 5.4].forEach((x) => {
    [-15, -17.5].forEach((z) => {
      add(new THREE.BoxGeometry(0.8, 1.6, 1.1), M.panel, x, 0.8, z);
      const bars = [];
      for (let i = 0; i < 6; i++) {
        const b = add(new THREE.BoxGeometry(0.02, 0.09, 0.7), barMat, x - Math.sign(x) * 0.41, 0.5 + i * 0.13, z);
        bars.push(b);
      }
      animated.push((dt, t) => {
        const level = 3 + Math.round(Math.sin(t * 0.8 + z) * 2);
        bars.forEach((b, i) => (b.visible = i <= level));
        return null;
      });
    });
  });

  // Escudo: bobina del generador girando en el techo
  const coil = add(new THREE.TorusGeometry(1.1, 0.09, 12, 48), new THREE.MeshStandardMaterial({
    color: 0x22d3ee, emissive: 0x0891b2, emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.6
  }), 15.5, 2.55, 3.2);
  coil.rotation.x = Math.PI / 2;
  const coil2 = add(new THREE.TorusGeometry(0.75, 0.05, 10, 40), coil.material, 15.5, 2.55, 3.2);
  coil2.rotation.x = Math.PI / 2;
  animated.push((dt, t) => {
    coil.rotation.z = t * 0.8;
    coil2.rotation.y = t * 1.6;
    return null;
  });

  // Reactor: conductos verticales alrededor del núcleo
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(new THREE.CylinderGeometry(0.05, 0.05, WALL_H, 10), M.pipeGray, 4.2 + Math.cos(a) * 0.95, WALL_H / 2, 16 + Math.sin(a) * 0.95);
  }

  // Obstáculos (círculos x, z, radio) para que el astronauta no atraviese los equipos
  const obstacles = [
    { x: -21.4, z: -3.6, r: 0.65 }, { x: -21.4, z: 3.6, r: 0.65 }, { x: -15, z: -5.2, r: 0.25 },
    { x: -5.4, z: -15, r: 0.65 }, { x: 5.4, z: -15, r: 0.65 }, { x: -5.4, z: -17.5, r: 0.65 }, { x: 5.4, z: -17.5, r: 0.65 },
    { x: 5.35, z: 5.55, r: 0.3 }, { x: -5.5, z: -5.4, r: 0.15 }
  ];

  return {
    doors,
    obstacles,
    update(dt, t, player) {
      const events = [];
      animated.forEach((fn) => {
        const e = fn(dt, t, player);
        if (e) events.push(e);
      });
      return events;
    }
  };
}
