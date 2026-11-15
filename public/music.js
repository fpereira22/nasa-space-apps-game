/**
 * ============================================================================
 * BANDA SONORA ADAPTATIVA — U.S.S. AETHER
 * ----------------------------------------------------------------------------
 * Música orquestal/electrónica generada por código con Web Audio (sin archivos).
 * Usa el mismo AudioContext que el tablero (AudioEngine.ctx).
 *
 * Temas (cambian con fundido cruzado):
 *   menu      Re menor, lento y amplio: pads, arpegio con eco, campanas, viento espacial
 *   game      La menor, pulso tipo "ostinato" que crece con la tensión (tiempo + strikes)
 *   final     Últimos 10 s: ostinato que sube de semitono, tambores, "braams", riser
 *   suspense  Silencio tenso: latido, dron grave y zumbido de oídos
 *   defeat    Piano triste sobre cuerdas, tras la explosión
 *   victory   Re mayor, fanfarria y timbales
 *
 * API: AetherMusic.init(getCtx) · play(nombre) · stop() · setIntensity(0..1)
 *      sfx.* (efectos de cinemática) · setVolume('music'|'sfx', 0..1)
 * ============================================================================
 */
(function () {
  const M = {
    ctx: null,
    getCtx: null,
    built: false,
    current: null,
    themes: [], // instancias activas (la saliente sigue sonando durante el fundido)
    intensity: 0,
    volume: { music: 0.7, sfx: 0.85 },
    noise: null,
    timer: null
  };

  try {
    const v = JSON.parse(localStorage.getItem('aether.audio') || 'null');
    if (v && typeof v.music === 'number') M.volume.music = v.music;
    if (v && typeof v.sfx === 'number') M.volume.sfx = v.sfx;
  } catch (e) {}

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const rand = (a, b) => a + Math.random() * (b - a);

  // ------------------------------------------------------------------ grafo
  function ctx() {
    if (M.ctx) return M.ctx;
    if (!M.getCtx) return null;
    try {
      M.ctx = M.getCtx();
    } catch (e) {
      return null;
    }
    if (M.ctx && !M.built) build();
    return M.ctx;
  }

  function impulse(c, seconds, decay, dark) {
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Filtro paso bajo que se cierra con el tiempo: cola más oscura, como una sala real
        const k = 1 - Math.min(0.97, dark * t);
        lp += ((Math.random() * 2 - 1) - lp) * k;
        d[i] = lp * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  function build() {
    const c = M.ctx;
    M.built = true;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.006;
    comp.release.value = 0.3;
    comp.connect(c.destination);

    M.master = c.createGain();
    M.master.gain.value = 1;
    M.master.connect(comp);

    M.musicBus = c.createGain();
    M.musicBus.gain.value = M.volume.music * 0.5;
    M.musicBus.connect(M.master);
    M.sfxBus = c.createGain();
    M.sfxBus.gain.value = M.volume.sfx;
    M.sfxBus.connect(M.master);

    // Reverb grande para la música ("sala de concierto en el espacio")
    M.musicVerb = c.createConvolver();
    M.musicVerb.buffer = impulse(c, 5, 2.6, 1.6);
    const mv = c.createGain();
    mv.gain.value = 0.85;
    M.musicVerb.connect(mv).connect(M.musicBus);

    // Reverb de efectos (más corta)
    M.sfxVerb = c.createConvolver();
    M.sfxVerb.buffer = impulse(c, 3.2, 2.2, 1.2);
    const sv = c.createGain();
    sv.gain.value = 0.7;
    M.sfxVerb.connect(sv).connect(M.sfxBus);

    // Eco estéreo (ping-pong) para arpegios
    M.delayIn = c.createGain();
    const dl = c.createDelay(2);
    const dr = c.createDelay(2);
    dl.delayTime.value = 0.43;
    dr.delayTime.value = 0.64;
    const fb = c.createGain();
    fb.gain.value = 0.38;
    const dlf = c.createBiquadFilter();
    dlf.type = 'lowpass';
    dlf.frequency.value = 3200;
    const merger = c.createChannelMerger(2);
    M.delayIn.connect(dl);
    dl.connect(dlf).connect(dr);
    dr.connect(fb).connect(dl);
    dl.connect(merger, 0, 0);
    dr.connect(merger, 0, 1);
    const dOut = c.createGain();
    dOut.gain.value = 0.5;
    merger.connect(dOut);
    dOut.connect(M.musicBus);
    dOut.connect(M.musicVerb);

    // Ruido blanco reutilizable
    const len = c.sampleRate * 2;
    M.noise = c.createBuffer(1, len, c.sampleRate);
    const nd = M.noise.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;

    M.timer = setInterval(schedule, 25);
  }

  // ------------------------------------------------------------------ instrumentos
  function noiseSrc(c, t, dur, loop) {
    const s = c.createBufferSource();
    s.buffer = M.noise;
    s.loop = true;
    s.start(t, Math.random() * 1.5);
    if (!loop) s.stop(t + dur + 0.05);
    return s;
  }

  function pan(c, value) {
    const p = c.createStereoPanner ? c.createStereoPanner() : c.createGain();
    if (p.pan) p.pan.value = value;
    return p;
  }

  // Pad de cuerdas/sintetizador: 3 dientes de sierra desafinados por nota
  function pad(dest, t, notes, dur, { vol = 0.06, cutoff = 1400, attack = 1.6, release = 2.5, type = 'sawtooth', vibrato = 0 } = {}) {
    const c = M.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff * 0.5, t);
    f.frequency.linearRampToValueAtTime(cutoff, t + attack);
    f.Q.value = 0.6;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur));
    g.gain.linearRampToValueAtTime(0, t + Math.max(attack, dur) + release);
    f.connect(g);
    g.connect(dest);
    const end = t + Math.max(attack, dur) + release + 0.1;
    let lfo = null;
    if (vibrato) {
      lfo = c.createOscillator();
      lfo.frequency.value = 5.2;
      const lg = c.createGain();
      lg.gain.value = vibrato;
      lfo.connect(lg);
      lfo.start(t);
      lfo.stop(end);
      lfo._g = lg;
    }
    notes.forEach((m, i) => {
      [-9, 0, 9].forEach((cents, k) => {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = mtof(m);
        o.detune.value = cents + rand(-3, 3);
        if (lfo) lfo._g.connect(o.detune);
        const p = pan(c, ((i / Math.max(1, notes.length - 1)) - 0.5) * 0.9 + (k - 1) * 0.2);
        o.connect(p).connect(f);
        o.start(t);
        o.stop(end);
      });
    });
  }

  // Pulso de bajo (ostinato) con envolvente de filtro
  function pulse(dest, t, m, { vol = 0.12, cutoff = 600, decay = 0.16, accent = 1 } = {}) {
    const c = M.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(m);
    const o2 = c.createOscillator();
    o2.type = 'square';
    o2.frequency.value = mtof(m - 12);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(cutoff * (1 + accent), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff * 0.25), t + decay);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * (0.6 + 0.4 * accent), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay + 0.05);
    const g2 = c.createGain();
    g2.gain.value = 0.5;
    o.connect(f);
    o2.connect(g2).connect(f);
    f.connect(g).connect(dest);
    o.start(t);
    o2.start(t);
    o.stop(t + decay + 0.1);
    o2.stop(t + decay + 0.1);
  }

  // Sub-bajo largo
  function sub(dest, t, m, dur, vol = 0.14) {
    const c = M.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = mtof(m);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.4);
    g.gain.setValueAtTime(vol, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.6);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.7);
  }

  // Pulsación tipo arpa/sintetizador
  function pluck(dest, t, m, { vol = 0.05, decay = 0.9, type = 'triangle', cutoff = 3000, panV = 0, delay = true } = {}) {
    const c = M.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = mtof(m);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(400, t + decay);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
    const p = pan(c, panV);
    o.connect(f).connect(g).connect(p);
    p.connect(dest);
    if (delay) p.connect(M.delayIn);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  // Campana FM
  function bell(dest, t, m, vol = 0.04, decay = 3.5) {
    const c = M.ctx;
    const car = c.createOscillator();
    const mod = c.createOscillator();
    const mg = c.createGain();
    car.frequency.value = mtof(m);
    mod.frequency.value = mtof(m) * 3.5;
    mg.gain.setValueAtTime(mtof(m) * 2.2, t);
    mg.gain.exponentialRampToValueAtTime(1, t + decay);
    mod.connect(mg).connect(car.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0004, t + decay);
    car.connect(g);
    g.connect(dest);
    g.connect(M.delayIn);
    car.start(t);
    mod.start(t);
    car.stop(t + decay + 0.1);
    mod.stop(t + decay + 0.1);
  }

  // Piano (parciales sinusoidales con caída más rápida en los agudos + golpe de martillo)
  function piano(dest, t, m, vol = 0.07, dur = 3) {
    const c = M.ctx;
    const f0 = mtof(m);
    const partials = [[1, 1, 1], [2, 0.42, 0.7], [3, 0.2, 0.5], [4.02, 0.1, 0.35], [5.03, 0.05, 0.25]];
    const out = c.createGain();
    out.gain.value = vol;
    out.connect(dest);
    partials.forEach(([mul, amp, dk]) => {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f0 * mul;
      o.detune.value = rand(-2, 2);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.004);
      g.gain.exponentialRampToValueAtTime(amp * 0.35, t + 0.25 * dk + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0003, t + dur * dk);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.1);
    });
    const n = noiseSrc(c, t, 0.03);
    const nf = c.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = f0 * 4;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.15, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    n.connect(nf).connect(ng).connect(out);
  }

  // Charles / tic metálico
  function hat(dest, t, vol = 0.02, decay = 0.05, freq = 8000) {
    const c = M.ctx;
    const n = noiseSrc(c, t, decay);
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
    n.connect(f).connect(g).connect(dest);
  }

  // Tambor grave tipo taiko / timbal
  function drum(dest, t, vol = 0.3, f0 = 55, decay = 0.7) {
    const c = M.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0 * 2.6, t);
    o.frequency.exponentialRampToValueAtTime(f0, t + 0.09);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + decay + 0.05);
    const n = noiseSrc(c, t, 0.2);
    const nf = c.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 180;
    nf.Q.value = 0.8;
    const ng = c.createGain();
    ng.gain.setValueAtTime(vol * 0.9, t);
    ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.18);
    n.connect(nf).connect(ng).connect(dest);
  }

  // "BRAAM": metales graves con filtro que se abre
  function braam(dest, t, notes, dur = 1.6, vol = 0.09) {
    const c = M.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(180, t);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.25);
    f.frequency.exponentialRampToValueAtTime(300, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.06);
    g.gain.setValueAtTime(vol, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;
    f.connect(shaper).connect(g).connect(dest);
    notes.forEach((m) => {
      [-12, 0, 11].forEach((cents) => {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = cents;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.05);
      });
    });
  }

  // Metal con ataque suave (fanfarria)
  function brass(dest, t, notes, dur = 1.5, vol = 0.05) {
    const c = M.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 1;
    f.frequency.setValueAtTime(400, t);
    f.frequency.linearRampToValueAtTime(2600, t + 0.3);
    f.frequency.linearRampToValueAtTime(1500, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.12);
    g.gain.setValueAtTime(vol, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.6);
    f.connect(g).connect(dest);
    notes.forEach((m, i) => {
      [-6, 6].forEach((cents) => {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = cents;
        const p = pan(c, (i % 2 ? 0.3 : -0.3));
        o.connect(p).connect(f);
        o.start(t);
        o.stop(t + dur + 0.7);
      });
    });
  }

  // Ruido que sube (tensión)
  function riser(dest, t, dur, vol = 0.06) {
    const c = M.ctx;
    const n = noiseSrc(c, t, dur);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(200, t);
    f.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    n.connect(f).connect(g).connect(dest);
    // Tono que sube (glissando de cuerdas)
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(880, t + dur);
    const of = c.createBiquadFilter();
    of.type = 'lowpass';
    of.frequency.value = 2500;
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(vol * 0.5, t + dur);
    og.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    o.connect(of).connect(og).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  // Nodos continuos de un tema (viento, dron); se detienen al terminar el tema
  function persistentNoise(inst, { vol = 0.02, freq = 500, q = 1.5, lfoRate = 0.05, lfoDepth = 300 } = {}) {
    const c = M.ctx;
    const n = noiseSrc(c, c.currentTime, 0, true);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const lfo = c.createOscillator();
    lfo.frequency.value = lfoRate;
    const lg = c.createGain();
    lg.gain.value = lfoDepth;
    lfo.connect(lg).connect(f.frequency);
    lfo.start();
    const g = c.createGain();
    g.gain.value = vol;
    n.connect(f).connect(g).connect(inst.gain);
    inst.nodes.push(n, lfo);
  }

  function persistentTone(inst, freqs, vol, type = 'sine') {
    const c = M.ctx;
    freqs.forEach((fr) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = fr;
      const g = c.createGain();
      g.gain.value = vol;
      o.connect(g).connect(inst.gain);
      o.start();
      inst.nodes.push(o);
    });
  }

  // ------------------------------------------------------------------ temas
  // step() se llama en cada semicorchea (16 por compás)
  const THEMES = {
    menu: {
      bpm: 66,
      volume: 1,
      start(inst) {
        persistentNoise(inst, { vol: 0.035, freq: 420, q: 0.9, lfoRate: 0.04, lfoDepth: 260 });
      },
      step(inst, s, t, d) {
        const chords = [[50, 57, 62, 65], [46, 58, 62, 65], [53, 57, 60, 65], [48, 55, 60, 64]];
        const roots = [38, 34, 41, 36];
        const bar = Math.floor(s / 16);
        const pos = s % 16;
        const ci = Math.floor(bar / 2) % 4;
        const barDur = d * 16;
        if (pos === 0 && bar % 2 === 0) {
          pad(inst.gain, t, chords[ci], barDur * 2, { vol: 0.035, cutoff: 1500, attack: 2.2, release: 3 });
          pad(inst.verb, t, chords[ci].map((m) => m + 12), barDur * 2, { vol: 0.012, cutoff: 2600, attack: 3, release: 3, type: 'triangle' });
          sub(inst.gain, t, roots[ci], barDur * 2, 0.12);
        }
        // Arpegio desde la segunda vuelta
        if (bar >= 4 && pos % 2 === 0) {
          const ch = chords[ci];
          const pattern = [0, 1, 2, 3, 2, 3, 1, 2];
          const m = ch[pattern[(pos / 2) % 8]] + 12;
          pluck(inst.gain, t, m, { vol: 0.022 + (pos % 8 === 0 ? 0.01 : 0), decay: 1.1, panV: Math.sin(s * 0.7) * 0.6 });
        }
        // Melodía de campanas (cada 8 compases)
        const mel = { 0: 74, 12: 77, 16: 81, 40: 79, 48: 77, 64: 74, 76: 72, 80: 77, 96: 76, 104: 72, 112: 74 };
        const k = s % 128;
        if (bar >= 8 && mel[k]) bell(inst.gain, t, mel[k], 0.03, 4);
        if (pos === 0 && bar % 4 === 0) drum(inst.verb, t, 0.12, 40, 2.5); // timbal lejano
      }
    },

    game: {
      bpm: 104,
      volume: 0.9,
      step(inst, s, t, d) {
        const I = M.intensity;
        const chords = [[57, 60, 64], [53, 57, 60], [50, 53, 57, 62], [52, 56, 59, 64]];
        const roots = [45, 41, 38, 40];
        const bar = Math.floor(s / 16);
        const pos = s % 16;
        const ci = bar % 4;
        // Ostinato: da-da-DUM
        const accents = [1, 0.3, 0.55, 0.3, 0.9, 0.3, 0.55, 0.3, 1, 0.3, 0.55, 0.3, 0.9, 0.4, 0.7, 0.5];
        const play = I > 0.25 || pos % 2 === 0;
        if (play) pulse(inst.gain, t, roots[ci], { vol: 0.07 + I * 0.05, cutoff: 260 + I * 1300, decay: 0.12 + I * 0.06, accent: accents[pos] });
        if (pos === 0) {
          pad(inst.gain, t, chords[ci], d * 16, { vol: 0.016 + I * 0.012, cutoff: 900 + I * 1400, attack: 0.6, release: 0.8 });
          sub(inst.gain, t, roots[ci] - 12, d * 16, 0.07);
        }
        // Percusión
        if (pos % 2 === 0) hat(inst.gain, t, 0.006 + I * 0.012, pos % 4 === 2 ? 0.08 : 0.04);
        else if (I > 0.6) hat(inst.gain, t, 0.006, 0.03);
        if (I > 0.3 && (pos === 0 || pos === 8)) drum(inst.gain, t, 0.16 + I * 0.12, 48, 0.6);
        if (I > 0.7 && (pos === 4 || pos === 12)) drum(inst.gain, t, 0.12, 62, 0.4);
        // Cuerdas agudas en trémolo cuando sube la tensión
        if (I > 0.45 && pos === 0) {
          pad(inst.gain, t, chords[ci].slice(0, 2).map((m) => m + 24), d * 16, { vol: 0.008 + (I - 0.45) * 0.02, cutoff: 3500, attack: 0.4, release: 0.6, vibrato: 14 });
        }
        // Motivo de alerta (cada 4 compases)
        if (I > 0.15 && bar % 4 === 3 && (pos === 12 || pos === 14)) pluck(inst.gain, t, roots[ci] + 36 - (pos === 14 ? 1 : 0), { vol: 0.02, decay: 0.5, type: 'square', cutoff: 2200 });
      }
    },

    final: {
      bpm: 120,
      volume: 1,
      start(inst, t) {
        riser(inst.gain, t, 10.2, 0.05);
        persistentTone(inst, [27.5, 27.9], 0.06);
      },
      step(inst, s, t, d) {
        const pos = s % 16;
        const lift = Math.min(8, Math.floor(s / 8)); // sube un semitono cada 2 tiempos
        const base = 45 + lift;
        const pattern = [0, 0, 3, 0, 0, 7, 0, 3, 0, 0, 3, 0, 8, 7, 3, 1];
        pulse(inst.gain, t, base + pattern[pos], { vol: 0.08, cutoff: 900 + s * 12, decay: 0.1, accent: pos % 4 === 0 ? 1 : 0.4 });
        hat(inst.gain, t, pos % 2 ? 0.008 : 0.016, 0.03);
        if (pos % 4 === 0) drum(inst.gain, t, pos === 0 ? 0.32 : 0.22, 50, 0.5);
        if (pos === 0 && Math.floor(s / 16) % 2 === 0) braam(inst.gain, t, [33 + lift, 40 + lift, 45 + lift], 1.7, 0.07);
        if (pos % 4 === 0) hat(inst.gain, t, 0.03, 0.09, 2500); // tic del reloj
      }
    },

    suspense: {
      bpm: 52,
      volume: 1,
      start(inst) {
        persistentTone(inst, [36.7, 37.1, 55], 0.05);
        persistentNoise(inst, { vol: 0.03, freq: 120, q: 0.7, lfoRate: 0.1, lfoDepth: 60 });
      },
      step(inst, s, t) {
        if (s % 4 === 0) {
          drum(inst.gain, t, 0.35, 42, 0.35);
          drum(inst.gain, t + 0.2, 0.22, 40, 0.3);
        }
      }
    },

    defeat: {
      bpm: 58,
      volume: 1,
      step(inst, s, t, d) {
        const chords = [[50, 53, 57, 62], [46, 53, 58, 62], [43, 55, 58, 62], [45, 52, 57, 61]];
        const roots = [38, 34, 31, 33];
        const bar = Math.floor(s / 16);
        const pos = s % 16;
        const ci = bar % 4;
        if (pos === 0) {
          pad(inst.gain, t, chords[ci], d * 16, { vol: 0.03, cutoff: 1100, attack: 1.8, release: 2.5, vibrato: 6 });
          sub(inst.gain, t, roots[ci], d * 16, 0.08);
          piano(inst.verb, t, roots[ci] + 12, 0.05, 5);
        }
        const mel = { 0: 74, 6: 72, 8: 69, 14: 70, 16: 70, 22: 69, 24: 67, 32: 67, 38: 65, 40: 62, 48: 64, 54: 61, 56: 57 };
        const k = s % 64;
        if (bar >= 1 && mel[k]) piano(inst.gain, t, mel[k], 0.075, 4);
      }
    },

    victory: {
      bpm: 84,
      volume: 1,
      start(inst, t) {
        // Redoble de timbal de entrada
        for (let i = 0; i < 14; i++) drum(inst.gain, t + i * 0.055, 0.05 + i * 0.012, 52, 0.25);
      },
      step(inst, s, t, d) {
        const chords = [[50, 54, 57, 62], [46, 53, 58, 62], [48, 55, 60, 64], [50, 54, 57, 62, 66]];
        const roots = [38, 34, 36, 38];
        const bar = Math.floor(s / 16);
        const pos = s % 16;
        const ci = bar % 4;
        if (pos === 0) {
          brass(inst.gain, t, chords[ci], d * 14, 0.03);
          pad(inst.gain, t, chords[ci].map((m) => m + 12), d * 16, { vol: 0.016, cutoff: 3000, attack: 0.8, release: 1.5 });
          sub(inst.gain, t, roots[ci], d * 16, 0.1);
          drum(inst.gain, t, 0.25, 52, 1.2);
        }
        if (pos === 8) drum(inst.gain, t, 0.14, 52, 0.8);
        if (pos % 2 === 0) {
          const ch = chords[ci];
          pluck(inst.gain, t, ch[(pos / 2) % ch.length] + 24, { vol: 0.016, decay: 0.7, panV: pos % 4 ? 0.4 : -0.4 });
        }
        const mel = { 0: 74, 4: 78, 8: 81, 16: 79, 20: 78, 24: 76, 32: 77, 36: 81, 40: 84, 48: 86 };
        if (mel[s % 64]) bell(inst.gain, t, mel[s % 64], 0.035, 3);
      }
    }
  };

  // ------------------------------------------------------------------ secuenciador
  function startTheme(name, fadeIn) {
    const c = M.ctx;
    const def = THEMES[name];
    const now = c.currentTime;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(def.volume, now + fadeIn);
    gain.connect(M.musicBus);
    const verbSend = c.createGain();
    verbSend.gain.value = 0.55;
    gain.connect(verbSend).connect(M.musicVerb);
    // "verb": salida solo-reverb (sonidos lejanos)
    const verb = c.createGain();
    verb.gain.setValueAtTime(0.0001, now);
    verb.gain.linearRampToValueAtTime(def.volume, now + fadeIn);
    verb.connect(M.musicVerb);
    const inst = { name, def, gain, verb, step: 0, next: now + 0.06, nodes: [], stopAt: Infinity };
    if (def.start) def.start(inst, inst.next);
    M.themes.push(inst);
    return inst;
  }

  function stopTheme(inst, fade) {
    const c = M.ctx;
    const now = c.currentTime;
    [inst.gain, inst.verb].forEach((g) => {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0.0001, now + fade);
    });
    inst.stopAt = now + fade;
  }

  function schedule() {
    const c = M.ctx;
    if (!c || c.state !== 'running') return;
    const ahead = c.currentTime + 0.15;
    M.themes = M.themes.filter((inst) => {
      if (c.currentTime > inst.stopAt + 0.1) {
        inst.nodes.forEach((n) => {
          try {
            n.stop();
          } catch (e) {}
        });
        setTimeout(() => {
          inst.gain.disconnect();
          inst.verb.disconnect();
        }, 6000); // dejar sonar las colas
        return false;
      }
      const d = 60 / inst.def.bpm / 4;
      // Si el navegador congeló el temporizador (pestaña oculta), no recuperar notas atrasadas
      if (inst.next < c.currentTime - 0.3) inst.next = c.currentTime + 0.05;
      while (inst.next < ahead && inst.next < inst.stopAt) {
        try {
          inst.def.step(inst, inst.step, inst.next, d);
        } catch (e) {
          console.warn('[música]', e);
        }
        inst.step++;
        inst.next += d;
      }
      return true;
    });
  }

  // ------------------------------------------------------------------ efectos de cinemática
  const sfx = {
    out(useVerb = 0.4) {
      const c = M.ctx;
      const g = c.createGain();
      g.connect(M.sfxBus);
      if (useVerb) {
        const s = c.createGain();
        s.gain.value = useVerb;
        g.connect(s).connect(M.sfxVerb);
      }
      return g;
    },
    // Golpe sordo de inicio de suspenso
    impact(vol = 0.7) {
      const c = ctx();
      if (!c) return;
      const t = c.currentTime + 0.01;
      const out = sfx.out(0.8);
      drum(out, t, vol, 34, 3);
      braam(out, t, [26, 33], 2.5, 0.06);
    },
    // Zumbido de oídos (tinnitus) tras un golpe
    tinnitus(dur = 4, vol = 0.018) {
      const c = ctx();
      if (!c) return;
      const t = c.currentTime;
      const o = c.createOscillator();
      o.frequency.value = 3520;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.3);
      g.gain.exponentialRampToValueAtTime(0.0003, t + dur);
      o.connect(g).connect(sfx.out(0));
      o.start(t);
      o.stop(t + dur + 0.1);
    },
    heartbeat(vol = 0.5) {
      const c = ctx();
      if (!c) return;
      const t = c.currentTime;
      const out = sfx.out(0.2);
      drum(out, t, vol, 40, 0.35);
      drum(out, t + 0.19, vol * 0.65, 38, 0.3);
    },
    // Quejido del metal bajo presión
    groan(dur = 2.5, vol = 0.12) {
      const c = ctx();
      if (!c) return;
      const t = c.currentTime;
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(70, t);
      o.frequency.linearRampToValueAtTime(48, t + dur);
      const vib = c.createOscillator();
      vib.frequency.value = 7;
      const vg = c.createGain();
      vg.gain.value = 6;
      vib.connect(vg).connect(o.frequency);
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(380, t);
      f.frequency.linearRampToValueAtTime(220, t + dur);
      f.Q.value = 9;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + dur * 0.3);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(f).connect(g).connect(sfx.out(0.9));
      o.start(t);
      vib.start(t);
      o.stop(t + dur + 0.1);
      vib.stop(t + dur + 0.1);
    },
    // Alarma de dos tonos, amortiguada
    alarm(dur = 3, vol = 0.05) {
      const c = ctx();
      if (!c) return;
      const t = c.currentTime;
      const o = c.createOscillator();
      o.type = 'square';
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1100;
      const g = c.createGain();
      g.gain.value = vol;
      for (let i = 0; i < dur / 0.5; i++) o.frequency.setValueAtTime(i % 2 ? 660 : 880, t + i * 0.5);
      g.gain.setValueAtTime(vol, t + dur - 0.3);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(f).connect(g).connect(sfx.out(0.6));
      o.start(t);
      o.stop(t + dur + 0.05);
    },
    // Rugido del fuego que avanza por el pasillo
    fireRush(dur = 1.6, vol = 0.5) {
      const c = ctx();
      if (!c) return;
      const t = c.currentTime;
      const n = noiseSrc(c, t, dur + 0.5);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(200, t);
      f.frequency.exponentialRampToValueAtTime(5000, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + dur);
      g.gain.linearRampToValueAtTime(0, t + dur + 0.3);
      n.connect(f).connect(g).connect(sfx.out(0.5));
      riser(sfx.out(0.5), t, dur, 0.12);
    },
    // Explosión grande con cola larga de estruendo
    explosion(vol = 1) {
      const c = ctx();
      if (!c) return;
      const t = c.currentTime + 0.01;
      const out = sfx.out(0.9);
      // Sub con caída de tono
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(90, t);
      o.frequency.exponentialRampToValueAtTime(22, t + 2.5);
      const og = c.createGain();
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(0.9 * vol, t + 0.01);
      og.gain.exponentialRampToValueAtTime(0.0005, t + 4);
      o.connect(og).connect(out);
      o.start(t);
      o.stop(t + 4.1);
      // Cuerpo de ruido que se oscurece
      const n = noiseSrc(c, t, 7);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(6000, t);
      f.frequency.exponentialRampToValueAtTime(90, t + 5);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.8 * vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.25 * vol, t + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 7);
      n.connect(f).connect(g).connect(out);
      // Chisporroteo de escombros
      for (let i = 0; i < 40; i++) {
        const tt = t + 0.2 + Math.pow(Math.random(), 1.8) * 4;
        const cn = noiseSrc(c, tt, 0.05);
        const cf = c.createBiquadFilter();
        cf.type = 'bandpass';
        cf.frequency.value = rand(800, 4000);
        const cg = c.createGain();
        cg.gain.setValueAtTime(rand(0.04, 0.14) * vol, tt);
        cg.gain.exponentialRampToValueAtTime(0.0005, tt + rand(0.02, 0.08));
        cn.connect(cf).connect(cg).connect(out);
      }
      // Impactos secundarios
      [0.35, 0.9, 1.6].forEach((dt, i) => drum(out, t + dt, (0.4 - i * 0.1) * vol, 30, 2));
    },
    // Pequeñas explosiones internas (antes de la grande)
    pop(vol = 0.35) {
      const c = ctx();
      if (!c) return;
      const t = c.currentTime;
      const out = sfx.out(0.7);
      drum(out, t, vol, 45, 0.8);
      const n = noiseSrc(c, t, 0.6);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(3000, t);
      f.frequency.exponentialRampToValueAtTime(150, t + 0.5);
      const g = c.createGain();
      g.gain.setValueAtTime(vol * 0.6, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.6);
      n.connect(f).connect(g).connect(out);
    },
    whoosh(vol = 0.25, dur = 1.2) {
      const c = ctx();
      if (!c) return;
      const t = c.currentTime;
      const n = noiseSrc(c, t, dur);
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 1.2;
      f.frequency.setValueAtTime(300, t);
      f.frequency.exponentialRampToValueAtTime(2500, t + dur * 0.6);
      f.frequency.exponentialRampToValueAtTime(400, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      n.connect(f).connect(g).connect(sfx.out(0.5));
    },
    engine(vol = 0.3, dur = 3) {
      const c = ctx();
      if (!c) return;
      const t = c.currentTime;
      const n = noiseSrc(c, t, dur);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(150, t);
      f.frequency.exponentialRampToValueAtTime(1600, t + dur * 0.4);
      f.frequency.exponentialRampToValueAtTime(300, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35);
      g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      n.connect(f).connect(g).connect(sfx.out(0.6));
      drum(sfx.out(0.6), t, 0.3, 36, 2);
    },
    // Interfaz
    hover() {
      const c = ctx();
      if (!c) return;
      pluck(sfx.out(0.2), c.currentTime, 88, { vol: 0.02, decay: 0.12, type: 'sine', delay: false });
    },
    select() {
      const c = ctx();
      if (!c) return;
      const t = c.currentTime;
      const out = sfx.out(0.4);
      pluck(out, t, 81, { vol: 0.04, decay: 0.3, type: 'triangle', delay: false });
      pluck(out, t + 0.06, 88, { vol: 0.035, decay: 0.4, type: 'triangle', delay: false });
    },
    strike() {
      const c = ctx();
      if (!c) return;
      braam(sfx.out(0.5), c.currentTime, [40, 41, 46], 0.9, 0.05);
    }
  };

  // ------------------------------------------------------------------ API pública
  const AetherMusic = {
    init(getCtx) {
      M.getCtx = getCtx;
    },
    // Llamar en un gesto del usuario (clic/tecla): crea y reanuda el AudioContext
    unlock() {
      const c = ctx();
      if (c && c.state === 'suspended') c.resume();
      return Boolean(c);
    },
    play(name, { fade = 2 } = {}) {
      const c = ctx();
      if (!c || !THEMES[name]) return;
      if (M.current === name && M.themes.some((i) => i.name === name && i.stopAt === Infinity)) return;
      M.themes.forEach((i) => {
        if (i.stopAt === Infinity) stopTheme(i, fade);
      });
      M.current = name;
      startTheme(name, name === 'final' || name === 'suspense' ? 0.3 : fade);
      schedule();
    },
    stop(fade = 1.5) {
      if (!M.ctx) return;
      M.themes.forEach((i) => {
        if (i.stopAt === Infinity) stopTheme(i, fade);
      });
      M.current = null;
    },
    setIntensity(v) {
      M.intensity = Math.max(0, Math.min(1, v));
    },
    get current() {
      return M.current;
    },
    get volume() {
      return { ...M.volume };
    },
    setVolume(kind, v) {
      M.volume[kind] = Math.max(0, Math.min(1, v));
      if (M.built) {
        const c = M.ctx;
        if (kind === 'music') M.musicBus.gain.setTargetAtTime(M.volume.music * 0.5, c.currentTime, 0.05);
        if (kind === 'sfx') M.sfxBus.gain.setTargetAtTime(M.volume.sfx, c.currentTime, 0.05);
      }
      try {
        localStorage.setItem('aether.audio', JSON.stringify(M.volume));
      } catch (e) {}
    },
    sfx
  };

  window.AetherMusic = AetherMusic;
})();
