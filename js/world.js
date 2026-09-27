// The 3D world: a streaming globe with the real sun, weather clouds at home, aircraft, trails and a globe camera.
// Scene units are km in an earth-centred frame shifted by a floating origin (this.O). Things that belong to the
// observer (pin, range rings, runways, clouds) live in homeGroup, a local frame at home: +x east, +y up, -z north.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Globe, TILE_STYLES } from './globe.js';
import { MODELS, modelGeometry, modelSize } from './models.js';
import { D2R, EARTH_R, clamp, lerp, smooth, curvDrop, sunPosition, unitDir, enu, toLatLon, haversine, step } from './geo.js';

export { TILE_STYLES };
const MAXP = 9000, TRAIL_F = 500, TRAIL_N = 80, TRAIL_EVERY = 1.0;
// mark the first n array entries of a (possibly interleaved) buffer for upload; nothing to send when n is 0
const upd = (a, n) => { if (!n) return; a.clearUpdateRanges(); a.addUpdateRange(0, n); a.needsUpdate = true; };
export const HOME_R = 95, SPACE_R = 22000;
// zoomed in closer than this, a left-drag orbits the camera in 3D; further out it pans the globe
const ORBIT_R = 700;
export const RINGS = [10, 25, 50, 100, 150];
export const COL = {
  low: new THREE.Color('#FF9F1C'), mid: new THREE.Color('#FF3D8B'), high: new THREE.Color('#29C5FF'),
  emg: new THREE.Color('#FF2B2B'), white: new THREE.Color('#FFFFFF'), accent: new THREE.Color('#FF5A1F')
};
export function altColor(km, out) {
  const t = clamp(km / 11.5, 0, 1);
  return t < 0.45 ? out.copy(COL.low).lerp(COL.mid, t / 0.45) : out.copy(COL.mid).lerp(COL.high, (t - 0.45) / 0.55);
}
// nav lights in the model's frame: x, y, z offset, then r, g, b
const NAV = [[-0.53, 0, 0.1, 1, 0.12, 0.15], [0.53, 0, 0.1, 0.1, 1, 0.35], [0, 0.02, 0.6, 1, 1, 1], [0, -0.07, 0, 1, 0.1, 0.1]];
const CONTRAIL = new THREE.Color(0.93, 0.95, 1);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;

/* ---------------- shaders ---------------- */
const CLOUD_VS = `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vW;
void main(){ vW = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#02040a');
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.002, 90000);
    this.scene.fog = new THREE.FogExp2(0xb8cfe6, 0.0032);
    this.altScale = 2.2; this.mode = 'orbit';
    this.clock = new THREE.Clock();
    this.tmpV = new THREE.Vector3(); this.tmpW = new THREE.Vector3(); this.tmpC = new THREE.Color(); this.tmpQ = new THREE.Quaternion(); this.tmpQ2 = new THREE.Quaternion();
    this.tmpE = new THREE.Euler(); this.tmpM = new THREE.Matrix4(); this.tmpS = new THREE.Vector3();
    this.e = new THREE.Vector3(); this.n = new THREE.Vector3(); this.u = new THREE.Vector3(); this.s = new THREE.Vector3(); this.hv = new THREE.Vector3();
    this.O = new THREE.Vector3(0, 0, EARTH_R); this.homeLL = { lat: 0, lon: 0 };
    this.vis = new Map(); this.cloudsOn = true; this.day = 1;
    this.homeGroup = new THREE.Group(); this.homeGroup.matrixAutoUpdate = false; this.scene.add(this.homeGroup);
    this.globe = new Globe(this.renderer, this.scene);
    this.buildSky(); this.buildClouds(); this.buildAircraft(); this.buildObserver(); this.buildSats();
    this.airportGroup = new THREE.Group(); this.homeGroup.add(this.airportGroup);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.45, 0.82);
    this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
    this.cam = { lat: 0, lon: 0, h: 2, r: SPACE_R, theta: 0, phi: 0, yaw: 0, pitch: 22 * D2R, fov: 62 };
    this.curPos = new THREE.Vector3(); this.curLook = new THREE.Vector3(); this.curUp = new THREE.Vector3(0, 1, 0);
    this.fly = null; this.inertia = null; this.snap = true; this.lastInteract = -10;
    this.bindInput();
  }

  /* ---------- frames ---------- */
  llToScene(lat, lon, h, out) { return unitDir(lat, lon, out).multiplyScalar(EARTH_R + h).sub(this.O); }
  placeHome() {
    const { lat, lon } = this.homeLL; enu(lat, lon, this.e, this.n, this.u); this.s.copy(this.n).negate();
    this.homeGroup.matrix.makeBasis(this.e, this.u, this.s).setPosition(this.llToScene(lat, lon, 0, this.tmpV));
    this.homeGroup.matrixWorldNeedsUpdate = true; this.homeGroup.updateMatrixWorld(true);
    this.homePos = this.llToScene(lat, lon, 0, this.homePos || new THREE.Vector3());
  }
  setHome(lat, lon) { this.homeLL = { lat, lon }; this.placeHome(); this.globe.prefetch(lat, lon); if (this.sunDate) this.setSun(this.sunDate); }
  /** Move the floating origin so the area in view keeps full float precision on the GPU. */
  rebase(by) {
    this.O.add(by); this.curPos.sub(by); this.curLook.sub(by);
    for (const v of this.vis.values()) v.pos.sub(by);
    this.placeHome(); this.trailClock = 1;
  }
  // where the view is, or where it's headed while a flight is under way
  focus() { const c = this.fly ? this.fly.b : this.cam; return { lat: c.lat, lon: c.lon }; }
  viewRadius() { return Math.min((this.fly ? this.fly.b : this.cam).r * 0.9, 9000); }
  homeDist() { return haversine(this.homeLL.lat, this.homeLL.lon, this.cam.lat, this.cam.lon); }

  /* ---------- sky, sun, weather ---------- */
  buildSky() {
    this.sky = new Sky(); this.sky.scale.setScalar(9000); this.sky.renderOrder = -10; this.sky.frustumCulled = false; this.scene.add(this.sky);
    const u = this.sky.material.uniforms; u.turbidity.value = 2; u.rayleigh.value = 1.8; u.mieCoefficient.value = 0.003; u.mieDirectionalG.value = 0.8;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.2); this.scene.add(this.sunLight);
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x7a6a55, 1.1); this.scene.add(this.hemi);
    const n = 2500, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = Math.random() * 2 - 1, r = 8000, s = Math.sqrt(1 - v * v); p.set([Math.cos(a) * s * r, v * r, Math.sin(a) * s * r], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.renderOrder = -9; this.stars.frustumCulled = false; this.scene.add(this.stars);
  }
  setSun(date) {
    this.sunDate = date;
    const { lat, lon } = this.homeLL, s = sunPosition(date, lat, lon); this.sun = s;
    const el = s.alt * D2R, az = s.az * D2R;
    enu(lat, lon, this.e, this.n, this.u);
    this.sunDir.copy(this.e).multiplyScalar(Math.sin(az) * Math.cos(el)).addScaledVector(this.n, Math.cos(az) * Math.cos(el)).addScaledVector(this.u, Math.sin(el));
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir); this.globe.setSun(this.sunDir);
    const day = smooth(-7, 6, s.alt), golden = 1 - smooth(2, 18, s.alt);
    this.day = day; this.golden = golden;
    this.sunLight.color.set('#fff4e6').lerp(this.tmpC.set('#ffab6b'), golden * 0.85);
    this.sunLight.intensity = 2.4 * smooth(-3, 6, s.alt);
    this.hemi.intensity = 0.25 + 1.0 * day;
    const fog = this.tmpC.set('#0b1428').lerp(new THREE.Color('#e9b596'), smooth(-6, 2, s.alt) * golden).lerp(new THREE.Color('#bcd3ea'), smooth(4, 18, s.alt));
    this.scene.fog.color.copy(fog);
    const cu = this.cloud.material.uniforms;
    cu.uLit.value.set('#ffffff').lerp(this.tmpC.set('#ffc09a'), golden * 0.8).multiplyScalar(lerp(0.12, 1.05, day));
    cu.uShade.value.set('#8d9bb0').multiplyScalar(lerp(0.1, 1, day));
  }
  setWeather(w) {
    const u = this.cloud.material.uniforms;
    const cc = w ? (w.cloud_cover_low ?? w.cloud_cover ?? 30) * 0.7 + (w.cloud_cover_mid ?? 0) * 0.3 : 30;
    u.uCover.value = clamp(0.08 + cc / 100 * 0.52, 0, 0.62);
    const wd = ((w?.wind_direction_10m ?? 250) + 180) * D2R, ws = (w?.wind_speed_10m ?? 15) / 3600 * 0.05; // wind blows toward dir+180
    u.uWind.value.set(Math.sin(wd) * ws * 25, -Math.cos(wd) * ws * 25);
    this.turbidity = 1.6 + (w?.cloud_cover ?? 30) / 100 * 3.5 + (w?.visibility != null ? clamp((20000 - w.visibility) / 20000, 0, 1) * 4 : 0);
    this.sky.material.uniforms.turbidity.value = this.turbidity;
    this.baseFog = 0.0026 + (w?.visibility != null ? clamp((30000 - w.visibility) / 30000, 0, 1) * 0.004 : 0.0008);
  }

  /* ---------- ground ---------- */
  setStyle(style) { this.style = style; this.globe.setStyle(style); }
  setNames(on) { this.globe.setNames(on); }
  setRadar(on) { this.globe.setRadar(on); }
  tileProgress() { return this.globe.progress; }

  buildClouds() {
    const g = new THREE.PlaneGeometry(700, 700, 48, 48).rotateX(-Math.PI / 2);
    const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, -curvDrop(p.getX(i), p.getZ(i)));
    const m = new THREE.ShaderMaterial({ vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uCover: { value: 0.25 }, uOpacity: { value: 0.9 }, uWind: { value: new THREE.Vector2(0.02, 0) }, uLit: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.6, 0.65, 0.72) } } });
    this.cloud = new THREE.Mesh(g, m); this.cloud.renderOrder = 5; this.cloud.frustumCulled = false; this.homeGroup.add(this.cloud);
  }

  /* ---------- observer & airports ---------- */
  buildObserver() {
    this.obs = new THREE.Group(); this.homeGroup.add(this.obs);
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
    // one body and one tail InstancedMesh per aircraft family; the tail carries the airline colour
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.38, metalness: 0.25, emissive: '#1b2230' });
    const tmat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0.1, emissive: '#10141c' });
    this.models = {};
    for (const k of MODELS) {
      const g = modelGeometry(k), mk = (geo, m) => { const im = new THREE.InstancedMesh(geo, m, MAXP); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.count = 0; im.frustumCulled = false; im.setColorAt(0, new THREE.Color(1, 1, 1)); this.scene.add(im); return im; };
      this.models[k] = { body: mk(g.body, mat), tail: mk(g.tail, tmat), size: modelSize(k), n: 0 };
    }
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
    this.trailPos = new Float32Array(TRAIL_F * TRAIL_N * 6); this.trailCol = new Float32Array(TRAIL_F * TRAIL_N * 6);
    const tg = new LineSegmentsGeometry(); tg.setPositions(this.trailPos); tg.setColors(this.trailCol); tg.instanceCount = 0;
    this.trailMat = new LineMaterial({ linewidth: 2.4, vertexColors: true, transparent: true, opacity: 0.92, depthWrite: false, worldUnits: false });
    this.trails = new LineSegments2(tg, this.trailMat); this.trails.frustumCulled = false; this.trails.renderOrder = 4; this.scene.add(this.trails);
    this.trailClock = 0;
  }
  resetAircraft() { this.vis.clear(); }
  worldPos(f, out) { return this.llToScene(f.lat, f.lon, f.alt * this.altScale + 0.05, out); }
  // The last 30 s of track, reconstructed from speed and heading, so a trail doesn't start from nothing.
  backfill(f, v) {
    v.filled = true; if (v.trail.length > 4) return;
    const q = { lat: 0, lon: 0 }, d = new THREE.Vector3(), pts = [];
    for (let k = 30; k >= 1; k--) {
      const tt = k * TRAIL_EVERY; q.lat = f.lat; q.lon = f.lon; step(q, f.trk + 180, f.spd * tt); unitDir(q.lat, q.lon, d);
      pts.push({ x: d.x, y: d.y, z: d.z, a: Math.max(0, f.alt - f.vr * tt) });
    }
    v.trail = pts.concat(v.trail);
  }

  syncAircraft(flights, dt, t, selId) {
    const cam = this.camera.position, seen = new Set(), ground = this.mode === 'ground', e = this.e, n = this.n, u = this.u, s = this.s, O = this.O;
    const hp = this.halo.geometry.attributes.position.array, hc = this.halo.geometry.attributes.color.array;
    const lp = this.lights.geometry.attributes.position.array, lc = this.lights.geometry.attributes.color.array, dp = this.drops.geometry.attributes.position.array;
    const kLerp = 1 - Math.exp(-dt * 5), kYaw = 1 - Math.exp(-dt * 4), glow = 0.35 + 0.65 * (1 - this.day * 0.6);
    let i = 0, ip = 0; // i: every aircraft (halo dot); ip: aircraft near enough to draw as a 3D model
    for (const k in this.models) this.models[k].n = 0;
    for (const f of flights) {
      if (i >= MAXP) break;
      seen.add(f.id);
      enu(f.lat, f.lon, e, n, u);
      const rr = EARTH_R + f.alt * this.altScale + 0.05, tx = u.x * rr - O.x, ty = u.y * rr - O.y, tz = u.z * rr - O.z;
      let v = this.vis.get(f.id);
      if (!v) { v = { pos: new THREE.Vector3(tx, ty, tz), yaw: -f.trk * D2R, trail: [], last: 0, col: new THREE.Color() }; this.vis.set(f.id, v); }
      else {
        const p = v.pos, dx = tx - p.x, dy = ty - p.y, dz = tz - p.z;
        if (dx * dx + dy * dy + dz * dz > 900) p.set(tx, ty, tz); else { p.x += dx * kLerp; p.y += dy * kLerp; p.z += dz * kLerp; }
      }
      v.yaw += ((((-f.trk * D2R - v.yaw) + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * kYaw;
      const dist = cam.distanceTo(v.pos);
      if (t - v.last > TRAIL_EVERY && dist < 2500) { v.last = t; v.trail.push({ x: u.x, y: u.y, z: u.z, a: f.alt }); if (v.trail.length > TRAIL_N - 1) v.trail.shift(); }
      if (f.emg) v.col.copy(COL.emg); else altColor(f.alt, v.col);
      const sel = f.id === selId, sc = clamp(dist * (ground ? 0.008 : 0.017), 0.03, 24) * (sel ? 1.35 : 1);
      if (dist < 3000 || sel) {
        s.copy(n).negate();
        const pitch = clamp(Math.atan2(f.vr * this.altScale, f.spd + 1e-4) * 0.7, -0.22, 0.32), bank = clamp(-(f.turn || 0) * 0.14, -0.45, 0.45);
        this.tmpE.set(pitch, v.yaw, bank, 'YXZ'); this.tmpQ2.setFromEuler(this.tmpE);
        this.tmpQ.setFromRotationMatrix(this.tmpM.makeBasis(e, u, s)).multiply(this.tmpQ2);
        const M = this.models[f.model] || this.models.narrow, j = M.n++;
        this.tmpM.compose(v.pos, this.tmpQ, this.tmpS.setScalar(sc * M.size)); M.body.setMatrixAt(j, this.tmpM); M.tail.setMatrixAt(j, this.tmpM);
        this.tmpC.copy(v.col).lerp(COL.white, sel ? 0.75 : 0.42); M.body.setColorAt(j, this.tmpC);
        if (f.livery) this.tmpC.set(f.livery).lerp(COL.white, sel ? 0.3 : 0); M.tail.setColorAt(j, this.tmpC); ip++;
      }
      hp[i * 3] = v.pos.x; hp[i * 3 + 1] = v.pos.y; hp[i * 3 + 2] = v.pos.z;
      const hk = sel ? 1 : 0.9; hc[i * 3] = v.col.r * hk; hc[i * 3 + 1] = v.col.g * hk; hc[i * 3 + 2] = v.col.b * hk;
      // nav lights: left red, right green, tail strobe white, belly beacon red
      const near = dist < 800, cy = Math.cos(v.yaw), sy = Math.sin(v.yaw), ph = t + (f.phase || 0);
      for (let k = 0; k < 4; k++) {
        const L = NAV[k], j = (i * 4 + k) * 3, on = k < 2 ? 1 : k === 2 ? ((ph * 1.1) % 1 < 0.08 ? 1 : 0) : ((ph * 0.8) % 1 < 0.14 ? 1 : 0);
        if (near) {
          const X = (L[0] * cy + L[2] * sy) * sc, Y = L[1] * sc, Z = (-L[0] * sy + L[2] * cy) * sc;
          lp[j] = v.pos.x + e.x * X + u.x * Y - n.x * Z; lp[j + 1] = v.pos.y + e.y * X + u.y * Y - n.y * Z; lp[j + 2] = v.pos.z + e.z * X + u.z * Y - n.z * Z;
        }
        const m = near ? on * glow : 0; lc[j] = L[3] * m; lc[j + 1] = L[4] * m; lc[j + 2] = L[5] * m;
      }
      const j = i * 6, gr = EARTH_R + 0.05;
      dp[j] = v.pos.x; dp[j + 1] = v.pos.y; dp[j + 2] = v.pos.z; dp[j + 3] = u.x * gr - O.x; dp[j + 4] = u.y * gr - O.y; dp[j + 5] = u.z * gr - O.z;
      i++;
    }
    for (const id of this.vis.keys()) if (!seen.has(id)) this.vis.delete(id);
    // upload only the part of each buffer in use: they are sized for MAXP aircraft, and sending them whole every frame
    // costs several MB of GPU traffic even with a handful of planes
    for (const k in this.models) {
      const M = this.models[k];
      for (const im of [M.body, M.tail]) { im.count = M.n; upd(im.instanceMatrix, M.n * 16); if (im.instanceColor) upd(im.instanceColor, M.n * 3); }
    }
    upd(this.halo.geometry.attributes.position, i * 3); upd(this.halo.geometry.attributes.color, i * 3);
    upd(this.lights.geometry.attributes.position, i * 12); upd(this.lights.geometry.attributes.color, i * 12);
    this.halo.geometry.setDrawRange(0, i); this.lights.geometry.setDrawRange(0, i * 4);
    upd(this.drops.geometry.attributes.position, i * 6); this.drops.geometry.setDrawRange(0, i * 2);
    if ((this.trailClock += dt) > 0.1) { this.trailClock = 0; this.buildTrails(flights); }
  }
  buildTrails(flights) {
    let n = 0; const P = this.trailPos, C = this.trailCol, as = this.altScale, O = this.O, cam = this.camera.position;
    if (this.cam.r < 4000 || this.mode === 'ground') {
      const lim = (Math.min(this.cam.r, 1200) * 3 + 60) ** 2;
      let list = [];
      for (const f of flights) { const v = this.vis.get(f.id); if (v) { const d = v.pos.distanceToSquared(cam); if (d < lim) list.push([f, v, d]); } }
      if (list.length > TRAIL_F) list = list.sort((a, b) => a[2] - b[2]).slice(0, TRAIL_F);
      for (const [f, v] of list) {
        if (!v.filled) this.backfill(f, v);
        const tr = v.trail, m = tr.length, wk = f.ctr === 'persistent' ? 0 : f.ctr === 'short' ? m - 10 : m + 1;
        let px = null, py, pz;
        for (let k = 0; k <= m && n < TRAIL_F * TRAIL_N; k++) {
          let x, y, z;
          if (k < m) { const p = tr[k], rr = EARTH_R + p.a * as + 0.05; x = p.x * rr - O.x; y = p.y * rr - O.y; z = p.z * rr - O.z; } else { x = v.pos.x; y = v.pos.y; z = v.pos.z; }
          if (px !== null) {
            const j = n * 6, fa = 0.45 + 0.55 * (k - 1) / Math.max(1, m), fb = 0.45 + 0.55 * k / Math.max(1, m);
            P[j] = px; P[j + 1] = py; P[j + 2] = pz; P[j + 3] = x; P[j + 4] = y; P[j + 5] = z;
            const cc = k >= wk ? CONTRAIL : v.col; // predicted contrails are drawn white
            C[j] = cc.r * fa; C[j + 1] = cc.g * fa; C[j + 2] = cc.b * fa; C[j + 3] = cc.r * fb; C[j + 4] = cc.g * fb; C[j + 5] = cc.b * fb;
            n++;
          }
          px = x; py = y; pz = z;
        }
      }
    }
    const g = this.trails.geometry;
    upd(g.attributes.instanceStart.data, n * 6); upd(g.attributes.instanceColorStart.data, n * 6);
    g.instanceCount = n;
  }

  /* ---------- satellites ---------- */
  buildSats() {
    const g = new THREE.BufferGeometry(), N = 400;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.satPts = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTexture(), size: 12, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.satPts.frustumCulled = false; this.satPts.renderOrder = 7; this.scene.add(this.satPts);
    this.orbit = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#7fe7ff', transparent: true, opacity: 0.5, depthWrite: false }));
    this.orbit.frustumCulled = false; this.orbit.renderOrder = 7; this.scene.add(this.orbit);
    this.transitGroup = new THREE.Group(); this.homeGroup.add(this.transitGroup);
  }
  /** Draw satellites; k runs past 1 to extrapolate from the last two SGP4 fixes until the next update. */
  syncSats(list, k, on) {
    const P = this.satPts.geometry.attributes.position.array, C = this.satPts.geometry.attributes.color.array, O = this.O; let i = 0;
    if (on) for (const s of list) {
      if (!s.pos || i >= 400) continue;
      const a = s.prev || s.pos, b = s.pos, x = b.x + (b.x - a.x) * k - O.x, y = b.y + (b.y - a.y) * k - O.y, z = b.z + (b.z - a.z) * k - O.z;
      (s.scene || (s.scene = new THREE.Vector3())).set(x, y, z);
      P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
      const m = s.lit === false ? 0.22 : 1, c = s.star ? [0.55, 1, 1.1] : [0.75, 0.78, 0.9];
      C[i * 3] = c[0] * m * (s.star ? 1.3 : 0.6); C[i * 3 + 1] = c[1] * m * (s.star ? 1.3 : 0.6); C[i * 3 + 2] = c[2] * m * (s.star ? 1.3 : 0.6);
      i++;
    }
    const g = this.satPts.geometry; g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = true; g.setDrawRange(0, i);
    this.orbit.visible = on; this.orbit.position.copy(O).negate();
  }
  /** The next orbit of the ISS, as earth-centred points. */
  setOrbit(pts) { this.orbit.geometry.dispose(); this.orbit.geometry = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x, p.y, p.z))); }
  /** Ground lines from which an aircraft crosses the sun or moon dead centre. */
  setTransitLines(list) {
    for (const c of [...this.transitGroup.children]) { c.geometry.dispose(); c.material.dispose(); this.transitGroup.remove(c); }
    for (const tr of list) {
      const g = new LineGeometry(); g.setPositions(tr.line.flatMap(p => [p.x, -curvDrop(p.x, p.z) + 0.08, p.z]));
      const m = new LineMaterial({ color: tr.body === 'sun' ? '#FFC53D' : '#CFE0FF', linewidth: 4, transparent: true, opacity: 0.95, depthWrite: false });
      m.resolution.copy(this.trailMat.resolution);
      const l = new Line2(g, m); l.computeLineDistances(); l.renderOrder = 3; l.frustumCulled = false; this.transitGroup.add(l);
    }
  }

  /* ---------- camera ---------- */
  setMode(m) {
    const prev = this.mode; this.mode = m; this.fly = null; this.inertia = null;
    if (m === 'top') { this.cam.phi = 0.02; this.cam.theta = 0; if (this.cam.r < 60) this.cam.r = 140; }
    if (m === 'orbit' && prev === 'top') { this.cam.phi = 1.0; }
    if (m === 'ground') { this.cam.fov = 62; }
    if ((m === 'ground') !== (prev === 'ground')) this.snap = true;
  }
  // tilt eases to straight down as you zoom out, so the whole globe sits centred
  effPhi(r) { return Math.min(this.cam.phi, lerp(1.45, 0, smooth(1200, 9000, r))); }
  lookAtRel(rel) { this.cam.yaw = rel.brg * D2R; this.cam.pitch = clamp(rel.elev * D2R, -0.1, 1.5); }

  /** Animate to a place: along the great circle, pulling out to see both ends when they're far apart. */
  flyTo(lat, lon, r, o = {}) {
    const c = this.cam, a = { lat: c.lat, lon: c.lon, r: c.r, h: c.h, th: c.theta, ph: c.phi };
    const b = { lat, lon, r: r ?? c.r, h: o.h ?? 2, th: o.theta ?? c.theta, ph: o.phi ?? c.phi };
    b.th = a.th + ((((b.th - a.th) + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
    this.inertia = null;
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    if (o.instant || reduced()) { this.fly = null; Object.assign(c, { lat: b.lat, lon: b.lon, r: b.r, h: b.h, theta: b.th, phi: b.ph }); this.snap = true; return; }
    const peak = Math.max(a.r, b.r, Math.min(d * 1.2, 16000));
    this.fly = { a, b, t: 0, bump: Math.log(peak) - Math.max(Math.log(a.r), Math.log(b.r)),
      ua: unitDir(a.lat, a.lon, new THREE.Vector3()), ub: unitDir(b.lat, b.lon, new THREE.Vector3()),
      dur: o.dur ?? clamp(0.8 + Math.log10(1 + d) * 0.4 + Math.abs(Math.log(b.r / a.r)) * 0.08, 0.8, 2.6) };
  }
  stepFly(dt) {
    const f = this.fly, c = this.cam; f.t += dt;
    const k = Math.min(1, f.t / f.dur), e = ease(k), ang = f.ua.angleTo(f.ub);
    const p = ang < 1e-6 ? f.ub : this.tmpW.copy(f.ua).multiplyScalar(Math.sin((1 - e) * ang) / Math.sin(ang)).addScaledVector(f.ub, Math.sin(e * ang) / Math.sin(ang));
    const ll = toLatLon(p.x, p.y, p.z); c.lat = ll.lat; c.lon = ll.lon;
    c.r = Math.exp(lerp(Math.log(f.a.r), Math.log(f.b.r), e) + f.bump * 4 * e * (1 - e));
    c.h = lerp(f.a.h, f.b.h, e); c.theta = lerp(f.a.th, f.b.th, e); c.phi = lerp(f.a.ph, f.b.ph, e);
    if (k >= 1) this.fly = null;
  }
  /** Straight down from space to the observer, the opening shot. */
  intro() { const h = this.homeLL; this.flyTo(h.lat, h.lon, HOME_R, { theta: 0.6, phi: 1.02, dur: reduced() ? 0 : 4.2 }); }
  recenter() {
    if (this.mode === 'ground') { this.cam.yaw = 0; this.cam.pitch = 0.4; return; }
    const h = this.homeLL; this.flyTo(h.lat, h.lon, HOME_R, { theta: this.mode === 'top' ? 0 : 0.6, phi: this.mode === 'top' ? 0.02 : 1.02 });
  }
  pan(dx, dy) {
    const c = this.cam, r = this.fol ? Math.min(c.r, 30) : c.r, phi = this.effPhi(r);
    const k = 2 * r * Math.tan(this.camera.fov * D2R / 2) / this.h, kv = k / Math.max(Math.cos(phi), 0.3);
    const st = Math.sin(c.theta), ct = Math.cos(c.theta);
    let de = -dx * k * ct - dy * kv * st, dn = -dx * k * st + dy * kv * ct;
    const m = Math.hypot(de, dn), cap = 3500; if (m > cap) { de *= cap / m; dn *= cap / m; }
    c.lat = clamp(c.lat + dn / 111.195, -85, 85);
    c.lon += de / (111.195 * Math.max(0.05, Math.cos(c.lat * D2R))); c.lon = ((c.lon + 540) % 360) - 180;
  }
  /** Where a screen point meets the ground, or null if it's off the globe. */
  groundAt(sx, sy) {
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(sx / this.w * 2 - 1, -(sy / this.h) * 2 + 1), this.camera);
    const oc = this.tmpW.copy(this.camera.position).add(this.O), b = oc.dot(ray.ray.direction), cc = oc.lengthSq() - EARTH_R * EARTH_R, disc = b * b - cc;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc); if (t < 0) return null;
    const p = oc.addScaledVector(ray.ray.direction, t); return toLatLon(p.x, p.y, p.z);
  }
  zoom(k, sx, sy) {
    if (this.mode === 'ground') { this.cam.fov = clamp(this.cam.fov * k, 12, 85); return; }
    const c = this.cam, r0 = c.r, r1 = clamp(r0 * k, 0.6, 26000); this.fly = null;
    if (sx != null && !this.fol && (k < 1 || r0 < 3000)) {
      const hit = this.groundAt(sx, sy);
      if (hit) {
        const a = unitDir(c.lat, c.lon, new THREE.Vector3()), b = unitDir(hit.lat, hit.lon, new THREE.Vector3()), ang = a.angleTo(b), f = 1 - r1 / r0;
        if (ang > 1e-7 && ang < 1.2) {
          const p = a.multiplyScalar(Math.sin((1 - f) * ang) / Math.sin(ang)).addScaledVector(b, Math.sin(f * ang) / Math.sin(ang)), ll = toLatLon(p.x, p.y, p.z);
          c.lat = clamp(ll.lat, -85, 85); c.lon = ll.lon;
        }
      }
    }
    c.r = r1;
  }

  /* ---------- input ----------
     Zoomed in (orbit view): drag orbits and tilts, right-drag (or shift/ctrl/alt-drag) pans, two fingers pinch, twist and pan.
     Zoomed out, or in map view: drag pans, right-drag turns (and tilts in orbit view). */
  bindInput() {
    const el = this.canvas, ptrs = new Map(); let drag = null, two = null;
    const gesture = () => { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, a: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
    const touch = () => { this.lastInteract = this.clock.elapsedTime; this.fly = null; this.onInteract && this.onInteract(); };
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); this.inertia = null;
      const alt = e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey || e.altKey;
      if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, moved: 0, rot: this.orbitDrag() ? !alt : alt, vx: 0, vy: 0, t: performance.now() };
      if (ptrs.size === 2) { two = gesture(); drag = null; }
      touch();
    });
    el.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const c = this.cam;
      if (ptrs.size === 2 && two) {
        const g = gesture(); this.zoom(two.d / g.d);
        if (this.mode !== 'ground') { c.theta += ((g.a - two.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI; if (!this.fol) this.pan(g.mx - two.mx, g.my - two.my); }
        two = g; touch(); return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
      if (this.mode === 'ground') { c.yaw -= dx * 0.004 * c.fov / 60; c.pitch = clamp(c.pitch + dy * 0.004 * c.fov / 60, -0.2, 1.52); }
      else if (drag.rot && this.mode === 'orbit') { c.theta -= dx * 0.005; c.phi = clamp(c.phi - dy * 0.004, 0, 1.45); }
      else if (drag.rot) c.theta -= dx * 0.005;
      else {
        if (this.fol && drag.moved > 6) this.onUnfollow && this.onUnfollow();
        this.pan(dx, dy);
        const now = performance.now(), ms = Math.max(8, now - drag.t); drag.t = now;
        drag.vx = drag.vx * 0.3 + dx / ms * 1000 * 0.7; drag.vy = drag.vy * 0.3 + dy / ms * 1000 * 0.7;
      }
      touch();
    });
    const end = e => {
      if (drag && drag.moved < 6 && e.type === 'pointerup' && ptrs.size === 1) this.onPick && this.onPick(e.clientX, e.clientY);
      else if (drag && !drag.rot && this.mode !== 'ground' && performance.now() - drag.t < 80 && Math.hypot(drag.vx, drag.vy) > 300 && !reduced()) { const v = Math.hypot(drag.vx, drag.vy), k = Math.min(1, 2200 / v); this.inertia = { vx: drag.vx * k, vy: drag.vy * k }; }
      ptrs.delete(e.pointerId); if (ptrs.size < 2) two = null; if (!ptrs.size) drag = null;
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', e => { e.preventDefault(); this.inertia = null; this.zoom(Math.exp(e.deltaY * 0.0012), e.clientX, e.clientY); touch(); }, { passive: false });
    el.addEventListener('dblclick', e => {
      if (this.mode === 'ground') return;
      const hit = this.groundAt(e.clientX, e.clientY); if (hit) this.flyTo(hit.lat, hit.lon, Math.max(1, this.cam.r * 0.35), { dur: 0.9 });
    });
  }
  orbitDrag() { return this.mode === 'orbit' && (this.fol ? Math.min(this.cam.r, 30) : this.cam.r) < ORBIT_R; }
  resize(w, h) {
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.trailMat.resolution.set(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
  }
  /** Screen position of a scene point. vis is false when it's off screen or hidden behind the earth. */
  project(v, out) {
    this.tmpS.copy(v).project(this.camera);
    out.vis = this.tmpS.z < 1 && Math.abs(this.tmpS.x) < 1.1 && Math.abs(this.tmpS.y) < 1.1;
    out.x = (this.tmpS.x + 1) / 2 * this.w; out.y = (1 - this.tmpS.y) / 2 * this.h;
    if (out.vis) {
      const cam = this.camera.position, d = this.tmpS.copy(v).sub(cam), L = d.length(); d.divideScalar(L || 1);
      const oc = this.tmpW.copy(cam).add(this.O), b = oc.dot(d), disc = b * b - (oc.lengthSq() - (EARTH_R - 0.3) ** 2);
      if (disc > 0) { const t = -b - Math.sqrt(disc); if (t > 0 && t < L - 0.05) out.vis = false; }
    }
    return out;
  }
  projectHome(v, out) { return this.project(this.tmpV.copy(v).applyMatrix4(this.homeGroup.matrix), out); }

  frame(dt, t, followPos) {
    const c = this.cam, ground = this.mode === 'ground';
    this.altScale += ((ground ? 1 : 2.2) - this.altScale) * (1 - Math.exp(-dt * 3));
    this.fol = !!followPos;
    if (this.fly) this.stepFly(dt);
    else if (this.inertia) {
      const iv = this.inertia; this.pan(iv.vx * dt, iv.vy * dt); const k = Math.exp(-dt * 4); iv.vx *= k; iv.vy *= k;
      if (Math.hypot(iv.vx, iv.vy) < 20) this.inertia = null;
    } else if (this.mode === 'orbit' && (t - this.lastInteract > 6 || this.cinematic) && !followPos && c.r < 1500 && !reduced()) c.theta += dt * (this.cinematic ? 0.05 : 0.025);
    if (followPos) { const ll = toLatLon(followPos.x + this.O.x, followPos.y + this.O.y, followPos.z + this.O.z); c.lat = ll.lat; c.lon = ll.lon; c.h = ll.h; }
    // keep the floating origin near what we're looking at
    const anchor = ground ? this.llToScene(this.homeLL.lat, this.homeLL.lon, 0, this.tmpV) : this.llToScene(c.lat, c.lon, c.h, this.tmpV);
    if (anchor.length() > 250) this.rebase(anchor.clone());
    const e = this.e, n = this.n, u = this.u, pos = new THREE.Vector3(), look = new THREE.Vector3(), up = new THREE.Vector3();
    let fov;
    if (ground) {
      enu(this.homeLL.lat, this.homeLL.lon, e, n, u);
      pos.copy(this.homePos).addScaledVector(u, 0.1); fov = c.fov;
      look.copy(pos).addScaledVector(e, Math.sin(c.yaw) * Math.cos(c.pitch)).addScaledVector(n, Math.cos(c.yaw) * Math.cos(c.pitch)).addScaledVector(u, Math.sin(c.pitch));
      up.copy(u);
    } else {
      const r = followPos ? Math.min(c.r, 30) : c.r, phi = this.effPhi(r);
      enu(c.lat, c.lon, e, n, u);
      look.copy(u).multiplyScalar(EARTH_R + c.h).sub(this.O);
      const hv = this.hv.copy(e).multiplyScalar(Math.sin(c.theta)).addScaledVector(n, -Math.cos(c.theta));
      pos.copy(look).addScaledVector(hv, r * Math.sin(phi)).addScaledVector(u, r * Math.cos(phi));
      up.copy(hv).multiplyScalar(-Math.cos(phi)).addScaledVector(u, Math.sin(phi));
      fov = this.w < 700 ? 60 : 48;
    }
    const k = this.snap ? 1 : 1 - Math.exp(-dt * (this.fly ? 14 : 6)); this.snap = false;
    this.curPos.lerp(pos, k); this.curLook.lerp(look, k); this.curUp.lerp(up, k).normalize();
    this.camera.position.copy(this.curPos); this.camera.up.copy(this.curUp); this.camera.lookAt(this.curLook);
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 5)); this.camera.updateProjectionMatrix(); }
    // sky and stars travel with the camera; above the atmosphere the sky gives way to space
    const camE = this.tmpW.copy(this.camera.position).add(this.O), alt = camE.length() - EARTH_R, localUp = camE.normalize();
    this.sky.position.copy(this.camera.position); this.stars.position.copy(this.camera.position);
    const su = this.sky.material.uniforms; su.up.value.copy(localUp);
    const space = smooth(40, 260, alt);
    su.rayleigh.value = 1.8 * (1 - space); su.mieCoefficient.value = 0.003 * (1 - space); su.turbidity.value = (this.turbidity || 2) * (1 - space) + 0.1;
    this.sky.visible = alt < 300;
    this.stars.material.opacity = Math.max(1 - smooth(-12, -2, this.sun ? this.sun.alt : 30), space);
    this.hemi.position.copy(localUp); this.sunLight.position.copy(this.sunDir).multiplyScalar(500);
    this.renderer.toneMappingExposure = lerp(lerp(0.62, 0.46, this.day), 0.6, space);
    this.bloom.strength = lerp(lerp(0.75, 0.18, this.day), 0.3, space);
    // haze: thick at ground level, thinner as you pull back, gone in space
    const bf = this.baseFog || 0.0032;
    const fd = ground ? Math.max(bf * 3, 0.009) : bf * clamp(110 / Math.max(1, this.curPos.distanceTo(this.curLook)), 0.2, 1) * (1 - smooth(60, 500, alt));
    this.scene.fog.density = fd < this.scene.fog.density ? fd : this.scene.fog.density + (fd - this.scene.fog.density) * (1 - Math.exp(-dt * 3));
    // things that belong to the observer fade once you're far from home
    const dHome = this.camera.position.distanceTo(this.homePos);
    this.cloud.visible = this.cloudsOn && dHome < 2500; this.cloud.position.y = 1.8 * this.altScale - 0.2;
    this.cloud.material.uniforms.uTime.value = t;
    this.cloud.material.uniforms.uOpacity.value = (this.mode === 'top' ? 0.35 : 0.9) * (1 - smooth(700, 2500, dHome));
    const pk = (t * 0.5) % 1; this.pulse.scale.setScalar(0.5 + pk * 6); this.pulse.material.opacity = 0.7 * (1 - pk);
    this.obs.visible = !ground && dHome < 4000; this.drops.visible = !ground && c.r < 2500;
    this.halo.material.size = lerp(26, 9, smooth(600, 6000, c.r));
    this.pin.scale.setScalar(clamp(dHome * 0.012, 0.3, 4)); this.pin.visible = !ground;
    this.globe.update(this.camera, this.O, this.h);
    this.composer.render();
  }
}
