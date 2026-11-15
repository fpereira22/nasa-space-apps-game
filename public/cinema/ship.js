/**
 * U.S.S. Aether vista desde afuera. Proa hacia +X, largo ~26 m.
 *
 * Partes: casco principal (en segmentos que pueden romperse), puente con ventanas,
 * anillo habitable giratorio con rayos, núcleo del reactor (anillo que brilla),
 * 2 motores con llama de plasma, alas solares, radiadores, antena parabólica,
 * detalles ("greebles"), luces de navegación y nombre pintado en el casco.
 *
 * Cada pieza de primer nivel está en `parts` para que la explosión pueda lanzarlas.
 * Las caras internas del casco brillan al rojo (uHeat) cuando la nave se rompe.
 */
import * as THREE from 'three';

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function buildShip() {
  const ship = new THREE.Group();
  ship.name = 'aether-exterior';
  const parts = [];
  const heat = { value: 0 }; // 0..1: caras internas al rojo vivo
  const alert = { value: 0 }; // 0 = normal (cian), 1 = alerta (rojo)

  const loader = new THREE.TextureLoader();
  const loadTex = (name, srgb) =>
    loader.load('/textures/' + name, (t) => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    });

  // Paneles del casco: líneas de unión dibujadas + textura fotográfica de metal
  const panelLines = canvasTex(1024, 512, (g, w, h) => {
    g.fillStyle = '#c9ced4';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const v = 175 + Math.random() * 50;
      g.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
      g.fillRect(Math.random() * w, Math.random() * h, 30 + Math.random() * 120, 20 + Math.random() * 70);
    }
    g.strokeStyle = 'rgba(40,45,52,0.8)';
    g.lineWidth = 2;
    for (let x = 0; x < w; x += 64) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    for (let y = 0; y < h; y += 48) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    // Franjas y marcas
    g.fillStyle = '#7a1d1d';
    g.fillRect(0, h * 0.46, w, 10);
    g.fillStyle = 'rgba(30,30,30,0.25)';
    for (let i = 0; i < 40; i++) g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
  });
  const hullRough = loadTex('metal_plate_rough_1k.jpg');
  const hullNormal = loadTex('metal_plate_nor_gl_1k.jpg');
  [hullRough, hullNormal].forEach((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(6, 2);
  });
  panelLines.repeat.set(2, 1);

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0xe3e6ea,
    map: panelLines,
    roughnessMap: hullRough,
    normalMap: hullNormal,
    normalScale: new THREE.Vector2(0.6, 0.6),
    metalness: 0.55,
    roughness: 0.75,
    side: THREE.DoubleSide
  });
  // Caras internas al rojo vivo durante la explosión
  hullMat.onBeforeCompile = (shader) => {
    shader.uniforms.uHeat = heat;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uHeat;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (!gl_FrontFacing) { totalEmissiveRadiance += vec3(4.0, 1.1, 0.25) * uHeat; diffuseColor.rgb *= 0.2; }`
      );
  };

  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.85, roughness: 0.4 });
  const goldFoil = new THREE.MeshStandardMaterial({ color: 0xd4a548, metalness: 1, roughness: 0.35 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, metalness: 0.1, roughness: 0.55 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0a1420, metalness: 1, roughness: 0.06, envMapIntensity: 2 });

  const windowTex = canvasTex(512, 64, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    for (let x = 6; x < w; x += 22) {
      if (Math.random() < 0.15) continue;
      const v = 0.6 + Math.random() * 0.4;
      g.fillStyle = `rgba(255,${Math.round(210 * v)},${Math.round(150 * v)},${v})`;
      g.fillRect(x, 24, 12, 16);
    }
  });
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    emissive: 0xffffff,
    emissiveMap: windowTex,
    emissiveIntensity: 2.2,
    transparent: true,
    alphaMap: windowTex,
    metalness: 0.2,
    roughness: 0.3
  });

  const addPart = (obj, name) => {
    obj.name = name;
    ship.add(obj);
    parts.push(obj);
    return obj;
  };

  // ------------------------------------------------------------------ casco principal (lathe, eje X)
  const profile = [
    [0.0, -13], [1.2, -12.6], [1.9, -11.5], [2.1, -9], [2.0, -6], [2.3, -3], [2.4, 0], [2.3, 3], [2.0, 6], [1.9, 8.5], [1.6, 10.5], [1.1, 12], [0.4, 13], [0.0, 13.2]
  ];
  // Se corta en segmentos a lo largo y en mitades alrededor (piezas que se separan)
  const cuts = [-13, -6, 0, 6, 13.2];
  const interp = (y) => {
    for (let i = 0; i < profile.length - 1; i++) {
      const [r0, y0] = profile[i];
      const [r1, y1] = profile[i + 1];
      if (y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
    }
    return 0;
  };
  for (let s = 0; s < cuts.length - 1; s++) {
    const a = cuts[s];
    const b = cuts[s + 1];
    const pts = [new THREE.Vector2(interp(a), a)];
    profile.forEach(([r, y]) => {
      if (y > a && y < b) pts.push(new THREE.Vector2(r, y));
    });
    pts.push(new THREE.Vector2(interp(b), b));
    for (let half = 0; half < 2; half++) {
      const geo = new THREE.LatheGeometry(pts, 32, half * Math.PI, Math.PI);
      geo.rotateZ(-Math.PI / 2); // eje Y -> eje X
      const m = new THREE.Mesh(geo, hullMat);
      const grp = new THREE.Group();
      grp.add(m);
      addPart(grp, `casco-${s}-${half}`);
    }
  }

  // Franja de ventanas del puente y del casco
  const winBand = new THREE.Mesh(new THREE.CylinderGeometry(2.02, 2.02, 4, 48, 1, true, -0.4, Math.PI * 1.2), windowMat);
  winBand.rotation.z = -Math.PI / 2;
  winBand.position.x = 7.5;
  ship.add(winBand);
  const winBand2 = winBand.clone();
  winBand2.position.x = -3;
  winBand2.scale.set(1.17, 1, 1.17);
  ship.add(winBand2);
  const windows = [winBand, winBand2];

  // Cabina (vidrio oscuro brillante)
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.25, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2.6), glass);
  canopy.rotation.z = -Math.PI / 2 + 0.35;
  canopy.position.set(11.4, 0.55, 0);
  canopy.scale.set(1, 1, 1.25);
  addPart(new THREE.Group().add(canopy), 'cabina');

  // ------------------------------------------------------------------ anillo habitable
  const ringGroup = new THREE.Group();
  ringGroup.position.x = 1.5;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(7, 0.75, 20, 96), hullMat);
  ring.rotation.y = Math.PI / 2;
  ringGroup.add(ring);
  const ringWin = new THREE.Mesh(new THREE.TorusGeometry(7, 0.77, 6, 96), windowMat);
  ringWin.rotation.y = Math.PI / 2;
  ringWin.scale.set(1, 1, 0.25);
  ringGroup.add(ringWin);
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 4.8, 12), darkMetal);
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    spoke.position.set(0, Math.cos(a) * 4.6, Math.sin(a) * 4.6);
    spoke.rotation.x = -a;
    ringGroup.add(spoke);
  }
  addPart(ringGroup, 'anillo');

  // ------------------------------------------------------------------ núcleo del reactor (popa)
  const reactor = new THREE.Group();
  reactor.position.x = -8.5;
  const housing = new THREE.Mesh(new THREE.TorusGeometry(2.7, 0.55, 16, 64), darkMetal);
  housing.rotation.y = Math.PI / 2;
  reactor.add(housing);
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x38d9ff, emissiveIntensity: 3 });
  const coreRing = new THREE.Mesh(new THREE.TorusGeometry(2.7, 0.2, 10, 64), coreMat);
  coreRing.rotation.y = Math.PI / 2;
  coreRing.scale.set(1.04, 1.04, 1);
  reactor.add(coreRing);
  addPart(reactor, 'reactor');

  // ------------------------------------------------------------------ motores
  const flameMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPower: { value: 0.6 }, uColor: { value: new THREE.Color(0x66ccff) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; uniform float uPower; uniform vec3 uColor; varying vec2 vUv;
      void main(){
        float along = 1.0 - vUv.y;         // 1 = tobera (base del cono), 0 = punta
        float flick = 0.85 + 0.15*sin(uTime*60.0 + along*20.0);
        float core = pow(along, 2.5);
        float diamonds = 0.5 + 0.5*sin(along*40.0 - uTime*30.0);
        float a = pow(along, 1.4) * flick * uPower * (0.8 + 0.2*diamonds);
        vec3 col = mix(uColor, vec3(1.0), core*0.6) * 1.4;
        gl_FragColor = vec4(col*a, a);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const nozzleGeo = new THREE.LatheGeometry(
    [[0.5, 0], [0.7, -0.6], [1.0, -1.5], [1.15, -2.0]].map(([r, y]) => new THREE.Vector2(r, y)),
    32
  );
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x5aaecc });
  const engines = [];
  [-1.4, 1.4].forEach((z, i) => {
    const eng = new THREE.Group();
    eng.position.set(-13, 0, z);
    const nozzle = new THREE.Mesh(nozzleGeo, darkMetal);
    nozzle.material = darkMetal.clone();
    nozzle.material.side = THREE.DoubleSide;
    nozzle.rotation.z = -Math.PI / 2;
    eng.add(nozzle);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.95, 32), glowMat);
    glow.rotation.y = -Math.PI / 2;
    glow.position.x = -1.2;
    eng.add(glow);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.9, 7, 32, 1, true), flameMat);
    flame.rotation.z = Math.PI / 2;
    flame.position.x = -2 - 3.5;
    flame.geometry.translate(0, 0, 0);
    eng.add(flame);
    const light = new THREE.PointLight(0x66ccff, 4, 18, 2);
    light.position.x = -3;
    eng.add(light);
    addPart(eng, `motor-${i}`);
    engines.push({ eng, flame, light });
  });

  // ------------------------------------------------------------------ alas solares
  const cellTex = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#0c1c3c';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16)
      for (let y = 0; y < h; y += 16) {
        const v = 30 + Math.random() * 30;
        g.fillStyle = `rgb(${v * 0.4},${v * 0.7},${v * 2})`;
        g.fillRect(x + 1, y + 1, 14, 14);
      }
    g.fillStyle = '#c0c4ca';
    g.fillRect(0, h / 2 - 1, w, 2);
  });
  const cellMat = new THREE.MeshStandardMaterial({ map: cellTex, metalness: 0.7, roughness: 0.25, side: THREE.DoubleSide });
  [-1, 1].forEach((side) => {
    const wing = new THREE.Group();
    wing.position.set(-4.5, 0, side * 2.2);
    const truss = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 9), darkMetal);
    truss.position.z = side * 4.5;
    wing.add(truss);
    for (let k = 0; k < 2; k++) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 7.5), cellMat);
      panel.rotation.x = -Math.PI / 2;
      panel.position.set(k ? 1.8 : -1.8, 0, side * 5);
      wing.add(panel);
    }
    addPart(wing, `ala-${side}`);
  });

  // Radiadores (aletas blancas)
  [-1, 1].forEach((side) => {
    const rad = new THREE.Mesh(new THREE.BoxGeometry(5, 0.08, 1.8), white);
    rad.position.set(5, side * 2.6, 0);
    rad.rotation.x = side * 0.15;
    addPart(new THREE.Group().add(rad), `radiador-${side}`);
  });

  // Antena parabólica + mástil
  const comms = new THREE.Group();
  comms.position.set(3, 2.1, 0);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.6, 8), darkMetal);
  mast.position.y = 0.8;
  comms.add(mast);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.1, 32, 12, 0, Math.PI * 2, 0, 0.7), white);
  dish.material = white.clone();
  dish.material.side = THREE.DoubleSide;
  dish.position.y = 1.9;
  dish.rotation.x = Math.PI + 0.6;
  comms.add(dish);
  addPart(comms, 'antena');

  // Detalles (greebles) sobre el casco: cajas y tanques con lámina dorada
  const greeble = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), darkMetal, 90);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 90; i++) {
    const x = -11 + Math.random() * 20;
    const a = Math.random() * Math.PI * 2;
    const r = interp(x) + 0.05;
    const sx = 0.3 + Math.random() * 1.2;
    const sy = 0.1 + Math.random() * 0.25;
    const sz = 0.2 + Math.random() * 0.6;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
    m4.compose(new THREE.Vector3(x, Math.cos(a) * r, Math.sin(a) * r), q, new THREE.Vector3(sx, sy, sz));
    greeble.setMatrixAt(i, m4);
  }
  addPart(new THREE.Group().add(greeble), 'detalles');
  [-1, 1].forEach((s) => {
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 3, 8, 16), goldFoil);
    tank.rotation.z = Math.PI / 2;
    tank.position.set(-1, -1.9, s * 1.3);
    addPart(new THREE.Group().add(tank), `tanque-${s}`);
  });

  // Nombre en el casco
  const nameTex = canvasTex(1024, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = 'bold 84px Orbitron, Arial, sans-serif';
    g.fillStyle = 'rgba(25,30,40,0.92)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('U.S.S. AETHER  ·  AX-01', w / 2, h / 2);
  });
  [-1, 1].forEach((side) => {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(8, 1), new THREE.MeshStandardMaterial({ map: nameTex, transparent: true, roughness: 0.6, metalness: 0.3 }));
    plate.position.set(4, 0.6, side * 2.33);
    plate.rotation.y = side > 0 ? 0 : Math.PI;
    ship.children.find((c) => c.name === 'casco-2-' + (side > 0 ? 1 : 0))?.add(plate);
  });

  // Luces de navegación (rojo babor, verde estribor, estroboscópicas blancas)
  const navLights = [];
  const mkLight = (color, pos, blink) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color }));
    m.position.copy(pos);
    m.userData.blink = blink;
    m.userData.color = new THREE.Color(color);
    ship.add(m);
    navLights.push(m);
  };
  mkLight(0xff2020, new THREE.Vector3(-4.5, 0, -11.2), 0);
  mkLight(0x20ff40, new THREE.Vector3(-4.5, 0, 11.2), 0);
  mkLight(0xffffff, new THREE.Vector3(12.9, 0.3, 0), 1);
  mkLight(0xffffff, new THREE.Vector3(-8.5, 3.3, 0), 1.5);

  // ------------------------------------------------------------------ animación
  let t = 0;
  const cyan = new THREE.Color(0x38d9ff);
  const red = new THREE.Color(0xff2a10);
  function update(dt, { thrust = 0.6 } = {}) {
    t += dt;
    ringGroup.rotation.x += dt * 0.25;
    flameMat.uniforms.uTime.value = t;
    flameMat.uniforms.uPower.value = thrust;
    coreMat.emissive.copy(cyan).lerp(red, alert.value);
    coreMat.emissiveIntensity = 3 + alert.value * (1.5 + Math.sin(t * 8) * 1.5);
    flameMat.uniforms.uColor.value.set(0x66ccff).lerp(new THREE.Color(0xff6a20), alert.value * 0.6);
    engines.forEach((e) => {
      e.flame.scale.set(1, 0.6 + thrust * 0.8, 1);
      e.light.intensity = (2 + thrust * 8) * (0.9 + Math.random() * 0.2);
    });
    navLights.forEach((m) => {
      const on = m.userData.blink ? (t + m.userData.blink) % 1.6 < 0.08 : true;
      m.visible = on;
    });
  }

  return { ship, parts, update, heat, alert, windows, windowMat, engines, flameMat };
}
