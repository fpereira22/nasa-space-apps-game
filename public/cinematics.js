/**
 * ============================================================================
 * CINEMÁTICAS — menú principal, derrota y victoria (Three.js + postproceso)
 * ----------------------------------------------------------------------------
 *  Menú:     la U.S.S. Aether en órbita sobre un planeta realista, cámara lenta.
 *  Derrota:  silencio tenso -> puente en alerta roja -> primer plano del
 *            astronauta que se pone triste -> el reactor revienta y el fuego
 *            recorre el pasillo -> desde afuera la nave estalla en pedazos.
 *  Victoria: el núcleo pasa de rojo a cian, los motores se encienden y la nave se va.
 *
 * Postproceso: bloom (UnrealBloomPass) + gradación de cine (viñeta, grano,
 * aberración cromática, saturación, destello blanco y fundido a negro).
 * Música y efectos: window.AetherMusic (music.js).
 *
 * API (window.AetherCinema): available · showMenu() · startMission() · hide()
 *      playDefeat({ byStrikes }) · playVictory() · skip()   (las play* devuelven Promise)
 * ============================================================================
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createPlanet, NOISE_GLSL } from './cinema/planet.js';
import { buildShip } from './cinema/ship.js';
import { createFX } from './cinema/fx.js';
import { buildInterior } from './cinema/interior.js';
import { createStarfield, ORBIT } from './ship3d/world.js';

const Music = () => window.AetherMusic;
const sfx = (name, ...args) => {
  const m = Music();
  if (m && m.sfx[name]) m.sfx[name](...args);
};
const smooth = (x) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};
const lerp = THREE.MathUtils.lerp;

let renderer, composer, renderPass, bloom, grade, clock;
let space, interior;
let built = false;
let running = false;
let mode = 'off'; // 'menu' | 'timeline' | 'off'
let time = 0;
let timeScale = 1;
const shake = { amp: 0, decay: 2 };
let timeline = null;
const ui = {};

// ============================================================================
// Escena exterior
// ============================================================================
const SUN_DIR = new THREE.Vector3(...ORBIT.sun).normalize();

function buildMilkyWay() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(4500, 64, 32),
    new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vDir; ${NOISE_GLSL}
        void main(){
          vec3 d = normalize(vDir);
          vec3 bandN = normalize(vec3(0.3, 0.85, 0.42));
          float b = dot(d, bandN);
          float band = exp(-b*b*14.0);
          float n = fbm(d*3.0, 5)*0.5+0.5;
          float dust = smoothstep(0.45, 0.75, fbm(d*6.0+3.0, 4)*0.5+0.5);
          vec3 col = mix(vec3(0.10,0.12,0.22), vec3(0.32,0.24,0.20), n) * band * n * 0.3;
          col *= 1.0 - dust*0.8*band;
          // nebulosa de color lejos de la banda
          float neb = smoothstep(0.55, 0.9, fbm(d*1.7+11.0, 4)*0.5+0.5);
          col += vec3(0.25,0.06,0.18) * neb * 0.16 + vec3(0.03,0.12,0.2) * smoothstep(0.6,0.95, fbm(d*2.3-4.0,4)*0.5+0.5) * 0.14;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false
    })
  );
}

function glowSprite(color, size, opacity = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.08, 'rgba(255,250,235,0.9)');
  grad.addColorStop(0.25, 'rgba(255,220,170,0.25)');
  grad.addColorStop(1, 'rgba(255,200,150,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
  s.scale.set(size, size, 1);
  return s;
}

function buildSpace() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 20000);

  const sky = new THREE.Group();
  const stars = createStarfield();
  sky.add(buildMilkyWay(), stars.pts);
  const sun = glowSprite(0xfff4e0, 900);
  sun.position.copy(SUN_DIR).multiplyScalar(4000);
  const streak = glowSprite(0xbfd8ff, 1, 0.35);
  streak.scale.set(5200, 90, 1);
  streak.position.copy(sun.position);
  sky.add(sun, streak);
  scene.add(sky);

  const sunLight = new THREE.DirectionalLight(0xfff1dc, 3.2);
  sunLight.position.copy(SUN_DIR).multiplyScalar(100);
  scene.add(sunLight);
  // Luz reflejada por el planeta (azulada, desde abajo) + mínimo ambiente
  scene.add(new THREE.HemisphereLight(0x0a0c14, 0x2a5aa8, 0.55));

  const planet = createPlanet({ radius: ORBIT.radius, sunDir: SUN_DIR });
  planet.group.position.set(...ORBIT.position);
  scene.add(planet.group);

  const shipKit = buildShip();
  scene.add(shipKit.ship);
  shipKit.ship.rotation.y = 0.35;
  // Pivote de cada pieza en su centro (para que giren sobre sí mismas al volar)
  const box = new THREE.Box3();
  const c = new THREE.Vector3();
  shipKit.ship.updateMatrixWorld(true);
  const partState = shipKit.parts.map((p) => {
    box.setFromObject(p);
    box.getCenter(c);
    shipKit.ship.worldToLocal(c);
    p.children.forEach((ch) => ch.position.sub(c));
    p.position.add(c);
    return { p, pos0: p.position.clone(), rot0: p.rotation.clone(), v: new THREE.Vector3(), w: new THREE.Vector3(), trail: 0, size: box.getSize(new THREE.Vector3()).length() };
  });

  // Mapa de entorno para reflejos del metal: cielo negro, planeta azul abajo, sol
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: { uSun: { value: SUN_DIR } },
        vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uSun; varying vec3 vD; void main(){
          float down = smoothstep(0.05, -0.5, vD.y);
          vec3 c = vec3(0.12,0.28,0.55)*down*1.4 + vec3(0.5,0.6,0.8)*exp(-pow(vD.y+0.1,2.0)*40.0)*0.25;
          c += vec3(1.0,0.95,0.85)*pow(max(dot(vD,uSun),0.0), 200.0)*40.0;
          gl_FragColor = vec4(c,1.0); }`
      })
    )
  );
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;

  const fx = createFX(scene);
  return { scene, camera, sky, stars, planet, shipKit, partState, fx, sunLight };
}

// ============================================================================
// Montaje
// ============================================================================
function build() {
  if (built) return;
  built = true;
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const cv = renderer.domElement;
  cv.id = 'cinemaCanvas';
  cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:60;display:none;opacity:0;transition:opacity 1.2s ease';
  document.body.appendChild(cv);

  space = buildSpace();
  const interiorPlanet = createPlanet({ radius: ORBIT.radius, sunDir: SUN_DIR });
  interior = buildInterior({ planet: interiorPlanet });
  interior.planet = interiorPlanet;
  interior.camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.02, ORBIT.far);
  interior.fxs = createFX(interior.scene);
  interior.fxs.sparks.gravity = 6;

  composer = new EffectComposer(renderer);
  renderPass = new RenderPass(space.scene, space.camera);
  composer.addPass(renderPass);
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.5, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  grade = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uFade: { value: 0 },
      uGrain: { value: 0.045 },
      uVignette: { value: 0.55 },
      uAberr: { value: 0.012 },
      uSat: { value: 1 },
      uTint: { value: new THREE.Vector3(1, 1, 1) }
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uFlash, uFade, uGrain, uVignette, uAberr, uSat; uniform vec3 uTint;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        vec2 d = vUv - 0.5;
        float ab = uAberr * dot(d, d) * 4.0;
        vec3 c = vec3(texture2D(tDiffuse, vUv + d*ab).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - d*ab).b);
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(vec3(l), c, uSat) * uTint;
        c *= 1.0 - uVignette * smoothstep(0.35, 0.95, length(d * vec2(1.25, 1.0)) * 1.3);
        c += (hash(vUv * 731.0 + fract(uTime) * 91.0) - 0.5) * uGrain;
        c = mix(c, vec3(1.0, 0.98, 0.95), uFlash);
        c *= 1.0 - uFade;
        gl_FragColor = vec4(c, 1.0);
      }`
  });
  composer.addPass(grade);

  clock = new THREE.Clock();
  window.addEventListener('resize', resize);
  buildUI();
  resize();
  // Compilar shaders por adelantado (evita tirones al empezar cada escena)
  try {
    renderer.compile(space.scene, space.camera);
    renderer.compile(interior.scene, interior.camera);
  } catch (e) {}
}

function resize() {
  if (!renderer) return;
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  [space.camera, interior.camera].forEach((c) => {
    c.aspect = w / h;
    c.updateProjectionMatrix();
  });
  space.stars.uniforms.uPR.value = renderer.getPixelRatio();
  updatePointScale();
}

function currentCamera() {
  return renderPass.camera;
}

function updatePointScale() {
  const cam = currentCamera();
  const px = innerHeight * renderer.getPixelRatio();
  const s = px / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
  space.fx.setScale(s);
  interior.fxs.setScale(s);
}

function setScene(which) {
  if (which === 'space') {
    renderPass.scene = space.scene;
    renderPass.camera = space.camera;
  } else {
    renderPass.scene = interior.scene;
    renderPass.camera = interior.camera;
  }
  sceneName = which;
  updatePointScale();
}
let sceneName = 'space';

// ============================================================================
// Interfaz de cine (franjas, subtítulos, saltar)
// ============================================================================
function buildUI() {
  const style = document.createElement('style');
  style.textContent = `
  #cinemaUI{position:fixed;inset:0;z-index:62;pointer-events:none;display:none;font-family:'Share Tech Mono',monospace}
  #cinemaUI .bar{position:absolute;left:0;right:0;height:0;background:#000;transition:height 1.1s cubic-bezier(.6,0,.2,1)}
  #cinemaUI .bar.top{top:0} #cinemaUI .bar.bottom{bottom:0}
  #cinemaUI.letterbox .bar{height:11vh}
  #cinemaUI .chapter{position:absolute;top:calc(11vh + 18px);left:4vw;color:#cbd5e1;font-size:12px;letter-spacing:.3em;opacity:0;transition:opacity .8s}
  #cinemaUI .chapter.on{opacity:.85}
  #cinemaUI .caption{position:absolute;left:50%;bottom:calc(11vh + 26px);transform:translateX(-50%);max-width:min(860px,90vw);text-align:center;color:#f1f5f9;font-size:clamp(15px,2.1vw,22px);text-shadow:0 2px 8px #000,0 0 2px #000;opacity:0;transition:opacity .6s}
  #cinemaUI .caption.on{opacity:1}
  #cinemaUI .caption .who{display:block;font-size:11px;letter-spacing:.35em;color:#fbbf24;margin-bottom:4px}
  #cinemaUI .title{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;opacity:0;transition:opacity 1.4s}
  #cinemaUI .title.on{opacity:1}
  #cinemaUI .title h2{font-family:Orbitron,sans-serif;font-weight:900;letter-spacing:.45em;font-size:clamp(22px,4.4vw,54px);color:#fff;text-shadow:0 0 30px rgba(255,90,40,.6);margin:0;padding-left:.45em}
  #cinemaUI .title p{color:#94a3b8;letter-spacing:.4em;font-size:12px;margin-top:14px}
  #cinemaUI .skip{position:absolute;right:4vw;bottom:calc(11vh + 18px);pointer-events:auto;cursor:pointer;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.25);color:#cbd5e1;font-size:11px;letter-spacing:.25em;padding:6px 12px;border-radius:4px;opacity:0;transition:opacity .6s}
  #cinemaUI .skip.on{opacity:.8} #cinemaUI .skip:hover{opacity:1;border-color:#fbbf24;color:#fff}
  `;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'cinemaUI';
  root.innerHTML = `<div class="bar top"></div><div class="bar bottom"></div><div class="chapter"></div>
    <div class="caption"><span class="who"></span><span class="text"></span></div>
    <div class="title"><h2></h2><p></p></div>
    <button class="skip" type="button">SALTAR ▸ [ESC]</button>`;
  document.body.appendChild(root);
  ui.root = root;
  ui.chapter = root.querySelector('.chapter');
  ui.caption = root.querySelector('.caption');
  ui.who = root.querySelector('.who');
  ui.text = root.querySelector('.text');
  ui.title = root.querySelector('.title');
  ui.skip = root.querySelector('.skip');
  ui.skip.onclick = () => Cinema.skip();
  window.addEventListener(
    'keydown',
    (e) => {
      if (mode !== 'timeline') return;
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopImmediatePropagation();
        Cinema.skip();
      }
    },
    true
  );
}

function caption(who, text) {
  if (!text) {
    ui.caption.classList.remove('on');
    return;
  }
  ui.who.textContent = who || '';
  ui.text.textContent = text;
  ui.caption.classList.add('on');
}
function chapter(text) {
  ui.chapter.textContent = text || '';
  ui.chapter.classList.toggle('on', Boolean(text));
}
function bigTitle(h, p) {
  ui.title.querySelector('h2').textContent = h || '';
  ui.title.querySelector('p').textContent = p || '';
  ui.title.classList.toggle('on', Boolean(h));
}
function resetUI() {
  caption(null);
  chapter(null);
  bigTitle(null);
  ui.skip.classList.remove('on');
  ui.root.classList.remove('letterbox');
}

// ============================================================================
// Bucle
// ============================================================================
function start() {
  build();
  const cv = renderer.domElement;
  cv.style.display = 'block';
  ui.root.style.display = 'block';
  if (!running) {
    running = true;
    clock.getDelta();
    renderer.setAnimationLoop(frame);
  }
}

function stop() {
  if (!renderer) return;
  running = false;
  renderer.setAnimationLoop(null);
  renderer.domElement.style.display = 'none';
  renderer.domElement.style.opacity = '0';
  ui.root.style.display = 'none';
  resetUI();
  mode = 'off';
}

const _v = new THREE.Vector3();
function frame() {
  // Tiempo real (hasta 0,1 s por cuadro): la cinemática dura lo mismo en equipos lentos
  const dt = Math.min(0.1, clock.getDelta());
  if (!paused) simulate(dt);
  if (sceneName === 'space') space.sky.position.copy(space.camera.position);
  grade.uniforms.uTime.value = time;
  composer.render(dt);
  // El fundido empieza con una imagen renderizada, nunca con el canvas vacío.
  if (running && renderer.domElement.style.opacity === '0') renderer.domElement.style.opacity = '1';
}
let paused = false;

function simulate(dt) {
  time += dt;
  const sdt = dt * timeScale;

  if (timeline) runTimeline(dt);
  else if (mode === 'menu') menuCamera(dt);

  if (sceneName === 'space') {
    space.planet.update(sdt);
    space.stars.uniforms.uTime.value = time;
    space.shipKit.update(sdt, { thrust: shipState.thrust });
    updateParts(sdt);
    space.fx.update(sdt);
    space.shipKit.ship.position.x += shipState.speed * sdt;
  } else {
    interior.update(sdt, time);
    interior.planet.update(sdt);
    interior.fxs.update(sdt);
  }

  // Temblor de cámara
  const cam = currentCamera();
  if (shake.amp > 0.0005) {
    cam.position.x += (Math.random() - 0.5) * shake.amp;
    cam.position.y += (Math.random() - 0.5) * shake.amp;
    cam.rotation.z += (Math.random() - 0.5) * shake.amp * 0.06;
    shake.amp *= Math.exp(-shake.decay * dt);
  }
}

function runTimeline(dt) {
  const tl = timeline;
  const sh = tl.shots[tl.i];
  tl.t += dt;
  sh.update && sh.update(tl.t, dt);
  if (tl.t >= sh.dur) {
    tl.i++;
    tl.t = 0;
    if (tl.i >= tl.shots.length) {
      timeline = null;
      tl.resolve();
    } else tl.shots[tl.i].enter && tl.shots[tl.i].enter();
  }
}

function playTimeline(shots) {
  return new Promise((resolve) => {
    mode = 'timeline';
    timeline = { shots, i: 0, t: 0, resolve };
    shots[0].enter && shots[0].enter();
  });
}

// ============================================================================
// Nave: estado, piezas que vuelan
// ============================================================================
const shipState = { thrust: 0.6, speed: 0, exploded: false };

function resetShip() {
  const k = space.shipKit;
  k.ship.position.set(0, 0, 0);
  k.ship.rotation.set(0, 0.35, 0);
  k.heat.value = 0;
  k.alert.value = 0;
  k.windowMat.emissiveIntensity = 2.2;
  k.windows.forEach((w) => (w.visible = true));
  k.ship.children.forEach((c) => (c.visible = true));
  space.partState.forEach((s) => {
    s.p.position.copy(s.pos0);
    s.p.rotation.copy(s.rot0);
    s.v.set(0, 0, 0);
    s.w.set(0, 0, 0);
    s.trail = 0;
    s.p.visible = true;
  });
  shipState.thrust = 0.6;
  shipState.speed = 0;
  shipState.exploded = false;
  space.fx.reset();
  space.planet.uniforms.uFlash.value = 0;
  timeScale = 1;
  shake.amp = 0;
}

const CORE = new THREE.Vector3(-4, 0, 0); // punto de la detonación (local de la nave)
function explodeShip() {
  const k = space.shipKit;
  shipState.exploded = true;
  shipState.thrust = 0;
  k.windows.forEach((w) => (w.visible = false));
  k.ship.children.forEach((c) => {
    if (c.isMesh) c.visible = false; // luces de navegación
  });
  space.partState.forEach((s) => {
    const dir = _v.copy(s.p.position).sub(CORE);
    if (dir.lengthSq() < 0.01) dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    dir.normalize();
    s.v.copy(dir).multiplyScalar(5 + Math.random() * 10 + 30 / (2 + s.size));
    s.v.x += (Math.random() - 0.5) * 4;
    s.v.y += (Math.random() - 0.5) * 4;
    s.v.z += (Math.random() - 0.5) * 4;
    s.w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2.2);
    s.trail = 1;
  });
}

const _wp = new THREE.Vector3();
function updateParts(dt) {
  if (!shipState.exploded) return;
  const k = space.shipKit;
  k.heat.value = Math.max(0, k.heat.value - dt * 0.12);
  space.partState.forEach((s) => {
    s.p.position.addScaledVector(s.v, dt);
    s.p.rotation.x += s.w.x * dt;
    s.p.rotation.y += s.w.y * dt;
    s.p.rotation.z += s.w.z * dt;
    if (s.trail > 0) {
      s.trail = Math.max(0, s.trail - dt * 0.18);
      s.p.getWorldPosition(_wp);
      const n = Math.random() < s.trail * 3 * dt * 60 ? 1 : 0;
      if (n) {
        const back = _v.copy(s.v).multiplyScalar(-0.15);
        space.fx.fire.emit(_wp, back, { life: 0.5 + s.trail * 0.8, size: 0.6 + s.size * 0.12 * s.trail, grow: 2, drag: 1 });
        space.fx.smoke.emit(_wp, back, { life: 2.5, size: 0.8 + s.size * 0.12, grow: 3, drag: 0.6 });
      }
    }
  });
}

// ============================================================================
// Menú principal
// ============================================================================
const menuCam = { t: 0, intro: 0 };
const MENU_TARGET = new THREE.Vector3(-1, -1.5, 0);
function menuCamera(dt) {
  menuCam.t += dt;
  menuCam.intro = Math.min(1, menuCam.intro + dt / 6);
  const e = 1 - Math.pow(1 - menuCam.intro, 3);
  const t = menuCam.t;
  const a = 0.95 + Math.sin(t * 0.045) * 0.3;
  const r = lerp(70, 38, e);
  const cam = space.camera;
  cam.position.set(Math.sin(a) * r, lerp(18, 7, e) + Math.sin(t * 0.13) * 1.2, Math.cos(a) * r);
  // La nave queda a la derecha (el menú va a la izquierda)
  const right = _v.set(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(-9 * (innerWidth > 800 ? 1 : 0));
  cam.lookAt(MENU_TARGET.x + right.x, MENU_TARGET.y, MENU_TARGET.z + right.z);
  cam.rotation.z += Math.sin(t * 0.21) * 0.01;
}

// ============================================================================
// Cinemática de derrota
// ============================================================================
function defeatShots({ byStrikes }) {
  const I = interior;
  const G = grade.uniforms;
  const cam = I.camera;
  let hb = 0;
  let popsDone = 0;
  let detonated = false;
  const popPoints = [new THREE.Vector3(6, 1.8, 1), new THREE.Vector3(-2, -1.5, 2), new THREE.Vector3(9, 0.5, -1.8), new THREE.Vector3(-7, 1, -2)];
  const head = new THREE.Vector3();

  return [
    // A — Silencio tenso, luego el puente en alerta roja visto desde atrás del astronauta
    {
      dur: 4.4,
      enter() {
        setScene('interior');
        I.reset();
        I.fxs.reset();
        I.pose.handsUp = 1;
        G.uFade.value = 1;
        G.uFlash.value = 0;
        G.uSat.value = 0.85;
        G.uTint.value.set(1.05, 0.95, 0.92);
        bloom.strength = 0.7;
        ui.root.classList.add('letterbox');
        Music() && Music().play('suspense');
        sfx('impact', 0.8);
        sfx('tinnitus', 6, 0.02);
        setTimeout(() => sfx('alarm', 4, 0.025), 900);
        chapter('U.S.S. AETHER  ·  PUENTE DE MANDO  ·  ' + (byStrikes ? 'FALLA EN CADENA' : 'TIEMPO AGOTADO'));
        setTimeout(() => ui.skip.classList.add('on'), 1200);
      },
      update(t) {
        G.uFade.value = 1 - smooth((t - 0.5) / 1.6);
        const k = smooth(t / 4.4);
        cam.position.set(lerp(2.1, 1.35, k), lerp(2.05, 1.85, k), lerp(1.4, 0.15, k));
        cam.lookAt(-0.3, 1.35, -4.5);
        I.pose.handsUp = 1 - smooth((t - 1.6) / 1.4);
        I.pose.slump = smooth((t - 2.2) / 1.8);
        I.pose.headDown = smooth((t - 2.6) / 1.6) * 0.6;
      }
    },
    // B — Primer plano: el astronauta se quiebra
    {
      dur: 5.6,
      enter() {
        chapter(null);
        hb = 0;
        I.face.state.lookDown = 0.3;
      },
      update(t, dt) {
        head.copy(I.points.head());
        const k = smooth(t / 5.6);
        cam.position.set(head.x + lerp(0.2, 0.08, k), head.y + lerp(-0.04, -0.02, k), head.z - lerp(0.62, 0.42, k));
        cam.lookAt(head.x, head.y - 0.02, head.z);
        const f = I.face.state;
        f.sad = smooth(t / 2.6);
        f.lookDown = 0.3 + smooth((t - 2) / 2) * 0.5;
        f.blink = t > 1.0 && t < 1.14 ? 1 : 0;
        f.quiver = smooth((t - 2.2) / 1) * (1 - smooth((t - 4.5) / 1));
        f.tear = t > 2.6 ? (t - 2.6) / 2.4 : -1;
        f.closed = smooth((t - 4.6) / 0.8) * 0.85;
        I.pose.headDown = 0.6 + smooth((t - 3) / 2) * 0.4;
        hb += dt;
        if (hb > 1.15) {
          hb = 0;
          sfx('heartbeat', 0.5);
        }
        if (t > 1.3 && t < 1.35) caption('ASTRONAUTA', 'Control… lo siento. No pude detenerlo.');
        if (t > 4.4 && t < 4.45) caption(null);
      }
    },
    // C — El reactor revienta al fondo del pasillo y el fuego avanza hacia él
    {
      dur: 3.6,
      enter() {
        sfx('groan', 2.4, 0.14);
        detonated = false;
        shake.decay = 0.5;
      },
      update(t, dt) {
        const k = smooth(t / 3.6);
        cam.position.set(lerp(1.0, 0.75, k), lerp(1.5, 1.45, k), lerp(-3.05, -3.2, k));
        cam.lookAt(0.1, 1.35, 8);
        const glow = smooth(t / 1.8);
        I.setDoorGlow(glow);
        I.fx.stripMat.emissiveIntensity = Math.random() < 0.25 + glow * 0.3 ? 0.1 : 2;
        shake.amp = Math.max(shake.amp, glow * 0.025);
        if (!detonated && t > 1.8) {
          detonated = true;
          sfx('fireRush', 1.4, 0.55);
          sfx('pop', 0.5);
          interior.fxs.flash(I.points.door, { size: 6, dur: 0.5, peak: 0.8, lightPower: 60, lightColor: 0xffb070 });
          interior.fxs.burst(I.points.door, { count: 120, speed: 4, size: 0.6, life: 0.8, smokeCount: 30, sparkCount: 160, sparkSpeed: 14 });
          shake.amp = 0.08;
        }
        if (detonated) {
          const front = (t - 1.8) * 9;
          const origin = _v.copy(I.points.door);
          interior.fxs.jet(origin, I.points.corridorDir, { count: 10, speed: 13, spread: 0.3, size: 0.55, life: 1.1, smokeRatio: 0.5 });
          I.fx.doorLight.position.z = I.points.door.z - front;
          I.fx.doorLight.intensity = 40;
          I.fx.screenLight.intensity = 0;
          shake.amp = Math.max(shake.amp, 0.04 + (t - 1.8) * 0.04);
        }
        G.uFlash.value = smooth((t - 3.0) / 0.6);
      }
    },
    // D — Blanco y silencio absoluto
    {
      dur: 0.9,
      enter() {
        G.uFlash.value = 1;
        Music() && Music().stop(0.15);
        caption(null);
      }
    },
    // E — Afuera: la nave estalla
    {
      dur: 8.5,
      enter() {
        setScene('space');
        resetShip();
        space.shipKit.alert.value = 1;
        shipState.thrust = 0.25;
        G.uSat.value = 1;
        G.uTint.value.set(1, 1, 1);
        bloom.strength = 0.9;
        popsDone = 0;
        detonated = false;
        shake.decay = 1.2;
      },
      update(t, dt) {
        G.uFlash.value = 1 - smooth(t / 0.7);
        const k = smooth(t / 8.5);
        const c = space.camera;
        c.position.set(lerp(-30, -42, k), lerp(8, 12, k), lerp(36, 60, k));
        c.lookAt(lerp(0, -4, k), lerp(-1, -3, k), 0);
        const ship = space.shipKit;
        if (!detonated) {
          ship.windowMat.emissiveIntensity = 2 + (Math.random() < 0.3 ? 6 : 0);
          if (popsDone < popPoints.length && t > 0.7 + popsDone * 0.35) {
            const p = ship.ship.localToWorld(popPoints[popsDone].clone());
            space.fx.burst(p, { count: 90, speed: 6, size: 1.2, life: 1.2, smokeCount: 30, sparkCount: 80, sparkSpeed: 18 });
            space.fx.flash(p, { size: 18, dur: 0.5, peak: 0.5, lightPower: 300 });
            sfx('pop', 0.3);
            shake.amp = 0.4;
            popsDone++;
          }
        }
        if (!detonated && t > 2.2) {
          detonated = true;
          const center = ship.ship.localToWorld(CORE.clone());
          sfx('explosion', 1);
          space.fx.flash(center, { size: 150, dur: 2.2, peak: 0.9, lightPower: 6000, lightColor: 0xffb070 });
          space.fx.burst(center, { count: 1100, speed: 22, size: 3.4, life: 3.2, smokeCount: 450, sparkCount: 700, sparkSpeed: 55 });
          space.fx.shockwave(center, { size: 260, dur: 4.5 });
          space.fx.debris(center, { speed: 26, size: 0.9 });
          ship.heat.value = 1;
          explodeShip();
          space.planet.uniforms.uFlashDir.value.copy(center).sub(space.planet.group.position).normalize();
          shake.amp = 2.2;
          G.uFlash.value = 0.85;
        }
        if (detonated) {
          const since = t - 2.2;
          G.uFlash.value = Math.max(G.uFlash.value * Math.exp(-dt * 7), 0);
          space.planet.uniforms.uFlash.value = Math.max(0, 1 - since / 3);
          // Cámara lenta tras el estallido
          timeScale = since < 0.25 ? 1 : since < 2.4 ? 0.35 : Math.min(1, 0.35 + (since - 2.4) * 0.6);
          if (since < 1.2 && Math.random() < 0.5) {
            const center = ship.ship.localToWorld(CORE.clone());
            space.fx.burst(center, { count: 25, speed: 10, size: 3.5, life: 2.2, smokeCount: 8, sparkCount: 10, sparkSpeed: 30 });
          }
          if (since > 3.2 && Music() && Music().current !== 'defeat') Music().play('defeat', { fade: 5 });
        }
      }
    },
    // F — Escombros a la deriva. Señal perdida.
    {
      dur: 6,
      enter() {
        timeScale = 1;
      },
      update(t) {
        const c = space.camera;
        c.position.x -= 0.02;
        c.position.z += 0.05;
        c.lookAt(-4, -3, 0);
        if (t > 0.6 && t < 0.65) bigTitle('SEÑAL PERDIDA', 'U.S.S. AETHER  ·  TRIPULACIÓN: 1  ·  SUPERVIVIENTES: 0');
        G.uFade.value = smooth((t - 4.6) / 1.4);
      }
    }
  ];
}

// ============================================================================
// Cinemática de victoria
// ============================================================================
function victoryShots() {
  const G = grade.uniforms;
  let lit = false;
  return [
    {
      dur: 3.6,
      enter() {
        setScene('space');
        resetShip();
        space.shipKit.alert.value = 1;
        G.uFade.value = 1;
        G.uFlash.value = 0;
        G.uSat.value = 1;
        G.uTint.value.set(1, 1, 1);
        bloom.strength = 0.8;
        ui.root.classList.add('letterbox');
        Music() && Music().play('victory', { fade: 0.5 });
        setTimeout(() => ui.skip.classList.add('on'), 800);
        chapter('U.S.S. AETHER  ·  ÓRBITA ESTABLE');
      },
      update(t) {
        G.uFade.value = 1 - smooth(t / 0.9);
        const c = space.camera;
        const a = -2.2 + t * 0.12;
        c.position.set(-8 + Math.sin(a) * 22, 4, Math.cos(a) * 22);
        c.lookAt(-7, 0, 0);
        space.shipKit.alert.value = 1 - smooth((t - 0.8) / 1.6);
        if (t > 1.2 && t < 1.25) caption('AETHER', 'Núcleo estabilizado. Todos los sistemas en estado nominal.');
      }
    },
    {
      dur: 5,
      enter() {
        caption(null);
        lit = false;
      },
      update(t, dt) {
        const c = space.camera;
        c.position.set(-40, 6, 26);
        const ship = space.shipKit.ship;
        c.lookAt(ship.position.x * 0.6 - 2, 0, 0);
        if (!lit && t > 0.5) {
          lit = true;
          sfx('engine', 0.35, 4);
        }
        shipState.thrust = t < 0.5 ? 0.6 : lerp(0.6, 2.2, smooth((t - 0.5) / 1.2));
        shipState.speed = t < 1.2 ? 0 : Math.pow(t - 1.2, 2.2) * 9;
        shake.amp = Math.max(shake.amp, t > 0.6 && t < 2 ? 0.15 : 0);
        if (t > 3.6 && t < 3.65) {
          space.fx.flash(ship.position.clone().add(new THREE.Vector3(14, 0, 0)), { size: 160, dur: 1, peak: 1, lightPower: 0, lightColor: 0x9be7ff });
          sfx('whoosh', 0.3, 1);
        }
        if (t > 2.2 && t < 2.25) bigTitle('MISIÓN CUMPLIDA', 'LA U.S.S. AETHER VUELVE A CASA');
        G.uFade.value = smooth((t - 4.1) / 0.9);
      }
    }
  ];
}

// ============================================================================
// API
// ============================================================================
function cleanupAfterTimeline() {
  grade.uniforms.uFlash.value = 0;
  timeScale = 1;
  shake.amp = 0;
  resetUI();
}

const Cinema = {
  available: true,

  showMenu() {
    start();
    timeline = null;
    mode = 'menu';
    resetUI();
    setScene('space');
    resetShip();
    grade.uniforms.uFade.value = 0;
    grade.uniforms.uFlash.value = 0;
    grade.uniforms.uSat.value = 1;
    grade.uniforms.uTint.value.set(1, 1, 1);
    bloom.strength = 0.5;
    menuCam.t = 0;
    menuCam.intro = 0;
  },

  // Transición del menú al juego: acercamiento rápido a la nave y fundido
  startMission() {
    if (!running) return Promise.resolve();
    const from = space.camera.position.clone();
    const G = grade.uniforms;
    sfx('whoosh', 0.3, 1.3);
    return playTimeline([
      {
        dur: 1.3,
        update(t) {
          const k = smooth(t / 1.3);
          const to = new THREE.Vector3(10, 1.5, 6);
          space.camera.position.lerpVectors(from, to, k * k);
          space.camera.lookAt(lerp(-1, 9, k), lerp(-1.5, 0.5, k), 0);
          G.uFade.value = smooth((t - 0.6) / 0.7);
        }
      }
    ]).then(() => {
      cleanupAfterTimeline();
      stop();
    });
  },

  playDefeat(opts = {}) {
    start();
    return playTimeline(defeatShots(opts)).then(() => {
      cleanupAfterTimeline();
      setScene('space');
    });
  },

  playVictory() {
    start();
    return playTimeline(victoryShots()).then(() => {
      cleanupAfterTimeline();
      setScene('space');
    });
  },

  // Saltar: va al final del plano actual con un fundido corto
  skip() {
    if (!timeline) return;
    const tl = timeline;
    const G = grade.uniforms;
    const fade0 = G.uFade.value;
    if (Music() && Music().current && Music().current !== 'defeat' && Music().current !== 'victory') {
      Music().play(tl.shots.length > 3 ? 'defeat' : 'victory', { fade: 1.5 });
    }
    timeline = {
      shots: [
        {
          dur: 0.5,
          update(t) {
            G.uFade.value = Math.max(fade0, smooth(t / 0.5));
          }
        }
      ],
      i: 0,
      t: 0,
      resolve: tl.resolve
    };
  },

  // Fondo de la pantalla final (la nave destruida o alejándose) detrás del cartel
  holdBackdrop(victory) {
    if (!running) return;
    mode = 'menu-static';
    grade.uniforms.uFade.value = 0.55;
    const c = space.camera;
    if (victory) resetShip();
    c.position.set(-34, 9, 52);
    c.lookAt(-4, -3, 0);
  },

  hide() {
    timeline = null;
    stop();
  }
};

// Verificar WebGL
try {
  const test = document.createElement('canvas');
  if (!(test.getContext('webgl2') || test.getContext('webgl'))) throw new Error('sin WebGL');
  window.AetherCinema = Cinema;
} catch (e) {
  window.AetherCinema = { available: false };
}
// Para pruebas: encuadrar planos a mano desde la consola
window.__cinemaDebug = {
  // Salta al plano i de la cinemática en curso, en el segundo t (pasando por los anteriores)
  // Salta al plano i de la cinemática en curso y simula t segundos a 30 cuadros/s (congela el reloj)
  seek(i, t = 0) {
    if (!timeline) return 'sin cinemática';
    paused = true;
    const tl = timeline;
    for (let k = tl.i + 1; k <= i; k++) tl.shots[k].enter && tl.shots[k].enter();
    tl.i = i;
    tl.t = 0;
    for (let s = 0; s < t; s += 1 / 30) simulate(1 / 30);
    return 'ok';
  },
  advance(t) {
    paused = true;
    for (let s = 0; s < t; s += 1 / 30) simulate(1 / 30);
    return 'ok';
  },
  resume() {
    paused = false;
  },
  setScene, get interior() { return interior; }, get space() { return space; }, get grade() { return grade; }, shots: { defeatShots, victoryShots } };
window.dispatchEvent(new Event('cinema-ready'));
