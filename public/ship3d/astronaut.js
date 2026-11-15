/**
 * Astronauta con traje estilo EMU (Extravehicular Mobility Unit, el traje de caminatas espaciales
 * de la NASA), hecho con geometría de Three.js:
 *
 *  - HUT (torso rígido) y cintura con anillo de cierre
 *  - DCM: módulo de control en el pecho, con perillas, pantalla y válvula de purga roja
 *  - PLSS: mochila de soporte vital, con la unidad de rescate SAFER abajo
 *  - Mangueras del DCM a la mochila
 *  - Casco con burbuja transparente, carcasa del visor (EVVA), visera dorada y luces/cámaras (EHIP)
 *  - Anillos de rodamiento en hombros, codos, muñecas, cadera y rodillas
 *  - Franjas rojas en las piernas (identifican al comandante)
 *  - Guantes, botas, lista de chequeo en la muñeca izquierda y parches en los hombros
 *
 * Mira hacia +Z. Altura ~1,9 m.
 *
 * Animación: captura de movimiento real (Mixamo, vía ship3d/mocap.js) copiada al traje "por
 * direcciones": cada segmento (muslo, pierna, pie, brazo, antebrazo, mano) se orienta como el hueso
 * del actor, la columna copia la rotación del pecho y los pies se apoyan siempre en el piso.
 * Mientras no carga el mocap (o si falla) se usa una caminata procedural de respaldo.
 */
import * as THREE from 'three';
import { suitFabric, canvasTex } from './textures.js';

export function buildAstronaut() {
  const fabric = suitFabric();
  fabric.map.repeat.set(2, 2);
  fabric.normalMap.repeat.set(2, 2);

  const M = {
    suit: new THREE.MeshStandardMaterial({ color: 0xffffff, map: fabric.map, normalMap: fabric.normalMap, roughness: 0.92, metalness: 0 }),
    hard: new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.45, metalness: 0.05 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.28, metalness: 0.9 }),
    blueMetal: new THREE.MeshStandardMaterial({ color: 0x5b7fa8, roughness: 0.3, metalness: 0.85 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.3 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1d2025, roughness: 0.9 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.8 }),
    glove: new THREE.MeshStandardMaterial({ color: 0xd9dde3, map: fabric.map, roughness: 0.85 }),
    palm: new THREE.MeshStandardMaterial({ color: 0x6b7480, roughness: 0.75 }),
    visor: new THREE.MeshStandardMaterial({ color: 0xffc93c, roughness: 0.04, metalness: 1, envMapIntensity: 1.6 }),
    bubble: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, metalness: 0, transmission: 0.9, transparent: true, opacity: 0.25, envMapIntensity: 1.2 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff6d5 }),
    screen: new THREE.MeshBasicMaterial({ color: 0x0f3d2a })
  };

  const root = new THREE.Group();
  root.name = 'astronauta';
  const rig = new THREE.Group(); // todo el cuerpo; sube o baja para que los pies toquen el piso
  root.add(rig);
  const pelvis = new THREE.Group(); // pivote en la cintura: inclina el tronco como el actor
  pelvis.position.y = 1.0;
  rig.add(pelvis);
  const body = new THREE.Group(); // torso + cabeza + brazos
  body.position.y = -1.0;
  pelvis.add(body);

  const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  // ------------------------------------------------------------- torso (HUT)
  // Perfil de revolución: cintura angosta, pecho ancho, hombros redondeados
  const torsoProfile = [
    [0.0, 0.0], [0.22, 0.0], [0.25, 0.08], [0.27, 0.2], [0.3, 0.34], [0.31, 0.44], [0.29, 0.52], [0.22, 0.58], [0.1, 0.61], [0.0, 0.61]
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = add(body, new THREE.LatheGeometry(torsoProfile, 28), M.hard, 0, 1.06, 0);
  torso.scale.set(1.08, 1, 0.78);

  // Anillo de cintura (cierre entre torso y pantalón)
  const waistRing = add(body, new THREE.TorusGeometry(0.235, 0.025, 10, 32), M.metal, 0, 1.06, 0);
  waistRing.rotation.x = Math.PI / 2;
  waistRing.scale.set(1.05, 0.8, 1);

  // Pantalón superior (tela) entre cintura y caderas
  const brief = add(rig, new THREE.CylinderGeometry(0.235, 0.21, 0.2, 24), M.suit, 0, 0.97, 0);
  brief.scale.z = 0.8;

  // ------------------------------------------------------------- DCM (panel del pecho)
  const dcm = new THREE.Group();
  dcm.position.set(0, 1.3, 0.22);
  dcm.rotation.x = -0.25;
  body.add(dcm);
  add(dcm, new THREE.BoxGeometry(0.34, 0.15, 0.12), M.hard);
  add(dcm, new THREE.BoxGeometry(0.12, 0.05, 0.01), M.screen, -0.07, 0.035, 0.062);
  const knobGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.03, 12);
  [[0.06, 0.03, M.dark], [0.11, 0.03, M.blueMetal], [0.06, -0.035, M.dark], [-0.11, -0.035, M.dark]].forEach(([x, y, mat]) => {
    const k = add(dcm, knobGeo, mat, x, y, 0.07);
    k.rotation.x = Math.PI / 2;
  });
  const purge = add(dcm, new THREE.CylinderGeometry(0.022, 0.022, 0.035, 12), M.red, 0.0, -0.035, 0.072);
  purge.rotation.x = Math.PI / 2;

  // Mangueras del DCM hacia la mochila (por los costados)
  [-1, 1].forEach((side) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.16, 1.27, 0.24),
      new THREE.Vector3(side * 0.3, 1.2, 0.12),
      new THREE.Vector3(side * 0.33, 1.25, -0.12),
      new THREE.Vector3(side * 0.24, 1.32, -0.27)
    ]);
    add(body, new THREE.TubeGeometry(curve, 20, 0.018, 8, false), side < 0 ? M.blueMetal : M.dark);
  });

  // ------------------------------------------------------------- PLSS (mochila) + SAFER
  const plss = new THREE.Group();
  plss.position.set(0, 1.38, -0.3);
  body.add(plss);
  const pack = add(plss, new THREE.BoxGeometry(0.56, 0.72, 0.26), M.hard);
  // Bordes redondeados aproximados con cilindros a los lados
  [-1, 1].forEach((s) => {
    const edge = add(plss, new THREE.CylinderGeometry(0.13, 0.13, 0.72, 16, 1, false, 0, Math.PI), M.hard, s * 0.28, 0, 0);
    edge.rotation.y = s > 0 ? 0 : Math.PI;
  });
  add(plss, new THREE.BoxGeometry(0.5, 0.04, 0.27), M.metal, 0, 0.2, 0);
  add(plss, new THREE.BoxGeometry(0.2, 0.08, 0.02), M.dark, 0.12, 0.26, -0.135);
  pack.userData.part = 'PLSS';
  const safer = add(plss, new THREE.BoxGeometry(0.58, 0.16, 0.3), M.dark, 0, -0.44, 0.01);
  safer.userData.part = 'SAFER';
  [-0.2, 0.2].forEach((x) => {
    const handle = add(plss, new THREE.TorusGeometry(0.05, 0.012, 6, 16, Math.PI), M.metal, x, -0.5, -0.17);
    handle.rotation.z = Math.PI;
  });

  // ------------------------------------------------------------- casco
  const head = new THREE.Group();
  head.position.set(0, 1.78, 0.02);
  body.add(head);
  add(head, new THREE.CylinderGeometry(0.16, 0.19, 0.08, 28), M.metal, 0, -0.14, 0); // anillo del cuello
  add(head, new THREE.SphereGeometry(0.2, 32, 24), M.bubble); // burbuja transparente
  // Carcasa del visor (EVVA): cubre arriba y atrás
  const evva = add(head, new THREE.SphereGeometry(0.215, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.62), M.hard);
  evva.rotation.x = -0.35;
  // Visera dorada (se ve desde adelante)
  const visor = add(head, new THREE.SphereGeometry(0.218, 32, 20, Math.PI / 2 - 1.05, 2.1, 0.7, 1.05), M.visor);
  visor.rotation.x = -0.05;
  // Luces y cámaras del casco (EHIP) a ambos lados
  const lamps = [];
  [-1, 1].forEach((s) => {
    const pod = new THREE.Group();
    pod.position.set(s * 0.215, 0.07, 0.02);
    head.add(pod);
    add(pod, new THREE.BoxGeometry(0.06, 0.07, 0.13), M.hard);
    const lens = add(pod, new THREE.CylinderGeometry(0.022, 0.022, 0.02, 14), M.lamp, 0, 0.012, 0.07);
    lens.rotation.x = Math.PI / 2;
    lamps.push(lens);
    const cam = add(pod, new THREE.CylinderGeometry(0.014, 0.014, 0.05, 10), M.dark, 0, -0.025, 0.07);
    cam.rotation.x = Math.PI / 2;
  });

  // ------------------------------------------------------------- brazos
  function arm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.37, 1.53, 0);
    body.add(shoulder);
    const bearing = add(shoulder, new THREE.TorusGeometry(0.105, 0.022, 10, 28), M.metal);
    bearing.rotation.y = Math.PI / 2;
    add(shoulder, new THREE.SphereGeometry(0.115, 20, 16), M.suit, side * 0.02, -0.02, 0);
    add(shoulder, new THREE.CapsuleGeometry(0.085, 0.22, 6, 16), M.suit, side * 0.02, -0.19, 0);
    // Parche en el hombro
    const patch = add(shoulder, new THREE.PlaneGeometry(0.09, 0.06), patchMaterial(side), side * 0.112, -0.1, 0);
    patch.rotation.y = side * Math.PI / 2;

    const elbow = new THREE.Group();
    elbow.position.set(side * 0.02, -0.37, 0);
    shoulder.add(elbow);
    add(elbow, new THREE.SphereGeometry(0.09, 16, 12), M.suit);
    add(elbow, new THREE.CapsuleGeometry(0.075, 0.2, 6, 14), M.suit, 0, -0.16, 0);
    const wrist = add(elbow, new THREE.TorusGeometry(0.065, 0.016, 8, 22), M.blueMetal, 0, -0.31, 0);
    wrist.rotation.x = Math.PI / 2;
    // Guante: palma + dedos + pulgar
    const hand = new THREE.Group();
    hand.position.set(0, -0.37, 0.01);
    elbow.add(hand);
    add(hand, new THREE.BoxGeometry(0.085, 0.1, 0.05), M.glove);
    add(hand, new THREE.BoxGeometry(0.08, 0.06, 0.012), M.palm, 0, -0.01, -side * 0 - 0.03);
    add(hand, new THREE.BoxGeometry(0.075, 0.07, 0.04), M.glove, 0, -0.08, 0.005);
    add(hand, new THREE.CapsuleGeometry(0.014, 0.04, 4, 8), M.glove, -side * 0.05, -0.02, 0.025);
    // Lista de chequeo en la muñeca izquierda
    if (side < 0) {
      const cuff = add(elbow, new THREE.BoxGeometry(0.07, 0.09, 0.03), M.hard, 0, -0.22, 0.08);
      cuff.rotation.x = -0.2;
    }
    return { shoulder, elbow, hand, side };
  }
  const armL = arm(-1);
  const armR = arm(1);

  // ------------------------------------------------------------- piernas
  function leg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.13, 0.93, 0);
    rig.add(hip);
    const bearing = add(hip, new THREE.TorusGeometry(0.11, 0.018, 8, 24), M.metal, 0, -0.04, 0);
    bearing.rotation.x = Math.PI / 2;
    add(hip, new THREE.CapsuleGeometry(0.105, 0.26, 6, 16), M.suit, 0, -0.21, 0);
    // Franja roja del comandante
    const stripe = add(hip, new THREE.CylinderGeometry(0.108, 0.108, 0.05, 20, 1, true), M.red, 0, -0.18, 0);
    stripe.material.side = THREE.DoubleSide;

    const knee = new THREE.Group();
    knee.position.set(0, -0.43, 0);
    hip.add(knee);
    add(knee, new THREE.SphereGeometry(0.1, 16, 12), M.suit);
    const kneeRing = add(knee, new THREE.TorusGeometry(0.092, 0.014, 8, 22), M.metal, 0, -0.06, 0);
    kneeRing.rotation.x = Math.PI / 2;
    add(knee, new THREE.CapsuleGeometry(0.09, 0.24, 6, 14), M.suit, 0, -0.2, 0);
    add(knee, new THREE.CylinderGeometry(0.093, 0.093, 0.04, 18, 1, true), M.red, 0, -0.22, 0).material.side = THREE.DoubleSide;
    // Bota
    const boot = new THREE.Group();
    boot.position.set(0, -0.42, 0);
    knee.add(boot);
    add(boot, new THREE.CylinderGeometry(0.095, 0.1, 0.12, 18), M.hard, 0, 0.0, 0);
    const foot = add(boot, new THREE.BoxGeometry(0.15, 0.08, 0.28), M.hard, 0, -0.06, 0.05);
    foot.geometry.translate(0, 0, 0);
    add(boot, new THREE.BoxGeometry(0.16, 0.025, 0.3), M.rubber, 0, -0.105, 0.05);
    // Puntos de la suela (talón y punta) para apoyar el pie en el piso
    const soles = [-0.09, 0.19].map((z) => {
      const p = new THREE.Object3D();
      p.position.set(0, -0.118, z);
      boot.add(p);
      return p;
    });
    return { hip, knee, boot, soles, side };
  }
  const legL = leg(-1);
  const legR = leg(1);

  // Nombre de cada malla para depurar / sin sombras
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });

  // ------------------------------------------------------------- animación
  const DOWN = new THREE.Vector3(0, -1, 0);
  const FWD = new THREE.Vector3(0, 0, 1);
  const Z = new THREE.Vector3(0, 0, 1);
  const _q = new THREE.Quaternion();
  const _pq = new THREE.Quaternion();
  const _d = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _w = new THREE.Vector3();
  let breath = 0;
  let mocap = null;
  const footRest = {};

  // Rotación acumulada de un objeto respecto de `rig` (el rig solo se traslada)
  function rigQuat(obj, out) {
    out.identity();
    for (let o = obj; o && o !== rig; o = o.parent) out.premultiply(o.quaternion);
    return out;
  }
  // Orienta la articulación para que su eje de reposo (restDir) apunte hacia `dir` (espacio del personaje)
  function aim(joint, restDir, dir) {
    rigQuat(joint.parent, _pq).invert();
    _v.copy(dir).applyQuaternion(_pq).normalize();
    joint.quaternion.setFromUnitVectors(restDir, _v);
  }

  /** Conecta la captura de movimiento (ship3d/mocap.js). */
  function setMocap(m) {
    mocap = m;
    footRest.Left = m.restDir('LeftFoot', 'LeftToeBase');
    footRest.Right = m.restDir('RightFoot', 'RightToeBase');
  }

  function animateMocap(dt, speed) {
    const step = mocap.update(dt, speed);

    // Tronco: copia la rotación del pecho del actor (inclinación y giro al caminar/correr)
    mocap.worldDelta('Spine2', _q);
    pelvis.quaternion.identity().slerp(_q, 0.85);

    // Brazos. Lado -X del traje = lado derecho del actor (ambos miran a +Z).
    // El traje EMU es más ancho que el actor: los brazos se abren un poco para no atravesar el torso.
    [armL, armR].forEach((a) => {
      const src = a.side < 0 ? 'Right' : 'Left';
      const open = a.side * 0.2;
      aim(a.shoulder, DOWN, mocap.dir(`${src}Arm`, `${src}ForeArm`, _d).applyAxisAngle(Z, open));
      aim(a.elbow, DOWN, mocap.dir(`${src}ForeArm`, `${src}Hand`, _d).applyAxisAngle(Z, open * 0.6));
      aim(a.hand, DOWN, mocap.dir(`${src}Hand`, `${src}HandMiddle1`, _d));
    });

    // Piernas y pies
    [legL, legR].forEach((l) => {
      const src = l.side < 0 ? 'Right' : 'Left';
      aim(l.hip, DOWN, mocap.dir(`${src}UpLeg`, `${src}Leg`, _d));
      aim(l.knee, DOWN, mocap.dir(`${src}Leg`, `${src}Foot`, _d));
      // Pie: se gira lo mismo que gira el pie del actor desde su reposo
      _q.setFromUnitVectors(footRest[src], mocap.dir(`${src}Foot`, `${src}ToeBase`, _d));
      aim(l.boot, FWD, _w.copy(FWD).applyQuaternion(_q));
    });

    // Apoyar los pies en el piso: el punto más bajo de las suelas queda en y = 0
    rig.position.y = 0;
    root.updateMatrixWorld(true);
    let low = Infinity;
    [legL, legR].forEach((l) => l.soles.forEach((p) => {
      p.getWorldPosition(_v);
      low = Math.min(low, root.worldToLocal(_v).y);
    }));
    rig.position.y = -low;
    return step;
  }

  // Respaldo sin mocap: caminata procedural
  let walkT = 0;
  let move = 0;
  function animateProcedural(dt, speed) {
    move += ((speed > 0.15 ? 1 : 0) - move) * Math.min(1, dt * 6);
    const before = Math.floor(walkT / Math.PI);
    walkT += dt * speed * 3.2;
    const s = Math.sin(walkT);
    const c = Math.cos(walkT);
    legL.hip.rotation.set(s * 0.55 * move, 0, 0);
    legR.hip.rotation.set(-s * 0.55 * move, 0, 0);
    legL.knee.rotation.set(Math.max(0, -c) * 0.75 * move, 0, 0);
    legR.knee.rotation.set(Math.max(0, c) * 0.75 * move, 0, 0);
    armL.shoulder.rotation.set(-s * 0.45 * move, 0, -0.18);
    armR.shoulder.rotation.set(s * 0.45 * move, 0, 0.18);
    armL.elbow.rotation.set(-0.35 - Math.max(0, s) * 0.3 * move, 0, 0);
    armR.elbow.rotation.set(-0.35 - Math.max(0, -s) * 0.3 * move, 0, 0);
    rig.position.y = Math.abs(s) * 0.035 * move;
    pelvis.rotation.set(0, 0, s * 0.03 * move);
    return move > 0.5 && Math.floor(walkT / Math.PI) !== before;
  }

  /**
   * dt en segundos, speed = velocidad real sobre el piso en m/s (0 = quieto).
   * Devuelve true cuando un pie se apoya (para el sonido de los pasos).
   */
  function animate(dt, speed) {
    breath += dt;
    const step = mocap ? animateMocap(dt, speed) : animateProcedural(dt, speed);
    torso.scale.y = 1 + Math.sin(breath * 1.6) * 0.008;
    return step;
  }

  return { root, head, lamps, animate, setMocap, materials: M };
}

// Parches de los hombros: bandera (izquierdo) y misión (derecho). Sin logotipos reales.
function patchMaterial(side) {
  const tex = side < 0
    ? canvasTex(90, 60, (g) => {
      for (let i = 0; i < 13; i++) {
        g.fillStyle = i % 2 ? '#ffffff' : '#b31942';
        g.fillRect(0, (i * 60) / 13, 90, 60 / 13 + 0.5);
      }
      g.fillStyle = '#0a3161';
      g.fillRect(0, 0, 38, 32);
    }, { repeat: false })
    : canvasTex(90, 60, (g) => {
      g.fillStyle = '#0b1f3a';
      g.fillRect(0, 0, 90, 60);
      g.strokeStyle = '#facc15';
      g.lineWidth = 4;
      g.strokeRect(3, 3, 84, 54);
      g.fillStyle = '#e2e8f0';
      g.font = 'bold 15px sans-serif';
      g.textAlign = 'center';
      g.fillText('AETHER', 45, 36);
    }, { repeat: false });
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
}
