/**
 * Captura de movimiento (mocap) para el astronauta.
 *
 * Las animaciones de reposo, caminar y correr son capturas de movimiento reales de Mixamo, tomadas del
 * modelo Xbot.glb de los ejemplos de three.js y reducidas a public/ship3d/mocap.json con
 * tools/extract_mocap.js (solo los huesos que usa el traje).
 *
 * Este módulo:
 *  - arma un esqueleto invisible con los huesos de Mixamo,
 *  - muestrea y mezcla los clips (reposo ↔ caminar ↔ correr) con la fase sincronizada,
 *  - calcula a qué velocidad avanza cada clip (largo de zancada) para que los pies no patinen,
 *  - y entrega direcciones de cada segmento (muslo, pierna, brazo…) para "copiarle" la pose al traje
 *    (ver astronaut.js -> retarget por direcciones, no depende de la pose de reposo del modelo).
 */
import * as THREE from 'three';

export async function loadMocap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`mocap: ${res.status}`);
  return res.json();
}

// Una pista: tiempos + valores (cuaterniones o posiciones). Muestreo lineal / slerp.
function makeTrack(t) {
  return {
    bone: t.bone,
    rot: t.path === 'rotation',
    times: Float32Array.from(t.times),
    values: Float32Array.from(t.values),
    last: 0
  };
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _va = new THREE.Vector3();

function sampleTrack(tr, time, out) {
  const { times, values } = tr;
  const n = times.length;
  const stride = tr.rot ? 4 : 3;
  if (time <= times[0] || n === 1) return out.fromArray(values, 0);
  if (time >= times[n - 1]) return out.fromArray(values, (n - 1) * stride);
  // Búsqueda desde el último índice (los tiempos casi siempre avanzan de a poco)
  let i = tr.last < n - 1 && times[tr.last] <= time ? tr.last : 0;
  while (i < n - 2 && times[i + 1] < time) i++;
  tr.last = i;
  const k = (time - times[i]) / (times[i + 1] - times[i]);
  if (tr.rot) {
    _qa.fromArray(values, i * 4);
    _qb.fromArray(values, (i + 1) * 4);
    return out.copy(_qa.slerp(_qb, k));
  }
  out.fromArray(values, i * 3);
  return out.lerp(_va.fromArray(values, (i + 1) * 3), k);
}

export function createMocapRig(data) {
  // ---------------------------------------------------------------- esqueleto
  const bones = {};
  let top = null;
  data.nodes.forEach((n) => {
    const o = new THREE.Object3D();
    o.name = n.name;
    o.position.fromArray(n.t);
    o.quaternion.fromArray(n.r);
    o.scale.fromArray(n.s);
    bones[n.name] = o;
    if (n.parent && bones[n.parent]) bones[n.parent].add(o);
    else top = o;
  });
  const names = Object.keys(bones);
  const rest = {};
  names.forEach((k) => (rest[k] = { q: bones[k].quaternion.clone(), p: bones[k].position.clone() }));

  // ---------------------------------------------------------------- clips
  const clips = {};
  Object.entries(data.clips).forEach(([name, c]) => {
    clips[name] = { name, duration: c.duration, tracks: c.tracks.map(makeTrack), offset: 0, speed: 0 };
  });

  // Una "pose" = cuaternión y posición por hueso
  const newPose = () => {
    const p = {};
    names.forEach((k) => (p[k] = { q: rest[k].q.clone(), p: rest[k].p.clone() }));
    return p;
  };
  const poses = { idle: newPose(), walk: newPose(), run: newPose(), loco: newPose(), out: newPose() };

  function sampleClip(clip, time, pose) {
    clip.tracks.forEach((tr) => {
      const b = pose[tr.bone];
      if (b) sampleTrack(tr, time, tr.rot ? b.q : b.p);
    });
    return pose;
  }
  function blendPose(a, b, k, out) {
    names.forEach((n) => {
      out[n].q.copy(a[n].q).slerp(b[n].q, k);
      out[n].p.copy(a[n].p).lerp(b[n].p, k);
    });
    return out;
  }
  function applyPose(pose) {
    names.forEach((n) => {
      bones[n].quaternion.copy(pose[n].q);
      bones[n].position.copy(pose[n].p);
    });
    top.updateMatrixWorld(true);
  }

  const _p = new THREE.Vector3();
  const _p2 = new THREE.Vector3();
  const _pl = new THREE.Vector3();
  const pos = (name, out = new THREE.Vector3()) => bones[name].getWorldPosition(out);
  const dir = (from, to, out = new THREE.Vector3()) => pos(to, out).sub(pos(from, _p2)).normalize();

  // ---------------------------------------------------------------- análisis de cada ciclo
  // offset: fase en que el pie izquierdo está más adelante (para sincronizar caminar y correr)
  // speed: metros por segundo que avanza el pie de apoyo (largo de zancada / duración)
  ['walk', 'run'].forEach((name) => {
    const clip = clips[name];
    if (!clip) return;
    const N = 120;
    let best = -Infinity;
    let dist = 0;
    let frames = 0;
    let prev = null;
    // Altura mínima de los pies en todo el ciclo (= el suelo)
    let ground = Infinity;
    for (let i = 0; i < N; i++) {
      applyPose(sampleClip(clip, (i / N) * clip.duration, poses.out));
      ground = Math.min(ground, pos('LeftFoot').y, pos('RightFoot', _p).y);
    }
    for (let i = 0; i <= N; i++) {
      applyPose(sampleClip(clip, (i / N) * clip.duration, poses.out));
      const l = pos('LeftFoot');
      const r = pos('RightFoot', _p);
      if (i < N && l.z > best) {
        best = l.z;
        clip.offset = i / N;
      }
      // Velocidad del pie de apoyo cuando está en el suelo (en carrera hay fases en el aire)
      const support = l.y < r.y ? { side: 'L', z: l.z, y: l.y } : { side: 'R', z: r.z, y: r.y };
      if (prev && prev.side === support.side && support.y < ground + 0.03) {
        dist += prev.z - support.z;
        frames++;
      }
      prev = support;
    }
    clip.speed = dist / (frames * (clip.duration / N));
  });
  applyPose(newPose());
  const restLeg = pos('LeftUpLeg').y; // altura de la cadera en reposo (escala del actor)

  // ---------------------------------------------------------------- reproducción
  const state = { phase: 0, idleT: 0, move: 0, run: 0, support: 'L', step: false };

  /**
   * Avanza las animaciones según la velocidad real del personaje (m/s, ya en la escala del actor).
   * Devuelve true en el instante en que un pie se apoya (para el sonido de los pasos).
   */
  function update(dt, speed) {
    const walk = clips.walk;
    const run = clips.run;
    const idle = clips.idle;
    state.move += ((speed > 0.15 ? 1 : 0) - state.move) * Math.min(1, dt * 7);
    const runTarget = THREE.MathUtils.smoothstep(speed, walk.speed * 1.2, run.speed * 0.8);
    state.run += (runTarget - state.run) * Math.min(1, dt * 4);

    const natural = THREE.MathUtils.lerp(walk.speed, run.speed, state.run);
    const cycle = THREE.MathUtils.lerp(walk.duration, run.duration, state.run);
    const rate = speed > 0.05 ? THREE.MathUtils.clamp(speed / natural, 0.55, 2.4) : 1;
    state.phase = (state.phase + (dt * rate) / cycle) % 1;
    state.idleT = (state.idleT + dt) % idle.duration;

    sampleClip(idle, state.idleT, poses.idle);
    sampleClip(walk, ((state.phase + walk.offset) % 1) * walk.duration, poses.walk);
    sampleClip(run, ((state.phase + run.offset) % 1) * run.duration, poses.run);
    blendPose(poses.walk, poses.run, state.run, poses.loco);
    applyPose(blendPose(poses.idle, poses.loco, state.move, poses.out));

    // Pie de apoyo: el más bajo. Cambia de lado = paso.
    const support = pos('LeftFoot', _pl).y < pos('RightFoot', _p).y ? 'L' : 'R';
    const step = support !== state.support && state.move > 0.5;
    state.support = support;
    return step;
  }

  const _qr = new THREE.Quaternion();
  return {
    bones,
    clips,
    state,
    restLeg,
    update,
    pos,
    dir,
    // Dirección del segmento en la pose de reposo (para medir cuánto rotó, p. ej. el pie)
    restDir(from, to) {
      const saved = names.map((n) => [bones[n].quaternion.clone(), bones[n].position.clone()]);
      applyPose(newPose());
      const d = dir(from, to);
      names.forEach((n, i) => {
        bones[n].quaternion.copy(saved[i][0]);
        bones[n].position.copy(saved[i][1]);
      });
      top.updateMatrixWorld(true);
      return d;
    },
    // Rotación del hueso respecto de su pose de reposo, en el espacio del personaje
    worldDelta(name, out = new THREE.Quaternion()) {
      bones[name].getWorldQuaternion(out);
      // Reposo: las rotaciones de reposo de Mixamo/Xbot son identidad salvo la escala del Armature
      let o = bones[name];
      _qr.identity();
      while (o) {
        _qr.premultiply(rest[o.name].q);
        o = o.parent;
      }
      return out.multiply(_qr.invert());
    }
  };
}
