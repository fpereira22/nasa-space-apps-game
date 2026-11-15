/**
 * Paneles 3D interactivos: cada módulo es un objeto físico sobre la consola de su sala.
 *
 * El tablero HTML (tablero.html) sigue siendo la "fuente de verdad": estos paneles
 *  - LEEN su estado (GameState y el DOM del tablero) para dibujarse igual, y
 *  - al hacer clic, disparan el MISMO clic sobre el elemento del tablero.
 * Así las reglas, los strikes y la telemetría son exactamente los mismos en 2D y en 3D.
 *
 *  01 CABLES  -> 4 cables con terminales: clic = cortar
 *  02 NÚCLEO  -> botón grande con tira de luz y reloj: mantener / soltar
 *  03 ESCUDO  -> 4 botones de colores en rombo: clic = presionar
 *  04 FASE    -> pantalla de frecuencia + 4 teclas con símbolos
 */
import * as THREE from 'three';
import { canvasTex, hazardStripes } from './textures.js';

const REACH = 2.6; // distancia máxima (m) del astronauta al punto de uso de la consola

const COLORS = {
  red: 0xef4444, blue: 0x3b82f6, yellow: 0xeab308, white: 0xf8fafc, green: 0x22c55e
};
const BUTTON_COLORS = { blue: 0x2563eb, red: 0xdc2626, white: 0xe2e8f0, yellow: 0xf59e0b };

const $ = (id) => document.getElementById(id);
const gs = () => window.GameState;

// ----------------------------------------------------------------- utilidades
function textTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const redraw = (...args) => {
    draw(c.getContext('2d'), w, h, ...args);
    tex.needsUpdate = true;
  };
  return { tex, redraw };
}

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2, ...opts });
}

export function createPanels({ scene, stationRooms }) {
  const parts = []; // mallas clicables
  const panels = {}; // key -> { group, use, update() }
  let hovered = null;
  let holding = null;

  const baseMat = mat(0x262b33, { roughness: 0.55, metalness: 0.6 });
  const trimMat = mat(0x111418, { roughness: 0.7 });
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardStripes(), roughness: 0.6 });
  hazardMat.map.repeat.set(4, 1);

  function registerPart(mesh, info) {
    mesh.userData.part = info;
    // material propio para poder resaltarlo sin afectar a otros
    mesh.material = mesh.material.clone();
    mesh.userData.baseEmissive = mesh.material.emissive ? mesh.material.emissive.clone() : null;
    parts.push(mesh);
    return mesh;
  }

  // ---------------------------------------------------------------- base común
  function buildDeck(room) {
    const s = room.station;
    const station = new THREE.Group();
    station.position.set(s.x, 0, s.z);
    station.rotation.y = s.rot;
    scene.add(station);

    // Atril inclinado sobre el escritorio
    const deck = new THREE.Group();
    deck.position.set(0, 1.16, 0.12);
    deck.rotation.x = -0.95;
    station.add(deck);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.74, 0.05), baseMat);
    plate.position.z = -0.025;
    deck.add(plate);
    // Marco con cinta de peligro
    [[0, 0.385, 1.42, 0.035], [0, -0.385, 1.42, 0.035], [0.695, 0, 0.035, 0.8], [-0.695, 0, 0.035, 0.8]].forEach(([x, y, w, h]) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), hazardMat);
      b.position.set(x, y, 0.005);
      deck.add(b);
    });
    // Soporte del atril (detrás, bajo el borde levantado; no tapa el panel)
    const stand = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.2, 0.08), trimMat);
    stand.position.set(0, 1.1, -0.2);
    station.add(stand);

    // Etiqueta del módulo
    const label = textTexture(512, 64, (g, w, h) => {
      g.fillStyle = '#0b0e12';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#cbd5e1';
      g.font = '700 34px Orbitron, monospace';
      g.textBaseline = 'middle';
      g.fillText(`MÓDULO ${room.module}`, 14, h / 2);
    });
    label.redraw();
    const labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.075), new THREE.MeshBasicMaterial({ map: label.tex }));
    labelMesh.position.set(-0.33, 0.315, 0.002);
    deck.add(labelMesh);

    // LED de estado (verde = reparado)
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), new THREE.MeshStandardMaterial({ color: 0x3f0d0d, emissive: 0x000000 }));
    led.position.set(0.62, 0.315, 0.01);
    deck.add(led);

    // Placa con serial y baterías (sobre el escritorio, a la izquierda)
    const plateTex = textTexture(256, 128, (g, w, h, serial, batteries) => {
      g.fillStyle = '#e4e4e7';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#52525b';
      g.lineWidth = 6;
      g.strokeRect(3, 3, w - 6, h - 6);
      g.fillStyle = '#52525b';
      g.font = '700 18px monospace';
      g.fillText('SERIAL #', 14, 28);
      g.fillStyle = '#09090b';
      g.font = '900 40px monospace';
      g.fillText(serial || '---', 14, 72);
      g.fillStyle = '#92400e';
      g.font = '700 22px monospace';
      g.fillText(`BATERÍAS: ${batteries || '-'} × AA`, 14, 110);
    });
    const serialPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), new THREE.MeshStandardMaterial({ map: plateTex.tex, roughness: 0.4, metalness: 0.3 }));
    serialPlate.position.set(-0.86, 1.012, 0.12);
    serialPlate.rotation.x = -Math.PI / 2 + 0.25;
    station.add(serialPlate);
    // Pilas físicas al lado de la placa
    const batteryMeshes = [];
    for (let i = 0; i < 3; i++) {
      const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 14), mat(0xb45309, { metalness: 0.5 }));
      cell.rotation.z = Math.PI / 2;
      cell.position.set(-0.86, 1.03, 0.27 + i * 0.045);
      station.add(cell);
      batteryMeshes.push(cell);
    }

    let lastPlate = '';
    function updateCommon(solved) {
      led.material.color.setHex(solved ? 0x22c55e : 0x7f1d1d);
      led.material.emissive.setHex(solved ? 0x22c55e : 0x000000);
      const st = gs();
      const key = st ? `${st.serial}|${st.batteries}` : '';
      if (key !== lastPlate && st) {
        lastPlate = key;
        plateTex.redraw(st.serial, st.batteries);
        batteryMeshes.forEach((b, i) => (b.visible = i < st.batteries));
      }
    }
    return { station, deck, updateCommon };
  }

  // ---------------------------------------------------------------- 01 CABLES
  function buildWires(room) {
    const { station, deck, updateCommon } = buildDeck(room);
    const terminalMat = mat(0x3f444d, { metalness: 0.8, roughness: 0.3 });
    [-0.52, 0.52].forEach((x) => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.52, 0.06), terminalMat);
      t.position.set(x, -0.03, 0.03);
      deck.add(t);
    });
    const ROWS = [0.17, 0.05, -0.07, -0.19]; // de arriba (lejos) hacia abajo (cerca) = orden del tablero
    const wires = ROWS.map((y, i) => {
      const halves = [-1, 1].map((side) => {
        const g = new THREE.Group();
        g.position.set(side * 0.48, y, 0.05);
        deck.add(g);
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(-side * 0.25, -0.015, 0.05),
          new THREE.Vector3(-side * 0.48, 0, 0.04)
        );
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.017, 10, false), mat(0xffffff, { roughness: 0.35 }));
        g.add(tube);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), mat(0xd97706, { metalness: 1, roughness: 0.25 }));
        tip.position.set(-side * 0.48, 0, 0.04);
        tip.visible = false;
        g.add(tip);
        registerPart(tube, { station: 'wires', kind: 'wire', index: i, label: `CORTAR CABLE ${i + 1}` });
        return { g, tube, tip, side };
      });
      return halves;
    });

    return {
      use: room.station,
      station,
      update() {
        const st = gs();
        if (!st || !st.wiresData) return;
        updateCommon(st.solved.wires);
        wires.forEach((halves, i) => {
          const w = st.wiresData[i];
          if (!w) return;
          halves.forEach((h) => {
            h.tube.material.color.set(w.hex);
            // Cortado: cada mitad se recoge y cuelga un poco, dejando ver el cobre
            h.g.scale.x = w.cut ? 0.78 : 1;
            h.g.rotation.z = w.cut ? h.side * -0.12 : 0;
            h.tip.visible = w.cut;
          });
        });
      },
      press(part) {
        const btn = document.querySelectorAll('#wiresList button')[part.index];
        if (btn) btn.click();
      }
    };
  }

  // ---------------------------------------------------------------- 02 NÚCLEO
  function buildButton(room) {
    const { station, deck, updateCommon } = buildDeck(room);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.18, 0.04, 40), mat(0x52525b, { metalness: 0.9, roughness: 0.3 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(-0.2, -0.05, 0.02);
    deck.add(ring);

    const capLabel = textTexture(256, 256, (g, w, h, text, dark) => {
      g.clearRect(0, 0, w, h);
      // Tamaño según el largo de la palabra, para que quepa en la tapa redonda
      g.font = `900 ${Math.min(46, Math.floor(250 / (text.length * 0.78)))}px Orbitron, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 7;
      g.strokeStyle = dark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.75)';
      g.strokeText(text, w / 2, h / 2);
      g.fillStyle = dark ? '#0f172a' : '#ffffff';
      g.fillText(text, w / 2, h / 2);
    });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.07, 40), mat(0x2563eb, { roughness: 0.3 }));
    cap.rotation.x = Math.PI / 2;
    cap.position.set(-0.2, -0.05, 0.065);
    deck.add(cap);
    registerPart(cap, { station: 'button', kind: 'button', label: 'MANTENER / SOLTAR EL BOTÓN', hold: true });
    const capText = new THREE.Mesh(new THREE.CircleGeometry(0.135, 40), new THREE.MeshBasicMaterial({ map: capLabel.tex, transparent: true }));
    capText.position.set(-0.2, -0.05, 0.101);
    deck.add(capText);

    // Tira de luz lateral
    const stripMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x000000, roughness: 0.3 });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.03), stripMat);
    strip.position.set(0.18, -0.05, 0.03);
    deck.add(strip);

    // Reloj de 7 segmentos (copia del temporizador del tablero)
    const clock = textTexture(256, 96, (g, w, h, text) => {
      g.fillStyle = '#050505';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ef4444';
      g.shadowColor = '#ef4444';
      g.shadowBlur = 12;
      g.font = '900 62px Orbitron, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 2);
    });
    const clockMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.15), new THREE.MeshBasicMaterial({ map: clock.tex }));
    clockMesh.position.set(0.45, 0.13, 0.005);
    deck.add(clockMesh);

    let lastLabel = '';
    let lastClock = '';
    return {
      use: room.station,
      station,
      update() {
        const st = gs();
        if (!st || !st.buttonData) return;
        updateCommon(st.solved.button);
        const b = st.buttonData;
        const key = `${b.label}|${b.color}`;
        if (key !== lastLabel) {
          lastLabel = key;
          cap.material.color.setHex(BUTTON_COLORS[b.color] || 0x2563eb);
          capLabel.redraw(b.label, b.color === 'white' || b.color === 'yellow');
        }
        const lit = ($('buttonStrip') || { className: '' }).className.includes('shadow-');
        const stripColor = COLORS[(b.strip && b.strip.name) || 'red'];
        stripMat.color.setHex(lit ? stripColor : 0x0f172a);
        stripMat.emissive.setHex(lit ? stripColor : 0x000000);
        stripMat.emissiveIntensity = lit ? 2.2 : 0;
        const pressed = st.isHoldingButton;
        cap.position.z = pressed ? 0.045 : 0.065;
        capText.position.z = pressed ? 0.081 : 0.101;
        const t = ($('timerDisplay') || { textContent: '' }).textContent.trim();
        if (t !== lastClock) {
          lastClock = t;
          clock.redraw(t);
        }
      },
      press() {
        const el = $('coreButton');
        if (el) el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      },
      release() {
        const el = $('coreButton');
        if (el) el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      }
    };
  }

  // ---------------------------------------------------------------- 03 ESCUDO
  function buildSimon(room) {
    const { station, deck, updateCommon } = buildDeck(room);
    const layout = { red: [0, 0.15], blue: [0.15, 0], yellow: [-0.15, 0], green: [0, -0.15] };
    const NAMES = { red: 'ROJO', blue: 'AZUL', yellow: 'AMARILLO', green: 'VERDE' };
    const pads = Object.entries(layout).map(([color, [x, y]]) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.17, 0.17, 0.05),
        mat(COLORS[color], { roughness: 0.25, emissive: COLORS[color], emissiveIntensity: 0.05, transparent: true, opacity: 0.95 })
      );
      m.rotation.z = Math.PI / 4;
      m.position.set(x - 0.02, y - 0.03, 0.03);
      deck.add(m);
      registerPart(m, { station: 'simon', kind: 'simon', color, label: `PRESIONAR ${NAMES[color]}` });
      return { m, color };
    });
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.03, 4), trimMat);
    housing.rotation.x = Math.PI / 2;
    housing.position.set(-0.02, -0.03, 0.01);
    deck.add(housing);

    return {
      use: room.station,
      station,
      update() {
        const st = gs();
        if (!st) return;
        updateCommon(st.solved.simon);
        pads.forEach(({ m, color }) => {
          const dom = document.querySelector(`.simon-btn[data-color="${color}"]`);
          const lit = dom && dom.style.backgroundColor !== '';
          m.material.emissiveIntensity = lit ? 2.6 : 0.06;
          m.position.z = lit ? 0.022 : 0.03;
        });
      },
      press(part) {
        const dom = document.querySelector(`.simon-btn[data-color="${part.color}"]`);
        if (dom) dom.click();
      }
    };
  }

  // ---------------------------------------------------------------- 04 FASE
  function buildKeypad(room) {
    const { station, deck, updateCommon } = buildDeck(room);
    const freq = textTexture(512, 96, (g, w, h, text) => {
      g.fillStyle = '#020a06';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#34d399';
      g.shadowColor = '#34d399';
      g.shadowBlur = 10;
      g.font = '700 54px "Share Tech Mono", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 2);
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.14), new THREE.MeshBasicMaterial({ map: freq.tex }));
    screen.position.set(0, 0.17, 0.005);
    deck.add(screen);

    const keys = [-0.42, -0.14, 0.14, 0.42].map((x, i) => {
      const face = textTexture(128, 160, (g, w, h, sym, state) => {
        g.fillStyle = state === 'ok' ? '#064e3b' : '#1e293b';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = state === 'ok' ? '#34d399' : '#475569';
        g.lineWidth = 8;
        g.strokeRect(4, 4, w - 8, h - 8);
        g.fillStyle = state === 'ok' ? '#6ee7b7' : '#fcd34d';
        g.font = '700 92px serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(sym, w / 2, h / 2 + 4);
      });
      const key = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.27, 0.05),
        [mat(0x334155), mat(0x334155), mat(0x334155), mat(0x334155), new THREE.MeshStandardMaterial({ map: face.tex, roughness: 0.4 }), mat(0x334155)]
      );
      key.position.set(x, -0.1, 0.03);
      deck.add(key);
      // Las teclas tienen varios materiales: para resaltar se usa el de la cara frontal
      key.userData.part = { station: 'keypad', kind: 'key', index: i, label: 'PRESIONAR SÍMBOLO' };
      key.userData.faceMat = key.material[4];
      key.userData.baseEmissive = new THREE.Color(0x000000);
      parts.push(key);
      return { key, face, last: '' };
    });

    let lastFreq = '';
    return {
      use: room.station,
      station,
      update() {
        const st = gs();
        if (!st) return;
        updateCommon(st.solved.keypad);
        const f = ($('freqDisplay') || { textContent: '' }).textContent.trim();
        if (f !== lastFreq) {
          lastFreq = f;
          freq.redraw(f);
        }
        const domKeys = document.querySelectorAll('#keypadGrid button');
        keys.forEach((k, i) => {
          const dom = domKeys[i];
          if (!dom) return;
          const ok = dom.className.includes('emerald');
          const sig = `${dom.textContent}|${ok}`;
          if (sig !== k.last) {
            k.last = sig;
            k.face.redraw(dom.textContent, ok ? 'ok' : '');
            k.key.userData.part.label = `PRESIONAR ${dom.textContent}`;
          }
          k.key.position.z = ok ? 0.018 : 0.03;
        });
      },
      press(part) {
        const dom = document.querySelectorAll('#keypadGrid button')[part.index];
        if (dom) dom.click();
      }
    };
  }

  const builders = { wires: buildWires, button: buildButton, simon: buildSimon, keypad: buildKeypad };
  stationRooms.forEach((room) => {
    panels[room.key] = builders[room.key](room);
  });

  // ---------------------------------------------------------------- interacción
  function setEmissive(mesh, on) {
    const m = mesh.userData.faceMat || mesh.material;
    if (!m.emissive) return;
    if (on) {
      // Los botones de color conservan su color; el resto se resalta en azul
      const kind = mesh.userData.part && mesh.userData.part.kind;
      // Botones de color (Simón y botón del núcleo) brillan con su propio color; el resto en azul
      if (kind === 'button') m.emissive.copy(m.color);
      else if (kind !== 'simon') m.emissive.setHex(0x3b82f6);
      m.userData = m.userData || {};
      if (m.userData.prevIntensity === undefined) m.userData.prevIntensity = m.emissiveIntensity;
      m.emissiveIntensity = Math.max(m.emissiveIntensity, kind === 'button' ? 0.3 : 0.45);
    } else {
      if (mesh.userData.baseEmissive) m.emissive.copy(mesh.userData.baseEmissive);
      if (m.userData && m.userData.prevIntensity !== undefined) {
        m.emissiveIntensity = m.userData.prevIntensity;
        delete m.userData.prevIntensity;
      }
    }
  }

  return {
    parts,
    // ¿Qué parte del panel está bajo el rayo? Solo si el astronauta está cerca de esa consola
    pick(raycaster, player) {
      const hit = raycaster.intersectObjects(parts, false)[0];
      if (!hit || hit.distance > 6) return null;
      const info = hit.object.userData.part;
      const use = panels[info.station].use;
      if (Math.hypot(player.x - use.useX, player.z - use.useZ) > REACH) return null;
      const st = gs();
      if (!st || st.isOver || st.solved[info.station]) return null;
      return { mesh: hit.object, ...info };
    },
    setHover(part) {
      const mesh = part ? part.mesh : null;
      if (hovered === mesh) return;
      if (hovered) setEmissive(hovered, false);
      hovered = mesh;
      if (hovered) setEmissive(hovered, true);
    },
    press(part) {
      const p = panels[part.station];
      p.press(part);
      if (part.hold) holding = p;
      return part;
    },
    release() {
      if (holding && holding.release) holding.release();
      const was = holding;
      holding = null;
      return Boolean(was);
    },
    get holding() {
      return Boolean(holding);
    },
    update() {
      Object.values(panels).forEach((p) => p.update());
      // Al resaltar, update() puede haber cambiado la intensidad (Simón): mantener el resalte
      if (hovered) setEmissive(hovered, true);
    }
  };
}
