/**
 * PANEL DE MUÑECA en primera persona: las manos enguantadas del traje EMU sostienen una tableta
 * digital con las comunicaciones de la misión.
 *
 *  - Siempre visibles en 1ª persona: las manos llevan el panel bajo, casi fuera de la vista,
 *    y se balancean al caminar.
 *  - Q (o el botón 📟 PANEL) levanta el panel frente al visor. Se usa con el mouse/dedo
 *    o con las teclas 1–6:
 *      1 RADIO   activar / mantener presionado para hablar (igual que T)
 *      2 CHAT    abre el chat con control en tierra (muestra los no leídos)
 *      3 VOZ     voz de la nave encendida/apagada
 *      4 SONIDO  sonido 3D de la nave
 *      5 MÚSICA  banda sonora
 *      6 CERRAR
 *    Además muestra el tiempo, los strikes, quién habla por radio y los últimos mensajes.
 *
 * Se dibuja en una escena aparte, después de la nave y con el z-buffer limpio, para que las manos
 * nunca atraviesen paredes o consolas (como en los juegos en primera persona).
 * Comunicaciones: window.AetherComms (tablero.html).
 */
import * as THREE from 'three';

const TILES = [
  { id: 'radio', key: '1' },
  { id: 'chat', key: '2' },
  { id: 'voice', key: '3' },
  { id: 'sound', key: '4' },
  { id: 'music', key: '5' },
  { id: 'close', key: '6' }
];
const CW = 1024;
const CH = 640;
const GRID = { x: 36, y: 128, w: CW - 72, h: 330, cols: 3, rows: 2, gap: 16 };

export function createHandPad({ materials, environment, isSoundEnabled, toggleSound, onClose }) {
  const scene = new THREE.Scene();
  // Lente propia: las manos no cambian de tamaño durante las transiciones de cámara.
  const viewCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
  scene.environment = environment;
  scene.add(new THREE.HemisphereLight(0xdbe7ff, 0x30343c, 1.4));
  const key = new THREE.DirectionalLight(0xfff4dc, 1.6);
  key.position.set(0.4, 1, 0.6);
  scene.add(key);

  const holder = new THREE.Group(); // copia la pose de la cámara
  scene.add(holder);
  const pad = new THREE.Group(); // tableta + manos
  holder.add(pad);

  // ------------------------------------------------------------------ tableta
  const M = materials;
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.45, metalness: 0.6 });
  const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  add(pad, new THREE.BoxGeometry(0.31, 0.2, 0.016), frameMat);
  add(pad, new THREE.BoxGeometry(0.29, 0.18, 0.004), new THREE.MeshBasicMaterial({ color: 0x020409 }), 0, 0, 0.0075);
  // Asas laterales y luces de estado
  [-1, 1].forEach((s) => {
    add(pad, new THREE.BoxGeometry(0.022, 0.15, 0.03), M.hard, s * 0.163, 0, -0.004);
    add(pad, new THREE.CylinderGeometry(0.004, 0.004, 0.003, 10), new THREE.MeshBasicMaterial({ color: s < 0 ? 0x34d399 : 0xf59e0b }), s * 0.13, 0.093, 0.009).rotation.x = Math.PI / 2;
  });
  add(pad, new THREE.BoxGeometry(0.08, 0.012, 0.012), M.metal, 0, 0.104, -0.002);

  const canvas = document.createElement('canvas');
  canvas.width = CW;
  canvas.height = CH;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const screen = add(pad, new THREE.PlaneGeometry(0.28, 0.175), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), 0, 0, 0.0099);

  // ------------------------------------------------------------------ manos y antebrazos
  // Cada mano agarra el borde lateral: palma y dedos detrás de la tableta, pulgar por delante.
  const hands = [-1, 1].map((s) => {
    const hand = new THREE.Group();
    hand.position.set(s * 0.17, -0.025, -0.01);
    pad.add(hand);
    add(hand, new THREE.BoxGeometry(0.045, 0.095, 0.05), M.glove, s * 0.012, 0, -0.022); // dorso/palma
    add(hand, new THREE.BoxGeometry(0.05, 0.085, 0.006), M.palm, s * 0.01, 0, 0.002);
    // Dedos curvados detrás de la tableta
    for (let i = 0; i < 4; i++) {
      const f = add(hand, new THREE.CapsuleGeometry(0.0095, 0.03, 4, 8), M.glove, -s * 0.012, 0.03 - i * 0.021, -0.022);
      f.rotation.z = Math.PI / 2;
    }
    // Pulgar sobre el marco
    const thumb = add(hand, new THREE.CapsuleGeometry(0.011, 0.035, 4, 8), M.glove, -s * 0.014, 0.03, 0.017);
    thumb.rotation.z = s * 0.6;
    // Muñeca (anillo azul del traje) y antebrazo hacia abajo y afuera, fuera de cuadro
    const wrist = add(hand, new THREE.TorusGeometry(0.04, 0.011, 8, 20), M.blueMetal, s * 0.035, -0.055, -0.04);
    wrist.rotation.set(Math.PI / 2 - 0.5, 0, s * 0.5);
    const fore = new THREE.Group();
    fore.position.set(s * 0.04, -0.06, -0.04);
    hand.add(fore);
    const sleeve = add(fore, new THREE.CapsuleGeometry(0.048, 0.28, 6, 14), M.suit, 0, -0.16, 0);
    sleeve.material = M.suit;
    fore.rotation.set(0.75, 0, s * 0.55);
    // Lista de chequeo en la muñeca izquierda
    if (s < 0) {
      const cuff = add(fore, new THREE.BoxGeometry(0.06, 0.08, 0.025), M.hard, 0, -0.08, 0.045);
      cuff.rotation.x = 0.1;
    }
    return { hand, thumb };
  });

  // Nada de esto proyecta sombra ni se ve afectado por la niebla
  scene.traverse((o) => {
    if (o.isMesh) o.frustumCulled = false;
  });

  // ------------------------------------------------------------------ estado
  const st = {
    visible: false,
    open: false,
    raise: 0, // 0 = bajo, 1 = frente al visor
    bob: 0,
    hover: null,
    pressed: null,
    radioKey: false,
    redrawIn: 0,
    flash: {}
  };
  const comms = () => window.AetherComms || null;

  function tileState(id) {
    const c = comms();
    switch (id) {
      case 'radio': {
        const r = c ? c.radio() : { state: 'none' };
        if (r.state === 'none') return { icon: '📻', title: 'RADIO', sub: 'SIN SERVIDOR', on: false, disabled: true };
        if (r.state === 'ready') return { icon: '🎙', title: r.talking ? 'TRANSMITIENDO' : 'RADIO', sub: r.talking ? 'SUELTA PARA TERMINAR' : 'MANTÉN PARA HABLAR', on: true, live: r.talking };
        if (r.state === 'listen') return { icon: '📻', title: 'RADIO', sub: 'SOLO ESCUCHAS', on: true };
        if (r.state === 'connecting') return { icon: '📻', title: 'RADIO', sub: 'CONECTANDO…', on: false };
        return { icon: '📻', title: 'RADIO', sub: r.state === 'error' ? 'REINTENTAR' : 'TOCA PARA ACTIVAR', on: false };
      }
      case 'chat': {
        const ch = c ? c.chat() : { available: false };
        if (!ch.available) return { icon: '💬', title: 'CHAT', sub: 'SIN SERVIDOR', disabled: true };
        return { icon: '💬', title: 'CHAT', sub: ch.open ? 'ABIERTO · CERRAR' : 'ESCRIBIR A TIERRA', on: ch.open, badge: ch.unread };
      }
      case 'voice': {
        const on = Boolean(c && c.voiceOn);
        return { icon: '🗣', title: 'VOZ NAVE', sub: on ? 'ENCENDIDA' : 'APAGADA', on };
      }
      case 'sound': {
        const on = isSoundEnabled();
        return { icon: on ? '🔊' : '🔇', title: 'SONIDO 3D', sub: on ? 'ENCENDIDO' : 'APAGADO', on };
      }
      case 'music': {
        const on = Boolean(c && c.musicOn);
        return { icon: '🎵', title: 'MÚSICA', sub: on ? 'ENCENDIDA' : 'APAGADA', on };
      }
      default:
        return { icon: '⏏', title: 'BAJAR PANEL', sub: 'TECLA Q', on: false };
    }
  }

  function tileRect(i) {
    const w = (GRID.w - GRID.gap * (GRID.cols - 1)) / GRID.cols;
    const h = (GRID.h - GRID.gap * (GRID.rows - 1)) / GRID.rows;
    const col = i % GRID.cols;
    const row = Math.floor(i / GRID.cols);
    return { x: GRID.x + col * (w + GRID.gap), y: GRID.y + row * (h + GRID.gap), w, h };
  }

  function roundRect(x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function fit(text, max) {
    let t = String(text);
    while (t.length > 3 && g.measureText(t).width > max) t = t.slice(0, -2);
    return t === String(text) ? t : `${t}…`;
  }

  function draw(game) {
    const now = performance.now();
    // Fondo con líneas de barrido
    const bg = g.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, '#071423');
    bg.addColorStop(1, '#030912');
    g.fillStyle = bg;
    g.fillRect(0, 0, CW, CH);
    g.fillStyle = 'rgba(56,189,248,0.04)';
    for (let y = 0; y < CH; y += 4) g.fillRect(0, y, CW, 1);

    // Encabezado: misión, tiempo, strikes
    g.textBaseline = 'middle';
    g.fillStyle = '#38bdf8';
    g.font = 'bold 30px "Share Tech Mono", monospace';
    g.textAlign = 'left';
    g.fillText('U.S.S. AETHER · PANEL DE MUÑECA', 36, 52);
    if (game) {
      const t = Math.max(0, Math.ceil(game.timeLeft || 0));
      const mm = String(Math.floor(t / 60)).padStart(2, '0');
      const ss = String(t % 60).padStart(2, '0');
      g.textAlign = 'right';
      g.font = 'bold 44px "Share Tech Mono", monospace';
      g.fillStyle = t <= 30 ? (Math.floor(now / 400) % 2 ? '#f87171' : '#fecaca') : t <= 60 ? '#fbbf24' : '#e2e8f0';
      g.fillText(`${mm}:${ss}`, CW - 36, 50);
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(CW - 250 + i * 30, 52, 10, 0, Math.PI * 2);
        g.fillStyle = i < (game.strikes || 0) ? '#ef4444' : '#1e293b';
        g.fill();
        g.strokeStyle = '#475569';
        g.lineWidth = 2;
        g.stroke();
      }
    }
    g.fillStyle = '#1e3a5f';
    g.fillRect(36, 92, CW - 72, 3);

    // Botones
    TILES.forEach((tile, i) => {
      const s = tileState(tile.id);
      const r = tileRect(i);
      const hover = st.hover === i && !s.disabled;
      const flash = st.flash[tile.id] && now - st.flash[tile.id] < 220;
      roundRect(r.x, r.y, r.w, r.h, 18);
      g.fillStyle = s.live ? '#7f1d1d' : flash ? '#0e7490' : hover ? '#0c2d48' : '#0a1a2c';
      g.fill();
      g.lineWidth = hover ? 5 : 3;
      g.strokeStyle = s.disabled ? '#1f2937' : s.live ? '#fca5a5' : s.on ? '#22d3ee' : hover ? '#7dd3fc' : '#334155';
      g.stroke();
      g.globalAlpha = s.disabled ? 0.4 : 1;
      g.textAlign = 'left';
      g.font = 'bold 24px "Share Tech Mono", monospace';
      g.fillStyle = '#64748b';
      g.fillText(tile.key, r.x + 18, r.y + 26);
      g.textAlign = 'center';
      g.font = '54px sans-serif';
      g.fillStyle = '#fff';
      g.fillText(s.icon, r.x + r.w / 2, r.y + 62);
      g.font = 'bold 30px "Share Tech Mono", monospace';
      g.fillStyle = s.live ? '#fee2e2' : '#e2e8f0';
      g.fillText(fit(s.title, r.w - 20), r.x + r.w / 2, r.y + 112);
      g.font = '22px "Share Tech Mono", monospace';
      g.fillStyle = s.on ? '#67e8f9' : '#94a3b8';
      g.fillText(fit(s.sub, r.w - 20), r.x + r.w / 2, r.y + 142);
      // Indicador encendido
      if (!s.disabled && tile.id !== 'close') {
        g.beginPath();
        g.arc(r.x + r.w - 24, r.y + 24, 8, 0, Math.PI * 2);
        g.fillStyle = s.live ? '#ef4444' : s.on ? '#34d399' : '#475569';
        g.fill();
      }
      if (s.badge) {
        g.beginPath();
        g.arc(r.x + r.w - 30, r.y + 30, 20, 0, Math.PI * 2);
        g.fillStyle = '#f59e0b';
        g.fill();
        g.fillStyle = '#0f172a';
        g.font = 'bold 24px "Share Tech Mono", monospace';
        g.fillText(s.badge > 9 ? '9+' : String(s.badge), r.x + r.w - 30, r.y + 31);
      }
      g.globalAlpha = 1;
    });

    // Pie: quién habla y últimos mensajes del chat
    const c = comms();
    const y0 = GRID.y + GRID.h + 22;
    g.textAlign = 'left';
    g.font = '24px "Share Tech Mono", monospace';
    const radio = c ? c.radio() : null;
    const lines = [];
    if (radio && radio.talkers && radio.talkers.length) lines.push({ who: '🔊', text: `${radio.talkers.join(', ')} HABLANDO`, color: '#fbbf24' });
    const ch = c ? c.chat() : null;
    if (ch && ch.available) {
      ch.messages.slice(-(3 - lines.length)).forEach((m) => {
        const mine = m.from === 'ASTRONAUTA';
        lines.push({ who: mine ? 'TÚ:' : 'TIERRA:', text: m.text, color: mine ? '#22d3ee' : '#fbbf24' });
      });
      if (!lines.length) lines.push({ who: '', text: 'Sin mensajes de tierra.', color: '#64748b' });
    } else if (!lines.length) {
      lines.push({ who: '', text: 'Sin servidor: radio y chat no disponibles.', color: '#64748b' });
    }
    lines.forEach((l, i) => {
      const y = y0 + i * 34;
      g.fillStyle = l.color;
      g.font = 'bold 24px "Share Tech Mono", monospace';
      const ww = l.who ? g.measureText(l.who).width + 12 : 0;
      g.fillText(l.who, 40, y + 14);
      g.fillStyle = '#cbd5e1';
      g.font = '24px "Share Tech Mono", monospace';
      g.fillText(fit(l.text, CW - 80 - ww), 40 + ww, y + 14);
    });
    tex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ acciones
  function activate(i, down = true) {
    const tile = TILES[i];
    if (!tile) return;
    const s = tileState(tile.id);
    if (s.disabled) return;
    const c = comms();
    st.flash[tile.id] = performance.now();
    st.redrawIn = 0;
    if (tile.id === 'radio') {
      const r = c.radio();
      if (r.state === 'ready') c.setTalking(down);
      else if (down && (r.state === 'off' || r.state === 'error')) c.enableRadio();
      return;
    }
    if (!down) return;
    if (tile.id === 'chat') c.setChatOpen(!c.chat().open);
    else if (tile.id === 'voice') c.toggleVoice();
    else if (tile.id === 'sound') toggleSound();
    else if (tile.id === 'music') c.toggleMusic();
    else if (tile.id === 'close') setOpen(false);
  }

  function setOpen(open) {
    if (st.open === open) return;
    st.open = open;
    if (!open) {
      releaseInput();
      if (onClose) onClose();
    }
  }

  function releaseInput() {
    if (st.pressed !== null) activate(st.pressed, false);
    if (st.radioKey) activate(0, false);
    st.pressed = null;
    st.radioKey = false;
    st.hover = null;
  }

  // Rayo de la cámara a la pantalla de la tableta -> índice del botón (o null)
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function tileAt(x, y) {
    if (!st.open || st.raise < 0.8) return null;
    ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, viewCamera);
    const hit = ray.intersectObject(screen, false)[0];
    if (!hit || !hit.uv) return hit ? -1 : null;
    const px = hit.uv.x * CW;
    const py = (1 - hit.uv.y) * CH;
    for (let i = 0; i < TILES.length; i++) {
      const r = tileRect(i);
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i;
    }
    return -1; // sobre la tableta, pero no en un botón
  }

  const _e = new THREE.Euler();
  return {
    scene,
    camera: viewCamera,
    get open() {
      return st.open;
    },
    get visible() {
      return st.visible;
    },
    setVisible(v) {
      st.visible = v;
      if (!v) setOpen(false);
    },
    setOpen,
    toggle() {
      setOpen(!st.open);
    },
    // Teclas 1–6 con el panel arriba. Devuelve true si la tecla se usó.
    key(code, down) {
      const i = TILES.findIndex((t) => `Digit${t.key}` === code || `Numpad${t.key}` === code);
      if (i < 0) return false;
      if (i === 0 && !down && st.radioKey) {
        st.radioKey = false;
        activate(i, false);
        return true;
      }
      if (!st.open) return false;
      if (i === 0 && down) st.radioKey = true;
      if (TILES[i].id === 'radio' || down) activate(i, down);
      return true;
    },
    pointerDown(x, y) {
      const i = tileAt(x, y);
      if (i === null) return false;
      if (i >= 0) {
        st.pressed = i;
        activate(i, true);
      }
      return true;
    },
    pointerUp() {
      if (st.pressed !== null) activate(st.pressed, false);
      st.pressed = null;
    },
    releaseInput,
    hover(x, y) {
      const i = x === null ? null : tileAt(x, y);
      const h = i !== null && i >= 0 ? i : null;
      if (h !== st.hover) {
        st.hover = h;
        st.redrawIn = 0;
      }
      return i !== null;
    },
    /**
     * camera: cámara de la nave · speed: m/s del astronauta · game: GameState
     */
    update(dt, camera, speed, game) {
      // Subir/bajar el panel con un movimiento suave (como levantar los brazos con el traje)
      const target = st.open ? 1 : 0;
      st.raise += (target - st.raise) * Math.min(1, dt * 7);
      const k = st.raise * st.raise * (3 - 2 * st.raise);
      // Balanceo al caminar: más fuerte con el panel abajo
      st.bob += dt * (2.2 + speed * 2.6);
      const amp = Math.min(1, speed / 2) * (1 - 0.65 * k);
      const bx = Math.sin(st.bob) * 0.012 * amp;
      const by = -Math.abs(Math.cos(st.bob)) * 0.014 * amp + Math.sin(performance.now() / 1400) * 0.002;

      holder.position.copy(camera.position);
      holder.quaternion.copy(camera.quaternion);
      viewCamera.position.copy(camera.position);
      viewCamera.quaternion.copy(camera.quaternion);
      const aspect = window.innerWidth / window.innerHeight;
      if (viewCamera.aspect !== aspect) {
        viewCamera.aspect = aspect;
        viewCamera.updateProjectionMatrix();
      }
      viewCamera.updateMatrixWorld(true);
      // Abajo: tableta inclinada al pecho, solo asoman el borde y las manos. Arriba: frente al visor.
      pad.position.set(bx, THREE.MathUtils.lerp(-0.20, -0.035, k) + by, THREE.MathUtils.lerp(-0.44, -0.36, k));
      _e.set(THREE.MathUtils.lerp(-1.05, -0.12, k), THREE.MathUtils.lerp(0, 0, k), Math.sin(st.bob * 0.5) * 0.03 * amp);
      pad.quaternion.setFromEuler(_e);
      pad.scale.setScalar(THREE.MathUtils.lerp(0.95, 1, k) * Math.min(1, aspect / 0.85));
      scene.updateMatrixWorld(true);
      hands.forEach((h, i) => {
        h.thumb.rotation.x = st.pressed !== null && i === 1 ? 0.25 : 0;
      });

      st.redrawIn -= dt;
      if (st.visible && st.redrawIn <= 0) {
        draw(game);
        st.redrawIn = st.open ? 0.12 : 0.5;
      }
    }
  };
}
