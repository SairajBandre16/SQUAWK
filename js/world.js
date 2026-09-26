// The 3D world: real-sun sky, satellite ground, weather clouds, aircraft, trails, camera.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { D2R, clamp, lerp, smooth, curvDrop, sunPosition } from './geo.js';

const MAXP = 1200, TRAIL_N = 80, TRAIL_EVERY = 1.0;
export const RINGS = [10, 25, 50, 100, 150];
export const COL = {
  low: new THREE.Color('#FF9F1C'), mid: new THREE.Color('#FF3D8B'), high: new THREE.Color('#29C5FF'),
  emg: new THREE.Color('#FF2B2B'), white: new THREE.Color('#FFFFFF'), accent: new THREE.Color('#FF5A1F')
};
export function altColor(km, out) {
  const t = clamp(km / 11.5, 0, 1);
  return t < 0.45 ? out.copy(COL.low).lerp(COL.mid, t / 0.45) : out.copy(COL.mid).lerp(COL.high, (t - 0.45) / 0.55);
}

/* ---------------- map tiles ---------------- */
export const TILE_STYLES = {
  satellite: { url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, base: '#3c5566', credit: 'Imagery © Esri, Maxar, Earthstar Geographics' },
  map: { url: (z, x, y) => `https://${'abcd'[(x + y) % 4]}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`, base: '#cfdde3', credit: '© OpenStreetMap contributors © CARTO' }
};
const tileX = (lon, z) => (lon + 180) / 360 * 2 ** z;
const tileY = (lat, z) => (1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2 * 2 ** z;
const tileLon = (x, z) => x / 2 ** z * 360 - 180;
const tileLat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return Math.atan(Math.sinh(n)) * 180 / Math.PI; };

class TileLayer {
  constructor(world, z, n, fade, yOff, order) {
    Object.assign(this, { world, z, n, fade, yOff, order });
    this.raw = document.createElement('canvas'); this.raw.width = this.raw.height = n * 256;
    this.cv = document.createElement('canvas'); this.cv.width = this.cv.height = n * 256;
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = world.renderer.capabilities.getMaxAnisotropy();
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: fade, depthWrite: !fade, fog: true });
    this.mesh = null; this.gen = 0;
  }
  build(proj, style) {
    const gen = ++this.gen, z = this.z, n = this.n, w = this.world;
    const fx = tileX(proj.lon0, z), fy = tileY(proj.lat0, z);
    const x0 = Math.floor(fx) - (n - 1) / 2, y0 = Math.floor(fy) - (n - 1) / 2;
    this.ox = (fx - x0) * 256; this.oy = (fy - y0) * 256;
    const seg = 64, pos = [], uv = [], idx = [];
    for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) {
      const tx = x0 + i / seg * n, ty = y0 + j / seg * n;
      const p = proj.toXZ(tileLat(ty, z), tileLon(tx, z));
      pos.push(p.x, -curvDrop(p.x, p.z) + this.yOff, p.z); uv.push(i / seg, 1 - j / seg);
    }
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    if (this.mesh) { this.mesh.geometry.dispose(); w.scene.remove(this.mesh); }
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.renderOrder = this.order; w.scene.add(this.mesh);
    const rc = this.raw.getContext('2d'); rc.clearRect(0, 0, this.raw.width, this.raw.height);
    if (!this.fade) { rc.fillStyle = TILE_STYLES[style].base; rc.fillRect(0, 0, this.raw.width, this.raw.height); }
    this.composite();
    this.total = n * n; this.done = 0;
    const order = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) order.push([i, j, Math.hypot(i - (n - 1) / 2, j - (n - 1) / 2)]);
    order.sort((a, b) => a[2] - b[2]);
    const max = 2 ** z;
    for (const [i, j] of order) {
      const tx = ((x0 + i) % max + max) % max, ty = y0 + j;
      if (ty < 0 || ty >= max) { this.done++; continue; }
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { if (gen !== this.gen) return; rc.drawImage(img, i * 256, j * 256); this.done++; this.dirty = true; };
      img.onerror = () => { if (gen !== this.gen) return; this.done++; this.failed = (this.failed || 0) + 1; };
      img.src = TILE_STYLES[style].url(z, tx, ty);
    }
  }
  composite() {
    const c = this.cv.getContext('2d'), W = this.cv.width;
    c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, W, W); c.drawImage(this.raw, 0, 0);
    if (this.fade) {
      const edge = Math.min(this.ox, this.oy, W - this.ox, W - this.oy) - 4;
      const gr = c.createRadialGradient(this.ox, this.oy, edge * 0.62, this.ox, this.oy, edge);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      c.globalCompositeOperation = 'destination-in'; c.fillStyle = gr; c.fillRect(0, 0, W, W);
      c.globalCompositeOperation = 'source-over';
    }
    this.tex.needsUpdate = true; this.dirty = false;
  }
}

/* ---------------- shaders ---------------- */
const CLOUD_VS = `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vW;
void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xz; gl_Position = projectionMatrix * viewMatrix * wp;
#include <logdepthbuf_vertex>
}`;
const CLOUD_FS = `
#include <logdepthbuf_pars_fragment>
uniform float uTime, uCover, uOpacity; uniform vec2 uWind; uniform vec3 uLit, uShade; varying vec2 vW;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ v += a*noise(p); p = p*2.02 + vec2(17.1, 9.2); a *= 0.5; } return v; }
void main(){
  #include <logdepthbuf_fragment>
  vec2 p = vW * 0.05 + uWind * uTime;
  float n = fbm(p), d = fbm(p * 2.3 + 4.0);
  float th = 1.0 - uCover;
  float a = smoothstep(th - 0.05, th + 0.22, n * 0.85 + d * 0.28);
  a *= 1.0 - smoothstep(170.0, 320.0, length(vW));
  vec3 col = mix(uShade, uLit, clamp(0.35 + d * 0.9, 0.0, 1.0));
  gl_FragColor = vec4(col, a * uOpacity);
}`;

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.28, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function planeGeometry() {
  const shear = (g, k) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + Math.abs(p.getX(i)) * k); g.computeVertexNormals(); return g; };
  const parts = [
    new THREE.CylinderGeometry(0.045, 0.056, 1, 12).rotateX(Math.PI / 2),
    new THREE.ConeGeometry(0.056, 0.17, 12).rotateX(-Math.PI / 2).translate(0, 0, -0.585),
    new THREE.ConeGeometry(0.045, 0.12, 12).rotateX(Math.PI / 2).translate(0, 0.01, 0.56),
    shear(new THREE.BoxGeometry(1.02, 0.018, 0.17), 0.32).translate(0, -0.015, -0.02),
    shear(new THREE.BoxGeometry(0.36, 0.014, 0.085), 0.35).translate(0, 0.02, 0.43),
    new THREE.BoxGeometry(0.014, 0.19, 0.13).translate(0, 0.105, 0.46),
    new THREE.CylinderGeometry(0.034, 0.03, 0.15, 10).rotateX(Math.PI / 2).translate(0.23, -0.055, -0.06),
    new THREE.CylinderGeometry(0.034, 0.03, 0.15, 10).rotateX(Math.PI / 2).translate(-0.23, -0.055, -0.06)
  ];
  const fin = parts[5].attributes.position; for (let i = 0; i < fin.count; i++) fin.setZ(i, fin.getZ(i) + fin.getY(i) * 0.7);
  parts[5].computeVertexNormals();
  return mergeGeometries(parts.map(g => g.toNonIndexed()));
}

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.002, 30000);
    this.scene.fog = new THREE.FogExp2(0xb8cfe6, 0.0032);
    this.altScale = 2.2; this.mode = 'orbit';
    this.clock = new THREE.Clock();
    this.tmpV = new THREE.Vector3(); this.tmpC = new THREE.Color(); this.tmpQ = new THREE.Quaternion(); this.tmpE = new THREE.Euler(); this.tmpM = new THREE.Matrix4(); this.tmpS = new THREE.Vector3();
    this.vis = new Map(); this.style = 'satellite'; this.cloudsOn = true; this.day = 1;
    this.buildSky(); this.buildGround(); this.buildClouds(); this.buildAircraft(); this.buildObserver();
    this.airportGroup = new THREE.Group(); this.scene.add(this.airportGroup);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.45, 0.82);
    this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
    this.cam = { target: new THREE.Vector3(0, 2, 0), r: 95, theta: 0.6, phi: 1.02, yaw: 0, pitch: 22 * D2R, fov: 62 };
    this.curPos = new THREE.Vector3(0, 400, 300); this.curLook = new THREE.Vector3();
    this.bindInput();
  }

  /* ---------- sky, sun, weather ---------- */
  buildSky() {
    this.sky = new Sky(); this.sky.scale.setScalar(9000); this.sky.renderOrder = -10; this.scene.add(this.sky);
    const u = this.sky.material.uniforms; u.turbidity.value = 2; u.rayleigh.value = 1.8; u.mieCoefficient.value = 0.003; u.mieDirectionalG.value = 0.8;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.2); this.scene.add(this.sunLight);
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x7a6a55, 1.1); this.scene.add(this.hemi);
    const n = 2500, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const u2 = Math.random() * Math.PI * 2, v = Math.random() * 0.97 + 0.03, r = 8000, s = Math.sqrt(1 - v * v); p.set([Math.cos(u2) * s * r, v * r, Math.sin(u2) * s * r], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.renderOrder = -9; this.scene.add(this.stars);
  }
  setSun(date, lat, lon) {
    const s = sunPosition(date, lat, lon); this.sun = s;
    const el = s.alt * D2R, az = s.az * D2R;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    const day = smooth(-7, 6, s.alt), golden = 1 - smooth(2, 18, s.alt);
    this.day = day;
    this.sunLight.position.copy(this.sunDir).multiplyScalar(500);
    this.sunLight.color.set('#fff4e6').lerp(this.tmpC.set('#ffab6b'), golden * 0.85);
    this.sunLight.intensity = 2.4 * smooth(-3, 6, s.alt);
    this.hemi.intensity = 0.25 + 1.0 * day;
    this.renderer.toneMappingExposure = lerp(0.62, 0.46, day);
    const fog = this.tmpC.set('#0b1428').lerp(new THREE.Color('#e9b596'), smooth(-6, 2, s.alt) * golden).lerp(new THREE.Color('#bcd3ea'), smooth(4, 18, s.alt));
    this.scene.fog.color.copy(fog);
    this.stars.material.opacity = 1 - smooth(-12, -2, s.alt);
    const tint = lerp(0.14, 1, day);
    this.tileTint = new THREE.Color(tint, tint * lerp(0.9, 1, 1 - golden * 0.4), tint * lerp(0.82, 1, 1 - golden * 0.5));
    for (const L of this.layers) L.mat.color.copy(this.tileTint);
    this.baseMat.color.copy(this.tileTint).multiply(new THREE.Color(TILE_STYLES[this.style].base));
    const cu = this.cloud.material.uniforms;
    cu.uLit.value.set('#ffffff').lerp(this.tmpC.set('#ffc09a'), golden * 0.8).multiplyScalar(lerp(0.12, 1.05, day));
    cu.uShade.value.set('#8d9bb0').multiplyScalar(lerp(0.1, 1, day));
    this.bloom.strength = lerp(0.75, 0.18, day);
  }
  setWeather(w) {
    const u = this.cloud.material.uniforms;
    const cc = w ? (w.cloud_cover_low ?? w.cloud_cover ?? 30) * 0.7 + (w.cloud_cover_mid ?? 0) * 0.3 : 30;
    u.uCover.value = clamp(0.08 + cc / 100 * 0.52, 0, 0.62);
    const wd = ((w?.wind_direction_10m ?? 250) + 180) * D2R, ws = (w?.wind_speed_10m ?? 15) / 3600 * 0.05; // wind blows toward dir+180
    u.uWind.value.set(Math.sin(wd) * ws * 25, -Math.cos(wd) * ws * 25);
    const tb = 1.6 + (w?.cloud_cover ?? 30) / 100 * 3.5 + (w?.visibility != null ? clamp((20000 - w.visibility) / 20000, 0, 1) * 4 : 0);
    this.sky.material.uniforms.turbidity.value = tb;
    this.scene.fog.density = 0.0026 + (w?.visibility != null ? clamp((30000 - w.visibility) / 30000, 0, 1) * 0.004 : 0.0008);
    this.baseFog = this.scene.fog.density;
  }

  /* ---------- ground ---------- */
  buildGround() {
    const g = new THREE.PlaneGeometry(3000, 3000, 120, 120).rotateX(-Math.PI / 2);
    const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, -curvDrop(p.getX(i), p.getZ(i)) - 0.06);
    this.baseMat = new THREE.MeshBasicMaterial({ color: TILE_STYLES.satellite.base });
    this.base = new THREE.Mesh(g, this.baseMat); this.base.renderOrder = -1; this.scene.add(this.base);
    this.layers = [new TileLayer(this, 8, 5, false, 0, 0), new TileLayer(this, 10, 7, true, 0.012, 1), new TileLayer(this, 12, 7, true, 0.024, 2)];
  }
  loadTiles(proj, style) { this.style = style; this.proj = proj; for (const L of this.layers) L.build(proj, style); if (this.tileTint) this.baseMat.color.copy(this.tileTint).multiply(new THREE.Color(TILE_STYLES[style].base)); }
  tileProgress() { let t = 0, d = 0, f = 0; for (const L of this.layers) { t += L.total || 0; d += L.done || 0; f += L.failed || 0; } return { total: t, done: d, failed: f }; }

  buildClouds() {
    const g = new THREE.PlaneGeometry(700, 700, 1, 1).rotateX(-Math.PI / 2);
    const m = new THREE.ShaderMaterial({ vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uCover: { value: 0.25 }, uOpacity: { value: 0.9 }, uWind: { value: new THREE.Vector2(0.02, 0) }, uLit: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.6, 0.65, 0.72) } } });
    this.cloud = new THREE.Mesh(g, m); this.cloud.renderOrder = 5; this.cloud.frustumCulled = false; this.scene.add(this.cloud);
  }

  /* ---------- observer & airports ---------- */
  buildObserver() {
    this.obs = new THREE.Group(); this.scene.add(this.obs);
    const pin = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.2, 20).rotateX(Math.PI).translate(0, 0.6, 0), new THREE.MeshStandardMaterial({ color: '#FF5A1F', emissive: '#FF5A1F', emissiveIntensity: 0.6 }));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14).translate(0, 1.35, 0), pin.material);
    this.pin = new THREE.Group(); this.pin.add(pin, head); this.obs.add(this.pin);
    this.pulse = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#FF5A1F', transparent: true, depthWrite: false }));
    this.pulse.position.y = 0.05; this.obs.add(this.pulse);
    const mat = new THREE.LineBasicMaterial({ color: '#FF5A1F', transparent: true, opacity: 0.55, depthWrite: false });
    for (const r of RINGS) {
      const pts = []; for (let i = 0; i <= 180; i++) { const a = i / 180 * Math.PI * 2, x = Math.sin(a) * r, z = -Math.cos(a) * r; pts.push(new THREE.Vector3(x, -curvDrop(x, z) + 0.06, z)); }
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat); l.renderOrder = 3; this.obs.add(l);
    }
  }
  setAirports(list, proj) {
    for (const c of [...this.airportGroup.children]) { c.geometry.dispose(); this.airportGroup.remove(c); }
    this.airports = [];
    const mat = new THREE.MeshBasicMaterial({ color: '#FFFFFF', fog: true });
    for (const a of list) {
      const p = proj.toXZ(a[3], a[4]); if (Math.hypot(p.x, p.z) > 230) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, a[6]), mat);
      m.position.set(p.x, -curvDrop(p.x, p.z) + 0.05, p.z); m.rotation.y = -a[5] * D2R; this.airportGroup.add(m);
      this.airports.push({ a, pos: new THREE.Vector3(p.x, -curvDrop(p.x, p.z) + 0.3, p.z) });
    }
  }

  /* ---------- aircraft ---------- */
  buildAircraft() {
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.38, metalness: 0.25, emissive: '#1b2230' });
    this.planes = new THREE.InstancedMesh(planeGeometry(), mat, MAXP);
    this.planes.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.planes.count = 0; this.planes.frustumCulled = false;
    this.planes.setColorAt(0, new THREE.Color(1, 1, 1));
    this.scene.add(this.planes);
    const glow = glowTexture();
    const mk = (n, size, blending, opacity) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const p = new THREE.Points(g, new THREE.PointsMaterial({ map: glow, size, sizeAttenuation: false, vertexColors: true, transparent: true, opacity, depthWrite: false, blending }));
      p.frustumCulled = false; this.scene.add(p); return p;
    };
    this.halo = mk(MAXP, 26, THREE.NormalBlending, 0.55); this.halo.renderOrder = 6;
    this.lights = mk(MAXP * 4, 9, THREE.AdditiveBlending, 1); this.lights.renderOrder = 7;
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXP * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.drops = new THREE.LineSegments(dg, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }));
    this.drops.frustumCulled = false; this.scene.add(this.drops);
    this.trailPos = new Float32Array(MAXP * TRAIL_N * 6); this.trailCol = new Float32Array(MAXP * TRAIL_N * 6);
    const tg = new LineSegmentsGeometry(); tg.setPositions(this.trailPos); tg.setColors(this.trailCol); tg.instanceCount = 0;
    this.trailMat = new LineMaterial({ linewidth: 2.4, vertexColors: true, transparent: true, opacity: 0.92, depthWrite: false, worldUnits: false });
    this.trails = new LineSegments2(tg, this.trailMat); this.trails.frustumCulled = false; this.trails.renderOrder = 4; this.scene.add(this.trails);
    this.trailClock = 0;
  }
  resetAircraft() { this.vis.clear(); }
  worldPos(f, out) { return out.set(f.x, f.alt * this.altScale - curvDrop(f.x, f.z) + 0.05, f.z); }

  syncAircraft(flights, dt, t, selId) {
    const cam = this.camera.position, seen = new Set();
    let i = 0; const hp = this.halo.geometry.attributes.position.array, hc = this.halo.geometry.attributes.color.array;
    const lp = this.lights.geometry.attributes.position.array, lc = this.lights.geometry.attributes.color.array, dp = this.drops.geometry.attributes.position.array;
    for (const f of flights) {
      if (i >= MAXP) break;
      seen.add(f.id);
      let v = this.vis.get(f.id);
      const target = this.worldPos(f, this.tmpV);
      if (!v) {
        v = { pos: target.clone(), yaw: -f.trk * D2R, trail: [], last: 0, col: new THREE.Color() };
        const bx = f.spd * Math.sin(f.trk * D2R), bz = -f.spd * Math.cos(f.trk * D2R);
        for (let k = 30; k >= 1; k--) { const tt = k * TRAIL_EVERY; v.trail.push({ x: f.x - bx * tt, a: Math.max(0, f.alt - f.vr * tt), z: f.z - bz * tt }); }
        this.vis.set(f.id, v);
      } else v.pos.lerp(target, 1 - Math.exp(-dt * 5));
      v.yaw += ((((-f.trk * D2R - v.yaw) + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * (1 - Math.exp(-dt * 4));
      if (t - v.last > TRAIL_EVERY) { v.last = t; v.trail.push({ x: f.x, a: f.alt, z: f.z }); if (v.trail.length > TRAIL_N - 1) v.trail.shift(); }
      const emg = f.emg; if (emg) v.col.copy(COL.emg); else altColor(f.alt, v.col);
      const dist = cam.distanceTo(v.pos), s = clamp(dist * 0.017, 0.05, 16) * (f.id === selId ? 1.35 : 1);
      const pitch = clamp(Math.atan2(f.vr * this.altScale, f.spd + 1e-4) * 0.7, -0.22, 0.32), bank = clamp(-(f.turn || 0) * 0.14, -0.45, 0.45);
      this.tmpE.set(pitch, v.yaw, bank, 'YXZ'); this.tmpQ.setFromEuler(this.tmpE);
      this.tmpM.compose(v.pos, this.tmpQ, this.tmpS.setScalar(s)); this.planes.setMatrixAt(i, this.tmpM);
      this.tmpC.copy(v.col).lerp(COL.white, f.id === selId ? 0.75 : 0.42); this.planes.setColorAt(i, this.tmpC);
      hp[i * 3] = v.pos.x; hp[i * 3 + 1] = v.pos.y; hp[i * 3 + 2] = v.pos.z;
      const hk = f.id === selId ? 1 : 0.9; hc[i * 3] = v.col.r * hk; hc[i * 3 + 1] = v.col.g * hk; hc[i * 3 + 2] = v.col.b * hk;
      // nav lights: left red, right green, tail strobe white, belly beacon red
      const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw), ph = t + (f.phase || 0);
      const L = [[-0.53, 0.0, 0.1, 1, 0.12, 0.15, 1], [0.53, 0.0, 0.1, 0.1, 1, 0.35, 1], [0, 0.02, 0.6, 1, 1, 1, (ph * 1.1) % 1 < 0.08 ? 1 : 0], [0, -0.07, 0, 1, 0.1, 0.1, (ph * 0.8) % 1 < 0.14 ? 1 : 0]];
      for (let k = 0; k < 4; k++) {
        const [lx, ly, lz, r, g, b, on] = L[k], j = (i * 4 + k) * 3;
        lp[j] = v.pos.x + (lx * cy + lz * sy) * s; lp[j + 1] = v.pos.y + ly * s; lp[j + 2] = v.pos.z + (-lx * sy + lz * cy) * s;
        const m = on * (0.35 + 0.65 * (1 - this.day * 0.6)); lc[j] = r * m; lc[j + 1] = g * m; lc[j + 2] = b * m;
      }
      const gy = -curvDrop(v.pos.x, v.pos.z) + 0.05;
      dp.set([v.pos.x, v.pos.y, v.pos.z, v.pos.x, gy, v.pos.z], i * 6);
      v.index = i; i++;
    }
    for (const id of this.vis.keys()) if (!seen.has(id)) this.vis.delete(id);
    this.planes.count = i; this.planes.instanceMatrix.needsUpdate = true; if (this.planes.instanceColor) this.planes.instanceColor.needsUpdate = true;
    for (const p of [this.halo, this.lights]) { p.geometry.attributes.position.needsUpdate = true; p.geometry.attributes.color.needsUpdate = true; }
    this.halo.geometry.setDrawRange(0, i); this.lights.geometry.setDrawRange(0, i * 4);
    this.drops.geometry.attributes.position.needsUpdate = true; this.drops.geometry.setDrawRange(0, i * 2);
    if ((this.trailClock += dt) > 0.1) { this.trailClock = 0; this.buildTrails(flights); }
  }
  buildTrails(flights) {
    let n = 0; const P = this.trailPos, C = this.trailCol, as = this.altScale;
    for (const f of flights) {
      const v = this.vis.get(f.id); if (!v) continue;
      const tr = v.trail, m = tr.length;
      let px = null, py, pz;
      for (let k = 0; k <= m && n < MAXP * TRAIL_N; k++) {
        let x, y, z;
        if (k < m) { x = tr[k].x; z = tr[k].z; y = tr[k].a * as - curvDrop(x, z) + 0.05; } else { x = v.pos.x; y = v.pos.y; z = v.pos.z; }
        if (px !== null) {
          const j = n * 6, fa = 0.45 + 0.55 * (k - 1) / Math.max(1, m), fb = 0.45 + 0.55 * k / Math.max(1, m);
          P[j] = px; P[j + 1] = py; P[j + 2] = pz; P[j + 3] = x; P[j + 4] = y; P[j + 5] = z;
          C[j] = v.col.r * fa; C[j + 1] = v.col.g * fa; C[j + 2] = v.col.b * fa; C[j + 3] = v.col.r * fb; C[j + 4] = v.col.g * fb; C[j + 5] = v.col.b * fb;
          n++;
        }
        px = x; py = y; pz = z;
      }
    }
    const g = this.trails.geometry;
    g.attributes.instanceStart.data.needsUpdate = true; g.attributes.instanceColorStart.data.needsUpdate = true;
    g.instanceCount = n;
  }

  /* ---------- camera & input ---------- */
  setMode(m) {
    const prev = this.mode; this.mode = m;
    if (m === 'top') { this.cam.phi = 0.02; this.cam.theta = 0; if (this.cam.r < 60) this.cam.r = 140; }
    if (m === 'orbit' && prev === 'top') { this.cam.phi = 1.0; }
    if (m === 'ground') { this.cam.fov = 62; }
  }
  lookAtFlight(f) { const p = this.worldPos(f, this.tmpV); this.cam.yaw = Math.atan2(p.x, -p.z); this.cam.pitch = clamp(Math.atan2(p.y - 0.1, Math.hypot(p.x, p.z)), -0.1, 1.5); }
  bindInput() {
    const el = this.canvas, ptrs = new Map(); let drag = null, pinch = 0;
    this.lastInteract = -10;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, moved: 0, pan: e.button === 2 || e.shiftKey || this.mode === 'top' };
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); drag = null; }
      this.lastInteract = this.clock.elapsedTime; this.introT = 99;
    });
    el.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) this.zoom(pinch / d); pinch = d; return; }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
      const c = this.cam;
      if (this.mode === 'ground') { c.yaw -= dx * 0.004 * c.fov / 60; c.pitch = clamp(c.pitch + dy * 0.004 * c.fov / 60, -0.2, 1.52); }
      else if (drag.pan) {
        const k = c.r * 0.0016, st = Math.sin(c.theta), ct = Math.cos(c.theta);
        c.target.x -= (dx * ct + dy * st) * k; c.target.z -= (-dx * st + dy * ct) * k;
        const lim = 180; c.target.x = clamp(c.target.x, -lim, lim); c.target.z = clamp(c.target.z, -lim, lim);
        this.onPan && this.onPan();
      } else { c.theta -= dx * 0.005; c.phi = clamp(c.phi - dy * 0.004, 0.05, 1.45); }
      this.lastInteract = this.clock.elapsedTime;
    });
    const end = e => {
      if (drag && drag.moved < 6 && e.type === 'pointerup' && ptrs.size === 1) this.onPick && this.onPick(e.clientX, e.clientY);
      ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = 0; if (!ptrs.size) drag = null;
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', e => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0012)); this.lastInteract = this.clock.elapsedTime; }, { passive: false });
  }
  zoom(k) { if (this.mode === 'ground') this.cam.fov = clamp(this.cam.fov * k, 12, 85); else this.cam.r = clamp(this.cam.r * k, 3, 520); }
  resize(w, h) {
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.trailMat.resolution.set(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
  }
  project(v, out) {
    this.tmpS.copy(v).project(this.camera);
    out.vis = this.tmpS.z < 1 && Math.abs(this.tmpS.x) < 1.1 && Math.abs(this.tmpS.y) < 1.1;
    out.x = (this.tmpS.x + 1) / 2 * this.w; out.y = (1 - this.tmpS.y) / 2 * this.h; return out;
  }
  frame(dt, t, followPos) {
    const c = this.cam, want = this.mode === 'ground' ? 1 : 2.2;
    this.altScale += (want - this.altScale) * (1 - Math.exp(-dt * 3));
    if (this.introT < 3.6) {
      this.introT += dt; const k = this.introT / 3.6, e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      c.r = lerp(300, 95, e); c.phi = lerp(0.3, 1.02, e); c.theta = lerp(-0.6, 0.6, e);
    } else if (this.mode === 'orbit' && t - this.lastInteract > 6 && !followPos && !matchMedia('(prefers-reduced-motion: reduce)').matches) c.theta += dt * 0.025;
    let pos = this.tmpV, look = new THREE.Vector3(), fov = 50;
    if (this.mode === 'ground') {
      pos.set(0, 0.1, 0); fov = c.fov;
      look.set(Math.sin(c.yaw) * Math.cos(c.pitch), 0.1 + Math.sin(c.pitch), -Math.cos(c.yaw) * Math.cos(c.pitch));
    } else {
      const tg = followPos || c.target;
      const r = followPos ? Math.min(c.r, 30) : c.r;
      pos.set(tg.x + r * Math.sin(c.phi) * Math.sin(c.theta), tg.y + r * Math.cos(c.phi), tg.z + r * Math.sin(c.phi) * Math.cos(c.theta));
      look.copy(tg); fov = this.w < 700 ? 60 : 48;
    }
    const k = this.introT < 3.6 ? 1 : 1 - Math.exp(-dt * 4);
    this.curPos.lerp(pos, k); this.curLook.lerp(look, k);
    this.camera.position.copy(this.curPos); this.camera.lookAt(this.curLook);
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 5)); this.camera.updateProjectionMatrix(); }
    // clouds float at ~1.8 km (drawn with the same height exaggeration as aircraft)
    this.cloud.visible = this.cloudsOn; this.cloud.position.y = 1.8 * this.altScale - 0.2;
    this.cloud.material.uniforms.uTime.value = t;
    this.cloud.material.uniforms.uOpacity.value = this.mode === 'top' ? 0.35 : 0.9;
    const pk = (t * 0.5) % 1; this.pulse.scale.setScalar(0.5 + pk * 6); this.pulse.material.opacity = 0.7 * (1 - pk); this.obs.visible = this.mode !== 'ground';
    const bf = this.baseFog || 0.0032, fd = this.mode === 'ground' ? Math.max(bf * 3, 0.009) : bf * clamp(110 / this.curPos.distanceTo(this.curLook), 0.2, 1);
    this.scene.fog.density += (fd - this.scene.fog.density) * (1 - Math.exp(-dt * 3));
    const ps = clamp(this.curPos.length() * 0.012, 0.3, 4); this.pin.scale.setScalar(ps); this.pin.visible = this.mode !== 'ground';
    for (const L of this.layers) if (L.dirty && t - (L.lastComp || 0) > 0.25) { L.lastComp = t; L.composite(); }
    this.composer.render();
  }
}
