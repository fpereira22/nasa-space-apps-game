/**
 * Planeta realista generado por shader (sin texturas):
 *  - Continentes con ruido fractal 3D (sin costuras), relieve sombreado según el sol
 *  - Océano con profundidad y reflejo especular del sol (sunglint)
 *  - Casquetes polares, desiertos, selvas y montañas nevadas según latitud y altura
 *  - Nubes animadas con sombra sobre la superficie
 *  - Luces de ciudades en el lado nocturno
 *  - Atmósfera con dispersión: borde azul de día, anaranjado en el terminador
 */
import * as THREE from 'three';

export const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p, int oct){
  float a=0.5, s=0.0;
  for(int i=0;i<7;i++){ if(i>=oct) break; s+=a*snoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; }
  return s;
}
`;

const surfaceVert = /* glsl */ `
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
void main(){
  vObj = normalize(position);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const surfaceFrag = /* glsl */ `
uniform vec3 uSunDir;
uniform float uTime;
uniform float uFlash;      // destello de la explosión (ilumina el planeta)
uniform vec3 uFlashDir;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
${NOISE_GLSL}

float continents(vec3 p){
  vec3 w = p + 0.35*vec3(snoise(p*1.3+11.0), snoise(p*1.3+27.0), snoise(p*1.3+41.0));
  return fbm(w*1.5, 6);
}
float clouds(vec3 p){
  float t = uTime*0.004;
  vec3 q = vec3(p.x*cos(t)-p.z*sin(t), p.y, p.x*sin(t)+p.z*cos(t));
  vec3 w = q + 0.5*vec3(snoise(q*2.0+5.0), snoise(q*2.0+15.0), snoise(q*2.0+25.0));
  float c = fbm(w*vec3(3.0,6.0,3.0), 5);
  // bandas por latitud (circulación atmosférica)
  c += 0.18*sin(q.y*9.0);
  return smoothstep(0.18, 0.62, c);
}

void main(){
  vec3 p = vObj;
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 L = normalize(uSunDir);

  float h = continents(p);
  float sea = 0.07;
  float land = smoothstep(sea, sea+0.015, h);
  float lat = abs(p.y);
  float moist = fbm(p*3.0+7.0, 3);

  // --- océano
  float depth = clamp((sea - h)*4.0, 0.0, 1.0);
  vec3 ocean = mix(vec3(0.02,0.16,0.24), vec3(0.004,0.03,0.09), depth);

  // --- tierra
  float elev = clamp((h - sea)*2.6, 0.0, 1.0);
  vec3 desert = vec3(0.58,0.46,0.30);
  vec3 grass = vec3(0.16,0.25,0.08);
  vec3 forest = vec3(0.05,0.13,0.05);
  vec3 rock = vec3(0.30,0.26,0.22);
  vec3 snow = vec3(0.92,0.94,0.97);
  vec3 col = mix(desert, grass, smoothstep(-0.1, 0.15, moist + lat*0.4));
  col = mix(col, forest, smoothstep(0.1, 0.35, moist) * (1.0 - smoothstep(0.55, 0.75, lat)));
  col = mix(col, rock, smoothstep(0.35, 0.7, elev));
  col = mix(col, snow, smoothstep(0.72, 0.9, elev));
  vec3 surf = mix(ocean, col, land);
  // casquetes polares
  float ice = smoothstep(0.80, 0.86, lat + 0.06*snoise(p*8.0));
  surf = mix(surf, snow, ice);

  // relieve: sombreado comparando con un punto desplazado hacia el sol
  float hs = fbm((p + L*0.004)*1.5, 4);
  float relief = clamp(1.0 + (hs - h)*18.0*land, 0.6, 1.35);

  // --- iluminación
  float ndl = dot(N, L);
  float day = smoothstep(-0.08, 0.25, ndl);
  float diff = max(ndl, 0.0);
  // sombra de nubes
  float cs = clouds(normalize(p + L*0.012));
  float shadow = 1.0 - cs*0.55;
  vec3 lit = surf * (diff * relief * shadow * vec3(1.0,0.97,0.92) * 1.7 + 0.015);
  // tinte cálido en el terminador
  lit += surf * vec3(0.5,0.18,0.05) * smoothstep(0.12, 0.0, abs(ndl)) * 0.35 * day;

  // reflejo especular del sol en el agua
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 90.0) * (1.0 - land) * (1.0 - ice) * day;
  lit += vec3(1.0,0.9,0.7) * spec * 2.2 * shadow;

  // luces de ciudades de noche
  float night = smoothstep(0.05, -0.2, ndl);
  float cities = smoothstep(0.55, 0.85, snoise(p*60.0)*0.5+0.5) * smoothstep(0.2, 0.6, snoise(p*9.0)*0.5+0.5);
  cities *= land * (1.0 - ice) * (1.0 - smoothstep(0.4, 0.8, elev));
  lit += vec3(1.0,0.62,0.25) * cities * night * 0.9;

  // destello de la explosión
  lit += surf * uFlash * max(dot(N, normalize(uFlashDir)), 0.0) * vec3(1.0,0.75,0.5) * 2.5;

  // atmósfera sobre la superficie (más densa hacia el borde)
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);
  vec3 atm = mix(vec3(0.25,0.5,1.0), vec3(1.0,0.45,0.2), smoothstep(0.12, -0.08, ndl));
  lit = mix(lit, atm * (day*0.9+0.03), fres * 0.75 * smoothstep(-0.3, 0.2, ndl));
  lit += vec3(0.08,0.16,0.35) * 0.18 * day; // dispersión de Rayleigh

  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const cloudFrag = /* glsl */ `
uniform vec3 uSunDir;
uniform float uTime;
uniform float uFlash;
uniform vec3 uFlashDir;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
${NOISE_GLSL}
float clouds(vec3 p){
  float t = uTime*0.004;
  vec3 q = vec3(p.x*cos(t)-p.z*sin(t), p.y, p.x*sin(t)+p.z*cos(t));
  vec3 w = q + 0.5*vec3(snoise(q*2.0+5.0), snoise(q*2.0+15.0), snoise(q*2.0+25.0));
  float c = fbm(w*vec3(3.0,6.0,3.0), 5);
  c += 0.18*sin(q.y*9.0);
  return smoothstep(0.18, 0.62, c);
}
void main(){
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uSunDir);
  vec3 V = normalize(cameraPosition - vPosW);
  float c = clouds(vObj);
  float ndl = dot(N, L);
  float light = smoothstep(-0.12, 0.35, ndl);
  vec3 col = mix(vec3(0.02,0.025,0.04), vec3(1.0), light);
  col = mix(col, vec3(1.0,0.55,0.35), smoothstep(0.12, 0.0, abs(ndl)) * light * 0.6);
  col += vec3(1.0,0.7,0.45) * uFlash * max(dot(N, normalize(uFlashDir)), 0.0) * 1.5;
  float edge = pow(max(dot(N, V), 0.0), 0.4); // nubes se desvanecen en el borde
  gl_FragColor = vec4(col * 1.25, c * 0.92 * edge);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const atmoVert = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosW;
void main(){
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const atmoFrag = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uCenter;
uniform float uRadius;
uniform float uFlash;
varying vec3 vNormalW;
varying vec3 vPosW;
void main(){
  vec3 V = normalize(vPosW - cameraPosition);
  // Distancia mínima del rayo de vista al centro del planeta -> espesor de atmósfera atravesado
  vec3 oc = cameraPosition - uCenter;
  float b = dot(oc, V);
  vec3 closest = oc - b*V;
  float d = length(closest) / uRadius;      // 1 = superficie, 1.06 = tope atmósfera
  float thick = 1.0 - smoothstep(0.985, 1.065, d);
  float inner = smoothstep(0.96, 1.0, d);    // desaparece por delante del disco
  vec3 Np = normalize(closest);
  float ndl = dot(Np, normalize(uSunDir));
  float day = smoothstep(-0.35, 0.3, ndl);
  vec3 col = mix(vec3(0.3,0.55,1.0), vec3(1.0,0.42,0.15), smoothstep(0.1, -0.15, ndl));
  float a = pow(thick, 1.6) * inner * (day + uFlash*0.6);
  gl_FragColor = vec4(col * a * 1.6, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createPlanet({ radius = 1000, sunDir = new THREE.Vector3(1, 0.3, 0.4) } = {}) {
  const group = new THREE.Group();
  const uniforms = {
    uSunDir: { value: sunDir.clone().normalize() },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uFlashDir: { value: new THREE.Vector3(0, 1, 0) }
  };
  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 160, 100),
    new THREE.ShaderMaterial({ uniforms, vertexShader: surfaceVert, fragmentShader: surfaceFrag })
  );
  group.add(surface);

  const cloud = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.008, 160, 100),
    new THREE.ShaderMaterial({ uniforms, vertexShader: surfaceVert, fragmentShader: cloudFrag, transparent: true, depthWrite: false })
  );
  group.add(cloud);

  const atmoUniforms = {
    uSunDir: uniforms.uSunDir,
    uFlash: uniforms.uFlash,
    uCenter: { value: new THREE.Vector3() },
    uRadius: { value: radius }
  };
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.07, 128, 80),
    new THREE.ShaderMaterial({
      uniforms: atmoUniforms,
      vertexShader: atmoVert,
      fragmentShader: atmoFrag,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  group.add(atmo);
  group.rotation.z = 0.35; // inclinación del eje

  return {
    group,
    uniforms,
    update(dt) {
      uniforms.uTime.value += dt;
      surface.rotation.y += dt * 0.0035;
      group.getWorldPosition(atmoUniforms.uCenter.value);
    }
  };
}
