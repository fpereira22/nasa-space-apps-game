/**
 * Efectos de explosión: fuego y humo (partículas con shader), chispas (líneas),
 * onda expansiva, destello y escombros incandescentes.
 */
import * as THREE from 'three';

const particleVert = /* glsl */ `
attribute float aSize;
attribute float aLife;
attribute float aSeed;
uniform float uScale;
varying float vLife;
varying float vSeed;
void main(){
  vLife = aLife;
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aLife >= 1.0 ? 0.0 : aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const fireFrag = /* glsl */ `
varying float vLife;
varying float vSeed;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float r = length(uv) * 2.0;
  float n = vnoise(uv*5.0 + vSeed*17.0) * 0.6 + vnoise(uv*11.0 - vSeed*9.0) * 0.4;
  float shape = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.7);
  if (shape <= 0.001) discard;
  float l = vLife;
  vec3 c = mix(vec3(1.0,0.92,0.75)*2.2, vec3(1.0,0.55,0.15)*1.6, smoothstep(0.0, 0.15, l));
  c = mix(c, vec3(0.8,0.2,0.04)*0.9, smoothstep(0.15, 0.45, l));
  c = mix(c, vec3(0.15,0.04,0.02)*0.4, smoothstep(0.5, 1.0, l));
  float a = shape * (1.0 - smoothstep(0.55, 1.0, l)) * (0.55 + 0.45*n) * 0.45;
  gl_FragColor = vec4(c * a, a);
}`;

const smokeFrag = /* glsl */ `
uniform vec3 uLightColor;
varying float vLife;
varying float vSeed;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float r = length(uv) * 2.0;
  float n = vnoise(uv*4.0 + vSeed*13.0) * 0.6 + vnoise(uv*9.0 + vSeed*5.0) * 0.4;
  float shape = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.8);
  if (shape <= 0.001) discard;
  float a = shape * smoothstep(0.0, 0.1, vLife) * (1.0 - smoothstep(0.4, 1.0, vLife)) * 0.55;
  vec3 c = mix(vec3(0.05,0.045,0.04), uLightColor, (1.0 - vLife) * 0.35) * (0.6 + 0.4*n);
  gl_FragColor = vec4(c, a);
}`;

class ParticleSystem {
  constructor(max, frag, blending) {
    this.max = max;
    this.count = 0;
    this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.life = new Float32Array(max).fill(1);
    this.dur = new Float32Array(max).fill(1);
    this.drag = new Float32Array(max);
    this.rise = new Float32Array(max);
    this.seed = new Float32Array(max);
    for (let i = 0; i < max; i++) this.seed[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    this.uniforms = { uScale: { value: 500 }, uLightColor: { value: new THREE.Color(0xff8a40) } };
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: particleVert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending
      })
    );
    this.points.frustumCulled = false;
  }

  emit(p, v, { life = 1.5, size = 1, grow = 2, drag = 1, rise = 0 } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.size0[i] = size;
    this.size[i] = size;
    this.grow[i] = grow;
    this.life[i] = 0;
    this.dur[i] = life;
    this.drag[i] = drag;
    this.rise[i] = rise;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] >= 1) continue;
      this.life[i] = Math.min(1, this.life[i] + dt / this.dur[i]);
      const k = Math.exp(-this.drag[i] * dt);
      const j = i * 3;
      this.vel[j] *= k;
      this.vel[j + 1] = this.vel[j + 1] * k + this.rise[i] * dt;
      this.vel[j + 2] *= k;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      this.size[i] = this.size0[i] * (1 + this.grow[i] * Math.sqrt(this.life[i]));
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aLife.needsUpdate = true;
  }

  clear() {
    this.life.fill(1);
    this.points.geometry.attributes.aLife.needsUpdate = true;
  }
}

class Sparks {
  constructor(max) {
    this.max = max;
    this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max).fill(1);
    this.dur = new Float32Array(max).fill(1);
    this.line = new Float32Array(max * 6);
    this.col = new Float32Array(max * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.line, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.lines.frustumCulled = false;
    this.gravity = 0;
  }
  emit(p, v, life = 1.2) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.life[i] = 0;
    this.dur[i] = life;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      const j = i * 3;
      const o = i * 6;
      if (this.life[i] >= 1) {
        this.col.fill(0, o, o + 6);
        continue;
      }
      this.life[i] = Math.min(1, this.life[i] + dt / this.dur[i]);
      this.vel[j + 1] -= this.gravity * dt;
      for (let a = 0; a < 3; a++) this.pos[j + a] += this.vel[j + a] * dt;
      const tail = 0.035;
      for (let a = 0; a < 3; a++) {
        this.line[o + a] = this.pos[j + a];
        this.line[o + 3 + a] = this.pos[j + a] - this.vel[j + a] * tail;
      }
      const b = (1 - this.life[i]) * 3;
      this.col.set([b, b * 0.7, b * 0.35, b * 0.5, b * 0.15, 0], o);
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
  }
  clear() {
    this.life.fill(1);
  }
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.15, 'rgba(255,240,210,0.85)');
  grad.addColorStop(0.4, 'rgba(255,170,80,0.3)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createFX(scene) {
  const fire = new ParticleSystem(5000, fireFrag, THREE.AdditiveBlending);
  const smoke = new ParticleSystem(2500, smokeFrag, THREE.NormalBlending);
  const sparks = new Sparks(1500);
  scene.add(smoke.points, fire.points, sparks.lines);
  fire.points.renderOrder = 3;
  sparks.lines.renderOrder = 4;

  const glowTex = glowTexture();
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  flash.renderOrder = 5;
  scene.add(flash);
  const light = new THREE.PointLight(0xffaa66, 0, 0, 1.6);
  scene.add(light);

  // Onda expansiva: anillo plano + cáscara esférica
  const ringMat = new THREE.ShaderMaterial({
    uniforms: { uAlpha: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform float uAlpha; varying vec2 vUv;
      void main(){ float r = length(vUv-0.5)*2.0; float band = smoothstep(0.75,0.97,r)*smoothstep(1.0,0.97,r);
        float inner = smoothstep(0.2,0.97,r)*0.15;
        vec3 c = mix(vec3(1.0,0.6,0.3), vec3(0.6,0.8,1.0), r);
        gl_FragColor = vec4(c*(band*3.0+inner)*uAlpha, 1.0); }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ringMat);
  ring.visible = false;
  scene.add(ring);
  const shellMat = new THREE.ShaderMaterial({
    uniforms: { uAlpha: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform float uAlpha; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(vec3(1.0,0.75,0.5)*f*uAlpha*2.0, 1.0); }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), shellMat);
  shell.visible = false;
  scene.add(shell);

  // Escombros incandescentes
  const DEBRIS = 260;
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.7, roughness: 0.5, emissive: 0xff5a10, emissiveIntensity: 0 });
  const debris = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), debrisMat, DEBRIS);
  debris.frustumCulled = false;
  debris.visible = false;
  scene.add(debris);
  const dState = Array.from({ length: DEBRIS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), s: 1 }));
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();

  const tmpV = new THREE.Vector3();
  const tmpP = new THREE.Vector3();
  const randDir = (out) => {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    return out.set(Math.cos(th) * s, u, Math.sin(th) * s);
  };

  let flashT = 99;
  let flashDur = 1;
  let flashSize = 100;
  let flashPeak = 1;
  let shockT = 99;
  let shockSize = 100;
  let shockDur = 3;
  let debrisT = 99;

  const fx = {
    fire,
    smoke,
    sparks,
    light,
    setScale(px) {
      fire.uniforms.uScale.value = px;
      smoke.uniforms.uScale.value = px;
    },
    // Bola de fuego en un punto
    burst(center, { count = 300, speed = 20, size = 3, life = 2.2, smokeCount = 120, sparkCount = 200, sparkSpeed = 40 } = {}) {
      for (let i = 0; i < count; i++) {
        randDir(tmpV).multiplyScalar(speed * (0.2 + Math.pow(Math.random(), 0.6)));
        fire.emit(center, tmpV, { life: life * (0.5 + Math.random() * 0.7), size: size * (0.5 + Math.random()), grow: 2.5, drag: 1.6 });
      }
      for (let i = 0; i < smokeCount; i++) {
        randDir(tmpV).multiplyScalar(speed * 0.6 * Math.random());
        smoke.emit(center, tmpV, { life: life * 2.5 * (0.6 + Math.random() * 0.6), size: size * 1.4, grow: 3, drag: 0.9 });
      }
      for (let i = 0; i < sparkCount; i++) {
        randDir(tmpV).multiplyScalar(sparkSpeed * (0.3 + Math.random()));
        sparks.emit(center, tmpV, 0.6 + Math.random() * 1.4);
      }
    },
    // Chorro direccional (fuego que sale por una grieta o avanza por un pasillo)
    jet(origin, dir, { count = 20, speed = 15, spread = 0.4, size = 1, life = 1, smokeRatio = 0.3 } = {}) {
      for (let i = 0; i < count; i++) {
        randDir(tmpV).multiplyScalar(spread).add(dir).normalize().multiplyScalar(speed * (0.6 + Math.random() * 0.6));
        tmpP.copy(origin);
        fire.emit(tmpP, tmpV, { life: life * (0.6 + Math.random() * 0.6), size: size * (0.6 + Math.random() * 0.8), grow: 2, drag: 1.2 });
        if (Math.random() < smokeRatio) smoke.emit(tmpP, tmpV.multiplyScalar(0.6), { life: life * 2.2, size: size * 1.3, grow: 2.5, drag: 0.8 });
      }
    },
    flash(pos, { size = 200, dur = 1.2, peak = 1, lightPower = 4e5, lightColor = 0xffaa66 } = {}) {
      flash.position.copy(pos);
      light.position.copy(pos);
      light.color.set(lightColor);
      flashT = 0;
      flashDur = dur;
      flashSize = size;
      flashPeak = peak;
      light.userData.power = lightPower;
    },
    shockwave(pos, { size = 200, dur = 3, tilt = new THREE.Euler(-Math.PI / 2 + 0.25, 0, 0.15) } = {}) {
      ring.position.copy(pos);
      ring.rotation.copy(tilt);
      shell.position.copy(pos);
      shockT = 0;
      shockSize = size;
      shockDur = dur;
      ring.visible = shell.visible = true;
    },
    debris(pos, { speed = 30, size = 0.6 } = {}) {
      debris.visible = true;
      debrisT = 0;
      dState.forEach((d) => {
        d.p.copy(pos).add(randDir(tmpV).multiplyScalar(Math.random() * 3));
        randDir(d.v).multiplyScalar(speed * (0.2 + Math.random()));
        d.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        d.w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(8);
        d.s = size * (0.15 + Math.pow(Math.random(), 3) * 1.6);
      });
    },
    update(dt) {
      fire.update(dt);
      smoke.update(dt);
      sparks.update(dt);
      // Destello
      flashT += dt;
      if (flashT < flashDur) {
        const k = flashT / flashDur;
        const a = flashPeak * (k < 0.04 ? k / 0.04 : Math.pow(1 - (k - 0.04) / 0.96, 2.2));
        flash.material.opacity = Math.min(1, a);
        flash.scale.setScalar(flashSize * (0.6 + k * 0.8));
        light.intensity = light.userData.power * a;
      } else {
        flash.material.opacity = 0;
        light.intensity = 0;
      }
      // Onda expansiva
      shockT += dt;
      if (shockT < shockDur) {
        const k = shockT / shockDur;
        const r = shockSize * (1 - Math.pow(1 - k, 3));
        ring.scale.setScalar(r);
        shell.scale.setScalar(r * 0.55);
        ringMat.uniforms.uAlpha.value = Math.pow(1 - k, 1.5);
        shellMat.uniforms.uAlpha.value = Math.pow(1 - k, 2) * 0.8;
      } else {
        ring.visible = shell.visible = false;
      }
      // Escombros
      if (debris.visible) {
        debrisT += dt;
        debrisMat.emissiveIntensity = Math.max(0, 4 * (1 - debrisT / 4));
        dState.forEach((d, i) => {
          d.p.addScaledVector(d.v, dt);
          d.r.x += d.w.x * dt;
          d.r.y += d.w.y * dt;
          d.r.z += d.w.z * dt;
          _q.setFromEuler(d.r);
          _s.setScalar(d.s);
          _m.compose(d.p, _q, _s);
          debris.setMatrixAt(i, _m);
        });
        debris.instanceMatrix.needsUpdate = true;
      }
    },
    reset() {
      fire.clear();
      smoke.clear();
      sparks.clear();
      flashT = shockT = 99;
      ring.visible = shell.visible = false;
      debris.visible = false;
      flash.material.opacity = 0;
      light.intensity = 0;
    }
  };
  return fx;
}
