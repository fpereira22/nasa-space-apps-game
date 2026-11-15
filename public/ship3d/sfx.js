/**
 * Efectos de sonido del modo 3D, generados por código con Web Audio (sin archivos):
 *  - Ambiente: zumbido eléctrico + ventilación (ruido café filtrado)
 *  - Alarma de dos tonos en cada sala con el módulo en falla (posicional; se apaga al repararlo)
 *  - Núcleo del reactor, bobina del escudo y ventiladores de los racks (posicionales)
 *  - Pasos metálicos sincronizados con la caminata
 *  - Respiración dentro del casco (solo en primera persona; se acelera con peligro)
 *  - Puertas neumáticas, corte de cable, botón, teclas, Simón y "strike"
 *
 * Usa el mismo AudioContext que el tablero (AudioEngine.ctx), con su propio bus de salida.
 * El oyente (ctx.listener) se ubica con Ship3D.audioListener(), igual que voice.js.
 * Tecla M = silenciar / activar.
 */

const MASTER = 0.85;

export function createSfx({ getListener, stationRooms }) {
  let ctx = null;
  let bus = null;
  let enabled = true;
  let active = false;
  let built = false;
  const alarms = {}; // key -> GainNode
  let breath = { next: 0, gain: null, filter: null };
  let noiseBuf = null;
  let brownBuf = null;

  try {
    enabled = localStorage.getItem('aether.sfx') !== 'off';
  } catch (e) {}

  // ---------------------------------------------------------------- utilidades
  function getCtx() {
    if (ctx) return ctx;
    if (typeof AudioEngine === 'undefined') return null;
    AudioEngine.init();
    ctx = AudioEngine.ctx;
    return ctx;
  }

  function makeNoise(seconds, brown) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  function loopNoise(buffer) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start();
    return src;
  }

  function panner(x, y, z, ref = 2.5, rolloff = 1.3) {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = 60;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else p.setPosition(x, y, z);
    p.connect(bus);
    return p;
  }

  // ---------------------------------------------------------------- construcción
  function build() {
    if (built || !getCtx()) return;
    built = true;
    bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(ctx.destination);
    noiseBuf = makeNoise(2, false);
    brownBuf = makeNoise(4, true);

    // Ambiente: ventilación
    const air = loopNoise(brownBuf);
    const airF = ctx.createBiquadFilter();
    airF.type = 'lowpass';
    airF.frequency.value = 420;
    const airG = ctx.createGain();
    airG.gain.value = 0.11;
    air.connect(airF).connect(airG).connect(bus);
    // Ambiente: zumbido eléctrico de 50/100 Hz
    [[50, 'sawtooth', 0.018], [100, 'sine', 0.014]].forEach(([f, type, g]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 180;
      const gain = ctx.createGain();
      gain.gain.value = g;
      o.connect(lp).connect(gain).connect(bus);
      o.start();
    });

    // Alarma de cada sala: dos tonos alternados (LFO cuadrado sobre la frecuencia)
    stationRooms.forEach((r) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 600;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 1.4;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 110;
      lfo.connect(lfoGain).connect(osc.frequency);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1500;
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(lp).connect(g).connect(panner(r.station.x, 2.8, r.station.z, 2.2, 1.6));
      osc.start();
      lfo.start();
      alarms[r.key] = g;
    });

    // Núcleo del reactor: zumbido grave con trémolo
    {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 82;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 320;
      const trem = ctx.createGain();
      trem.gain.value = 0.11;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 3;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.05;
      lfo.connect(lfoG).connect(trem.gain);
      o.connect(lp).connect(trem).connect(panner(16, 1.5, -4.2, 1.8, 1.5));
      o.start();
      lfo.start();
    }
    // Bobina del escudo: silbido con vibrato
    {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 330;
      const vib = ctx.createOscillator();
      vib.frequency.value = 5;
      const vibG = ctx.createGain();
      vibG.gain.value = 8;
      vib.connect(vibG).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.value = 0.025;
      o.connect(g).connect(panner(-3.2, 2.55, 15.5, 1.5, 1.6));
      o.start();
      vib.start();
    }
    // Ventiladores de los racks de comunicaciones
    {
      const n = loopNoise(noiseBuf);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400;
      bp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      n.connect(bp).connect(g).connect(panner(-21, 1.2, 0, 1.5, 1.6));
    }
    // Respiración (se programa en update)
    {
      const n = loopNoise(noiseBuf);
      breath.filter = ctx.createBiquadFilter();
      breath.filter.type = 'bandpass';
      breath.filter.frequency.value = 900;
      breath.filter.Q.value = 0.7;
      breath.gain = ctx.createGain();
      breath.gain.gain.value = 0;
      n.connect(breath.filter).connect(breath.gain).connect(bus);
    }
  }

  // ---------------------------------------------------------------- sonidos cortos
  function burst({ freq = 2000, q = 1, type = 'bandpass', dur = 0.06, gain = 0.15, at = 0, sweepTo = null, pos = null }) {
    if (!active || !enabled || !built) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(pos ? panner(pos.x, pos.y, pos.z, 2, 1.2) : bus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  function tone({ freq = 440, to = null, type = 'sine', dur = 0.1, gain = 0.1, at = 0 }) {
    if (!active || !enabled || !built) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  const SFX = {
    step(firstPerson) {
      const k = firstPerson ? 1.25 : 1;
      burst({ freq: 2600 + Math.random() * 600, q: 1.4, dur: 0.05, gain: 0.07 * k });
      tone({ freq: 120 + Math.random() * 20, to: 55, dur: 0.11, gain: 0.12 * k });
    },
    door(open, x, z) {
      const pos = { x, y: 1.4, z };
      burst({ freq: open ? 380 : 1500, sweepTo: open ? 1700 : 380, q: 0.9, dur: 0.75, gain: 0.22, pos });
      burst({ freq: 5200, q: 0.6, type: 'highpass', dur: 0.35, gain: 0.05, at: 0.62, pos });
    },
    cut() {
      burst({ freq: 4200, type: 'highpass', q: 0.7, dur: 0.05, gain: 0.25 });
      for (let i = 0; i < 6; i++) burst({ freq: 3000 + Math.random() * 3000, q: 4, dur: 0.02, gain: 0.08, at: 0.04 + i * 0.03 * Math.random() });
    },
    buttonDown() {
      tone({ freq: 95, to: 60, dur: 0.14, gain: 0.25, type: 'triangle' });
      burst({ freq: 1800, q: 2, dur: 0.03, gain: 0.06 });
    },
    buttonUp() {
      burst({ freq: 2400, q: 2, dur: 0.03, gain: 0.06 });
      tone({ freq: 140, to: 90, dur: 0.08, gain: 0.12, type: 'triangle' });
    },
    key() {
      burst({ freq: 3200, q: 3, dur: 0.025, gain: 0.08 });
      tone({ freq: 220, to: 150, dur: 0.06, gain: 0.08, type: 'triangle' });
    },
    hover() {
      tone({ freq: 1800, dur: 0.025, gain: 0.015 });
    },
    // El aviso de voz ya anuncia el strike: aquí solo un zumbido corto y bajo
    strike() {
      tone({ freq: 70, dur: 0.28, gain: 0.08, type: 'sawtooth' });
      burst({ freq: 300, q: 0.5, type: 'lowpass', dur: 0.3, gain: 0.08 });
    }
  };

  // ---------------------------------------------------------------- oyente y estado
  function updateListener() {
    const L = getListener();
    if (!L) return;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = L.x;
      l.positionY.value = L.y;
      l.positionZ.value = L.z;
      l.forwardX.value = L.fx;
      l.forwardY.value = L.fy;
      l.forwardZ.value = L.fz;
      l.upX.value = L.ux;
      l.upY.value = L.uy;
      l.upZ.value = L.uz;
    } else {
      l.setPosition(L.x, L.y, L.z);
      l.setOrientation(L.fx, L.fy, L.fz, L.ux, L.uy, L.uz);
    }
  }

  function applyMaster() {
    if (!built) return;
    const target = active && enabled ? MASTER : 0;
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setTargetAtTime(target, ctx.currentTime, 0.25);
  }

  function updateBreath(firstPerson, danger) {
    const now = ctx.currentTime;
    if (!firstPerson || !enabled) {
      breath.gain.gain.setTargetAtTime(0, now, 0.2);
      breath.next = now + 0.5;
      return;
    }
    if (now < breath.next - 0.05) return;
    const cycle = danger ? 2.6 : 4.4; // segundos por respiración
    const t = Math.max(now, breath.next);
    const g = breath.gain.gain;
    const f = breath.filter.frequency;
    const inhale = cycle * 0.35;
    const exhale = cycle * 0.45;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(danger ? 0.07 : 0.045, t + inhale * 0.6);
    g.linearRampToValueAtTime(0.004, t + inhale);
    g.linearRampToValueAtTime(danger ? 0.08 : 0.055, t + inhale + exhale * 0.3);
    g.linearRampToValueAtTime(0.0001, t + inhale + exhale);
    f.setValueAtTime(1300, t);
    f.linearRampToValueAtTime(700, t + inhale + exhale);
    breath.next = t + cycle;
  }

  return {
    ...SFX,
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = on;
      try {
        localStorage.setItem('aether.sfx', on ? 'on' : 'off');
      } catch (e) {}
      applyMaster();
    },
    // Llamar al entrar/salir del modo 3D (requiere un gesto del usuario para iniciar el audio)
    setActive(on) {
      active = on;
      if (on) build();
      if (built && ctx.state === 'suspended') ctx.resume();
      applyMaster();
    },
    update(state) {
      if (!active || !built) return;
      updateListener();
      const gs = state.game;
      stationRooms.forEach((r) => {
        const on = gs && !gs.isOver && !gs.solved[r.key];
        alarms[r.key].gain.setTargetAtTime(on ? 0.05 : 0, ctx.currentTime, 0.3);
      });
      updateBreath(state.firstPerson, gs && !gs.isOver && (gs.timeLeft <= 30 || gs.strikes >= 2));
    }
  };
}
