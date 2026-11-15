/**
 * VOZ DE LA NAVE — avisos hablados de la computadora de la U.S.S. Aether.
 *
 * Los audios están pregrabados en public/voice/*.mp3 (los genera tools/generate_voice.py)
 * y los textos en public/voice/lines.json (se muestran como subtítulos).
 *
 * Uso (desde tablero.html):
 *   AetherVoice.init(() => audioContext);
 *   AetherVoice.say(['good1', 'mod_wires', 'left3'], { source: 'wires', priority: 2 });
 *   AetherVoice.stopAll();
 *
 * Prioridades: un aviso con prioridad MAYOR corta al que está sonando; uno con prioridad
 * igual o menor espera en la cola (y se descarta si espera más de maxAge segundos).
 *
 * ---------------------------------------------------------------------------------------
 * Acústica
 *  - 2D: la voz sale por el intercomunicador de la cabina (ecualización de altavoz + una
 *    reverberación corta de cabina).
 *  - 3D: la voz sale de un punto de la nave (la consola del módulo, o el altavoz del techo de
 *    la sala donde estás) y se oye según dónde estés tú, todo calculado por código:
 *      1. Sonido directo con HRTF (izquierda/derecha/arriba) y atenuación por distancia.
 *      2. Reflexiones tempranas por el método de las fuentes imagen: la fuente se refleja en
 *         las 4 paredes, el piso y el techo de SU sala; cada reflejo llega con el retardo y la
 *         dirección que corresponden a tu posición.
 *      3. Reverberación tardía: una respuesta al impulso generada por código para cada tipo de
 *         espacio (puente, sala, pasillo) con su RT60 calculado con la fórmula de Sabine a
 *         partir de las medidas reales del plano de ship3d.js, más el eco "flutter" entre las
 *         paredes paralelas más cercanas. Al caminar se hace un fundido a la reverb del espacio
 *         en el que estás.
 *      4. Oclusión: si la fuente está en otra sala, el sonido directo se oye apagado (filtro
 *         pasa bajos) y relativamente más reverberado, como a través de las paredes.
 */
(function () {
  const BASE = 'voice/';
  const SOUND_SPEED = 343; // m/s
  const ABSORPTION = 0.12; // paneles metálicos: absorben poco -> la nave "suena"
  const WALL_REFLECT = 0.72; // amplitud de cada reflejo temprano
  // Medidas (ancho, largo, alto en m) de cada tipo de espacio, igual que en ship3d.js
  const SPACES = {
    cabin: { w: 4, d: 3, h: 2.4 }, // cabina del modo 2D
    hub: { w: 12, d: 12, h: 3.2 },
    room: { w: 12, d: 10, h: 3.2 },
    corridor: { w: 3, d: 6, h: 3.2 }
  };

  const V = {
    getCtx: null,
    ctx: null,
    enabled: true,
    ready: false,
    fallback: false, // sin Web Audio / abierto como archivo: <audio> simple
    buffers: {},
    texts: {},
    queue: [],
    current: null, // { item, index, clip }
    master: null,
    reverbIn: null,
    reverbGains: {},
    rafId: null,
    captionTimer: null
  };

  // ------------------------------------------------------------------ utilidades
  const now = () => performance.now() / 1000;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

  function setParam(param, value, ctx, smooth) {
    if (!param) return;
    const t = ctx.currentTime;
    if (smooth) param.setTargetAtTime(value, t, smooth);
    else {
      param.cancelScheduledValues(t);
      param.setValueAtTime(value, t);
    }
  }

  function placePanner(p, pos, ctx) {
    if (p.positionX) {
      p.positionX.setValueAtTime(pos.x, ctx.currentTime);
      p.positionY.setValueAtTime(pos.y, ctx.currentTime);
      p.positionZ.setValueAtTime(pos.z, ctx.currentTime);
    } else p.setPosition(pos.x, pos.y, pos.z);
  }

  function placeListener(L, ctx) {
    const l = ctx.listener;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setTargetAtTime(L.x, t, 0.02);
      l.positionY.setTargetAtTime(L.y, t, 0.02);
      l.positionZ.setTargetAtTime(L.z, t, 0.02);
      l.forwardX.setTargetAtTime(L.fx, t, 0.02);
      l.forwardY.setTargetAtTime(L.fy, t, 0.02);
      l.forwardZ.setTargetAtTime(L.fz, t, 0.02);
      l.upX.setTargetAtTime(L.ux, t, 0.02);
      l.upY.setTargetAtTime(L.uy, t, 0.02);
      l.upZ.setTargetAtTime(L.uz, t, 0.02);
    } else {
      l.setPosition(L.x, L.y, L.z);
      l.setOrientation(L.fx, L.fy, L.fz, L.ux, L.uy, L.uz);
    }
  }

  function ship() {
    const s = window.Ship3D;
    return s && s.available && s.running && s.audioListener ? s : null;
  }

  // ------------------------------------------------------------------ reverberación por código
  /**
   * Respuesta al impulso de un espacio rectangular de metal:
   *   RT60 (Sabine) = 0.161·V / (S·α)          V = volumen, S = superficie, α = absorción
   *   pre-retardo   = recorrido libre medio / c = (4V/S) / 343
   * Cola de ruido estéreo (canales descorrelacionados) que decae a -60 dB en RT60; los agudos
   * decaen más rápido (el aire y las juntas los absorben). Encima, el eco "flutter" entre las dos
   * paredes paralelas más cercanas (período = 2·distancia / c).
   */
  function buildImpulse(ctx, { w, d, h }) {
    const V3 = w * d * h;
    const S = 2 * (w * d + w * h + d * h);
    const rt60 = (0.161 * V3) / (S * ABSORPTION);
    const preDelay = (4 * V3) / S / SOUND_SPEED;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * (preDelay + rt60 * 1.1));
    const buf = ctx.createBuffer(2, len, rate);
    const k = 6.91 / rt60; // ln(1000): -60 dB
    const flutterPeriod = (2 * Math.min(w, d)) / SOUND_SPEED;
    const flutterEvery = Math.round(flutterPeriod * rate);
    const pre = Math.floor(preDelay * rate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / rate;
        const n = Math.random() * 2 - 1;
        lp += 0.12 * (n - lp); // banda baja (~1 kHz)
        const low = lp * Math.exp(-k * t);
        const high = (n - lp) * 0.55 * Math.exp((-k * t) / 0.5);
        const fadeIn = Math.min(1, t / 0.004);
        data[i] = (low * 1.8 + high) * fadeIn;
      }
      // Flutter: pulsos que rebotan entre las paredes paralelas, cada vez más débiles
      for (let j = 1, i = pre + flutterEvery; i < len && j < 40; j++, i += flutterEvery) {
        const amp = 0.9 * Math.pow(WALL_REFLECT, j) * (ch ? 0.85 : 1);
        for (let s = 0; s < 24 && i + s < len; s++) data[i + s] += amp * (1 - s / 24) * (Math.random() * 0.4 + 0.8);
      }
    }
    return buf;
  }

  function buildGraph() {
    const ctx = V.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);
    V.master = ctx.createGain();
    V.master.gain.value = 0.95;
    V.master.connect(comp);

    // Bus de reverberación: una reverb por tipo de espacio, con fundido entre ellas
    V.reverbIn = ctx.createGain();
    Object.entries(SPACES).forEach(([kind, dims]) => {
      const conv = ctx.createConvolver();
      conv.buffer = buildImpulse(ctx, dims);
      const g = ctx.createGain();
      g.gain.value = kind === 'cabin' ? 1 : 0;
      V.reverbIn.connect(conv).connect(g).connect(V.master);
      V.reverbGains[kind] = g;
    });
  }

  // ------------------------------------------------------------------ carga de audios
  function trimSilence(ctx, buf) {
    // edge-tts / ElevenLabs dejan silencio al inicio y al final: se recorta para que los avisos
    // (sobre todo la cuenta regresiva) suenen justo a tiempo
    const d = buf.getChannelData(0);
    const thr = 0.008;
    let a = 0;
    let b = d.length - 1;
    while (a < b && Math.abs(d[a]) < thr) a++;
    while (b > a && Math.abs(d[b]) < thr) b--;
    a = Math.max(0, a - Math.floor(0.02 * buf.sampleRate));
    b = Math.min(d.length - 1, b + Math.floor(0.06 * buf.sampleRate));
    const out = ctx.createBuffer(buf.numberOfChannels, b - a + 1, buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, b + 1), c);
    return out;
  }

  async function loadAll() {
    try {
      V.texts = await (await fetch(BASE + 'lines.json')).json();
    } catch (e) {
      V.fallback = true; // abierto como archivo: fetch no funciona
      return;
    }
    await Promise.all(
      Object.keys(V.texts).map(async (id) => {
        try {
          const data = await (await fetch(`${BASE}${id}.mp3`)).arrayBuffer();
          const buf = await V.ctx.decodeAudioData(data);
          V.buffers[id] = trimSilence(V.ctx, buf);
        } catch (e) {
          console.warn('[voz] no se pudo cargar', id, e);
        }
      })
    );
    V.ready = true;
    pump();
  }

  // ------------------------------------------------------------------ subtítulos
  function caption(text) {
    const el = document.getElementById('voiceCaption');
    if (!el) return;
    clearTimeout(V.captionTimer);
    if (text) {
      el.querySelector('[data-text]').textContent = text;
      el.classList.remove('hidden');
    } else {
      V.captionTimer = setTimeout(() => el.classList.add('hidden'), 700);
    }
  }

  // ------------------------------------------------------------------ reproducción de un clip
  function playClip(id, sourceKey) {
    const ctx = V.ctx;
    const buffer = V.buffers[id];
    if (!buffer) return null;
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    // Altavoz de la nave: sin graves profundos y con un poco de presencia
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 170;
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 3000;
    presence.Q.value = 0.9;
    presence.gain.value = 3;
    src.connect(hp).connect(presence);

    const clip = { src, nodes: [src, hp, presence], spatial: null };
    const s = ship();

    if (!s) {
      // 2D: intercomunicador de la cabina
      const dry = ctx.createGain();
      dry.gain.value = 0.9;
      const wet = ctx.createGain();
      wet.gain.value = 0.16;
      presence.connect(dry).connect(V.master);
      presence.connect(wet).connect(V.reverbIn);
      clip.nodes.push(dry, wet);
      setReverbSpace('cabin', 0);
    } else {
      // 3D: sonido posicionado en la nave
      const L = s.audioListener();
      const S = s.audioSource(sourceKey);
      placeListener(L, ctx);

      // 1) Directo
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = sourceKey === 'intercom' ? 2.5 : 1.6;
      panner.rolloffFactor = 1.1;
      panner.maxDistance = 60;
      placePanner(panner, S, ctx);
      const occl = ctx.createBiquadFilter();
      occl.type = 'lowpass';
      occl.frequency.value = 20000;
      const dry = ctx.createGain();
      presence.connect(panner).connect(occl).connect(dry).connect(V.master);

      // 2) Reflexiones tempranas (fuentes imagen de 1er orden en la sala de la fuente)
      const a = S.area;
      const images = [
        { x: 2 * a.x0 - S.x, y: S.y, z: S.z },
        { x: 2 * a.x1 - S.x, y: S.y, z: S.z },
        { x: S.x, y: S.y, z: 2 * a.z0 - S.z },
        { x: S.x, y: S.y, z: 2 * a.z1 - S.z },
        { x: S.x, y: 2 * a.y0 - S.y, z: S.z }, // piso
        { x: S.x, y: 2 * a.y1 - S.y, z: S.z } // techo
      ];
      const erBus = ctx.createGain(); // se apaga si estás en otra sala (no te llegan esos rebotes)
      erBus.connect(V.master);
      const direct = dist(S, L);
      images.forEach((img) => {
        const delay = ctx.createDelay(0.2);
        delay.delayTime.value = clamp((dist(img, L) - direct) / SOUND_SPEED, 0, 0.19);
        const g = ctx.createGain();
        g.gain.value = WALL_REFLECT;
        const p = ctx.createPanner();
        p.panningModel = 'equalpower';
        p.distanceModel = 'inverse';
        p.refDistance = panner.refDistance;
        p.rolloffFactor = 1.1;
        placePanner(p, img, ctx);
        presence.connect(delay).connect(g).connect(p).connect(erBus);
        clip.nodes.push(delay, g, p);
      });

      // 3) Envío a la reverberación tardía (no se atenúa tanto con la distancia: lo lejano suena más "lejos")
      const wet = ctx.createGain();
      presence.connect(wet).connect(V.reverbIn);

      clip.nodes.push(panner, occl, dry, erBus, wet);
      clip.spatial = { S, panner, occl, dry, erBus, wet };
      updateSpatial(clip, L, true);
    }

    src.start();
    return clip;
  }

  // Ajustes que dependen de dónde estás ahora (se llama en cada cuadro mientras suena la voz)
  function updateSpatial(clip, L, instant) {
    const ctx = V.ctx;
    const sp = clip.spatial;
    const smooth = instant ? 0 : 0.08;
    const sameArea = sp.S.area.key === L.area.key;
    const d = dist(sp.S, L);
    setParam(sp.occl.frequency, sameArea ? 20000 : 750, ctx, smooth);
    setParam(sp.dry.gain, sameArea ? 1 : 0.55, ctx, smooth);
    setParam(sp.erBus.gain, sameArea ? 0.55 : 0, ctx, smooth);
    setParam(sp.wet.gain, (sameArea ? 0.16 : 0.32) + 0.22 * clamp(d / 15, 0, 1), ctx, smooth);
    setReverbSpace(L.area.kind, instant ? 0 : 0.25);
  }

  function setReverbSpace(kind, smooth) {
    Object.entries(V.reverbGains).forEach(([k, g]) => setParam(g.gain, k === kind ? 1 : 0, V.ctx, smooth || 0));
  }

  function loop() {
    V.rafId = null;
    const s = ship();
    if (!s || !V.current || !V.current.clip || !V.current.clip.spatial) return;
    const L = s.audioListener();
    placeListener(L, V.ctx);
    updateSpatial(V.current.clip, L, false);
    V.rafId = requestAnimationFrame(loop);
  }

  function stopClip(clip) {
    if (!clip) return;
    clip.src.onended = null;
    try {
      clip.src.stop();
    } catch (e) {}
    setTimeout(() => clip.nodes.forEach((n) => n.disconnect()), 50);
  }

  // ------------------------------------------------------------------ cola de avisos
  function pump() {
    if (V.current || !V.enabled) return;
    if (!V.fallback && (!V.ready || !V.ctx || V.ctx.state !== 'running')) return;
    while (V.queue.length) {
      const item = V.queue.shift();
      if (now() - item.t > item.maxAge) continue; // ya no tiene sentido decirlo
      start(item, 0);
      return;
    }
  }

  function start(item, index) {
    const id = item.ids[index];
    if (id === undefined) {
      V.current = null;
      caption(null);
      pump();
      return;
    }
    V.current = { item, index, clip: null };
    caption(V.texts[id] || '');

    if (V.fallback) {
      const audio = new Audio(`${BASE}${id}.mp3`);
      V.current.clip = { src: { stop: () => audio.pause() }, nodes: [], audio };
      audio.onended = () => next(item, index);
      audio.play().catch(() => next(item, index));
      return;
    }
    const clip = playClip(id, item.source);
    if (!clip) return next(item, index);
    V.current.clip = clip;
    clip.src.onended = () => {
      setTimeout(() => clip.nodes.forEach((n) => n.disconnect()), 2500); // deja sonar la cola de reverb
      next(item, index);
    };
    if (clip.spatial && !V.rafId) V.rafId = requestAnimationFrame(loop);
  }

  function next(item, index) {
    if (!V.current || V.current.item !== item) return;
    setTimeout(() => {
      if (V.current && V.current.item === item) start(item, index + 1);
    }, item.gap);
  }

  function interruptCurrent() {
    if (!V.current) return;
    const c = V.current;
    V.current = null;
    if (c.clip && c.clip.audio) c.clip.audio.pause();
    else stopClip(c.clip);
    caption(null);
  }

  // ------------------------------------------------------------------ API pública
  const AetherVoice = {
    init(getCtx) {
      V.getCtx = getCtx;
      try {
        V.enabled = localStorage.getItem('aether.voice') !== 'off';
      } catch (e) {}
      try {
        V.ctx = getCtx();
        buildGraph();
        V.ctx.addEventListener('statechange', pump);
      } catch (e) {
        V.fallback = true;
      }
      if (!V.fallback) loadAll();
      // El navegador no deja sonar audio hasta que el usuario interactúa: al primer clic o tecla
      // se reanuda y se dicen los avisos pendientes que sigan vigentes
      const unlock = () => {
        try {
          V.getCtx();
        } catch (e) {}
        if (V.ctx && V.ctx.state !== 'running') V.ctx.resume().then(pump, () => {});
        else pump();
      };
      ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, unlock, { capture: true }));
      this.renderToggle();
    },

    /**
     * ids:     id o lista de ids (se dicen seguidos)
     * source:  'intercom' (altavoz del techo) o clave de un módulo: 'wires' | 'button' | 'simon' | 'keypad'
     * priority: mayor corta al que está sonando
     * maxAge:  segundos que puede esperar en la cola antes de descartarse
     */
    say(ids, { source = 'intercom', priority = 1, maxAge = 6, gap = 0.12 } = {}) {
      if (!V.enabled) return;
      const item = { ids: [].concat(ids), source, priority, maxAge, gap: gap * 1000, t: now() };
      if (V.current && priority > V.current.item.priority) interruptCurrent();
      // La cola se ordena por prioridad (estable: a igual prioridad, el más antiguo primero)
      const pos = V.queue.findIndex((q) => q.priority < priority);
      if (pos === -1) V.queue.push(item);
      else V.queue.splice(pos, 0, item);
      pump();
    },

    stopAll() {
      V.queue.length = 0;
      interruptCurrent();
    },

    get enabled() {
      return V.enabled;
    },

    setEnabled(on) {
      V.enabled = Boolean(on);
      try {
        localStorage.setItem('aether.voice', V.enabled ? 'on' : 'off');
      } catch (e) {}
      if (!V.enabled) this.stopAll();
      this.renderToggle();
    },

    renderToggle() {
      const btn = document.getElementById('voiceToggle');
      if (!btn) return;
      btn.querySelector('[data-icon]').textContent = V.enabled ? '🔊' : '🔇';
      btn.classList.toggle('opacity-60', !V.enabled);
      btn.title = V.enabled ? 'Voz de la nave: activada (clic para silenciar)' : 'Voz de la nave: silenciada (clic para activar)';
    }
  };

  window.AetherVoice = AetherVoice;
})();
