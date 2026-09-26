// Streaming globe: web-mercator map tiles draped on a spherical earth, refined by how big each tile is on screen.
// The scene works in an earth-centred frame (km) shifted by a floating origin O, so nearby geometry keeps full precision.
import * as THREE from 'three';
import { D2R, R2D, EARTH_R, clamp, unitDir } from './geo.js';

export const TILE_STYLES = {
  satellite: { url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, base: '#0b1d30', ice: '#dfe7ee', maxZ: 17, names: true,
    credit: 'Imagery © Esri, Maxar, Earthstar Geographics · City lights NASA Black Marble' },
  map: { url: (z, x, y) => `https://${'abcd'[(x + y) % 4]}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`, base: '#d4dadc', ice: '#f2f3f0', maxZ: 18, names: false,
    credit: '© OpenStreetMap contributors © CARTO · City lights NASA Black Marble' }
};
const AUX = {
  names: { url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`, maxZ: 13 },
  lights: { url: (z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`, maxZ: 8 },
  // RainViewer's latest radar frame; the path changes every 10 minutes and deeper zooms borrow zoom 7
  radar: { base: null, url: (z, x, y) => `${AUX.radar.base}/256/${z}/${x}/${y}/2/1_1.png`, maxZ: 7 }
};
const KINDS = ['names', 'lights', 'radar'], UNI = { names: ['uNameTex', 'uNameXf'], lights: ['uLightTex', 'uLightXf'], radar: ['uRadarTex', 'uRadarXf'] };
const ROOTZ = 1, SSE = 300, MAX_TILES = 520, MAX_AUX = 260, MAX_LOADS = 12, BUILDS_PER_FRAME = 6;
const NONE = 0, LOADING = 1, LOADED = 2, READY = 3, FAILED = 4;
const tileLat = (y, z) => Math.atan(Math.sinh(Math.PI - 2 * Math.PI * y / 2 ** z)) * R2D;
const tileLon = (x, z) => x / 2 ** z * 360 - 180;
const MERC_MAX = tileLat(0, 0);

function loadImage(url, done, fail) {
  const img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async';
  // decode off the main thread when we can; Chrome parks decode() in background tabs, so never wait on it for long
  img.onload = () => Promise.race([img.decode && !document.hidden ? img.decode().catch(() => {}) : null, new Promise(r => setTimeout(r, 300))]).then(() => done(img));
  img.onerror = fail; img.src = url;
}

/* Tint the ground by the real sun, blend the place-name overlay, and switch on city lights on the night side. */
function patch(shared, own) {
  return sh => {
    Object.assign(sh.uniforms, shared, own);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec3 uCenter;\nvarying vec3 vGN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvGN = (modelMatrix * vec4(position, 1.0)).xyz - uCenter;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec3 uSun; uniform float uNames, uLights, uRadar; uniform sampler2D uNameTex, uLightTex, uRadarTex; uniform vec4 uNameXf, uLightXf, uRadarXf; varying vec3 vGN;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  float ndl = dot(normalize(vGN), uSun), day = smoothstep(-0.12, 0.1, ndl), gold = 1.0 - smoothstep(0.035, 0.31, ndl);
  #ifdef USE_MAP
  if (uNameXf.z > 0.0) { vec4 o = texture2D(uNameTex, uNameXf.xy + vMapUv * uNameXf.z); diffuseColor.rgb = mix(diffuseColor.rgb, o.rgb, o.a * uNames); }
  #endif
  diffuseColor.rgb *= mix(0.14, 1.0, day) * vec3(1.0, mix(0.9, 1.0, 1.0 - gold * 0.4), mix(0.82, 1.0, 1.0 - gold * 0.5));
  #ifdef USE_MAP
  if (uLightXf.z > 0.0) { vec3 c = texture2D(uLightTex, uLightXf.xy + vMapUv * uLightXf.z).rgb; diffuseColor.rgb += c * c * vec3(1.0, 0.82, 0.58) * (1.0 - smoothstep(-0.18, 0.04, ndl)) * uLights * 1.5; }
  if (uRadarXf.z > 0.0) { vec4 r = texture2D(uRadarTex, uRadarXf.xy + vMapUv * uRadarXf.z); diffuseColor.rgb = mix(diffuseColor.rgb, r.rgb, r.a * uRadar * 0.85); }
  #endif
}`);
  };
}

const ATMO_VS = `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN; varying vec3 vP;
void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp;
#include <logdepthbuf_vertex>
}`;
const ATMO_FS = `
#include <logdepthbuf_pars_fragment>
uniform vec3 uSun, uCenter; uniform float uOpacity, uOuter; varying vec3 vN; varying vec3 vP;
void main(){
  #include <logdepthbuf_fragment>
  vec3 v = normalize(cameraPosition - vP);
  float lit = smoothstep(-0.35, 0.45, dot(normalize(vP - uCenter), uSun));
  float d = dot(v, vN), a;
  if (uOuter > 0.5) a = pow(clamp(-d / 0.24, 0.0, 1.0), 2.2);   // halo beyond the limb (back faces of a bigger shell)
  else a = pow(1.0 - clamp(d, 0.0, 1.0), 3.5) * 0.85;            // haze thickening toward the limb (front faces)
  vec3 col = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.62, 0.42), (1.0 - lit) * lit * 2.2);
  gl_FragColor = vec4(col * a * mix(0.08, 1.0, lit) * uOpacity, 1.0);
}`;

class Tile {
  constructor(z, x, y) {
    Object.assign(this, { z, x, y, key: z + '/' + x + '/' + y, state: NONE, used: 0, failT: 0, mesh: null });
    const n = tileLat(y, z), s = tileLat(y + 1, z), w = tileLon(x, z), e = tileLon(x + 1, z), mid = tileLat(y + 0.5, z), mlon = (w + e) / 2;
    this.dir = unitDir(mid, mlon, new THREE.Vector3());
    this.c = this.dir.clone().multiplyScalar(EARTH_R);
    let rad = 0; const p = new THREE.Vector3();
    for (let i = 0; i <= 4; i++) for (const [la, lo] of [[n, w + (e - w) * i / 4], [s, w + (e - w) * i / 4], [n + (s - n) * i / 4, w], [n + (s - n) * i / 4, e]]) {
      rad = Math.max(rad, unitDir(la, lo, p).multiplyScalar(EARTH_R).distanceTo(this.c));
    }
    this.rad = rad + 0.2; this.ang = 2 * Math.asin(Math.min(1, this.rad / (2 * EARTH_R)));
    this.size = Math.max((e - w) * D2R * EARTH_R * Math.cos(mid * D2R), (n - s) * D2R * EARTH_R);
  }
}

export class Globe {
  constructor(renderer, scene) {
    this.group = new THREE.Group(); scene.add(this.group);
    this.aniso = renderer.capabilities.getMaxAnisotropy();
    this.U = { uSun: { value: new THREE.Vector3(0, 1, 0) }, uCenter: { value: new THREE.Vector3() }, uNames: { value: 1 }, uLights: { value: 1 }, uRadar: { value: 0 } };
    this.tiles = new Map(); this.aux = new Map(); this.built = []; this.shown = []; this.pre = [];
    this.frame = 0; this.loading = 0; this.style = 'satellite'; this.namesOn = true;
    this.frustum = new THREE.Frustum(); this.pm = new THREE.Matrix4(); this.sph = new THREE.Sphere(); this.camE = new THREE.Vector3();
    this.progress = { total: 1, done: 0 };
    // ocean underneath the tiles, and ice caps where web-mercator stops (about 85° N/S). Both sit well below the
    // surface: coarse tiles sag between vertices by a km or two, and the ocean must never poke through that sag.
    const baseMat = mat => { mat.onBeforeCompile = patch(this.U, {}); mat.customProgramCacheKey = () => 'globe-base'; return mat; };
    this.baseMat = baseMat(new THREE.MeshBasicMaterial({ color: TILE_STYLES.satellite.base, fog: true }));
    this.iceMat = baseMat(new THREE.MeshBasicMaterial({ color: TILE_STYLES.satellite.ice, fog: true }));
    this.base = new THREE.Group(); this.group.add(this.base);
    this.base.add(new THREE.Mesh(new THREE.SphereGeometry(EARTH_R - 30, 128, 64), this.baseMat));
    const cap = (90 - MERC_MAX + 0.4) * D2R;
    this.base.add(new THREE.Mesh(new THREE.SphereGeometry(EARTH_R - 20, 96, 8, 0, Math.PI * 2, 0, cap), this.iceMat));
    this.base.add(new THREE.Mesh(new THREE.SphereGeometry(EARTH_R - 20, 96, 8, 0, Math.PI * 2, Math.PI - cap, cap), this.iceMat));
    for (const m of this.base.children) m.renderOrder = -2;
    // atmosphere seen from space
    const atmo = (r, side, outer) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 128, 64), new THREE.ShaderMaterial({ vertexShader: ATMO_VS, fragmentShader: ATMO_FS, side, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, uniforms: { uSun: this.U.uSun, uCenter: this.U.uCenter, uOpacity: { value: 0 }, uOuter: { value: outer } } }));
      m.renderOrder = 8; m.frustumCulled = false; this.group.add(m); return m;
    };
    this.atmoOut = atmo(EARTH_R * 1.03, THREE.BackSide, 1); this.atmoIn = atmo(EARTH_R + 12, THREE.FrontSide, 0);
    this.roots();
  }

  roots() { this.rootTiles = []; for (let y = 0; y < 2 ** ROOTZ; y++) for (let x = 0; x < 2 ** ROOTZ; x++) this.rootTiles.push(this.get(ROOTZ, x, y)); }
  get(z, x, y) { const k = z + '/' + x + '/' + y; let t = this.tiles.get(k); if (!t) { t = new Tile(z, x, y); this.tiles.set(k, t); } return t; }
  setStyle(style) {
    if (style === this.style && this.tiles.size) return;
    this.style = style; for (const t of [...this.tiles.values()]) this.drop(t);
    this.baseMat.color.set(TILE_STYLES[style].base); this.iceMat.color.set(TILE_STYLES[style].ice);
    this.roots(); if (this.preAt) this.prefetch(this.preAt.lat, this.preAt.lon);
  }
  setNames(on) { this.namesOn = on; this.U.uNames.value = on ? 1 : 0; }
  async setRadar(on) {
    this.radarOn = on; this.U.uRadar.value = on ? 1 : 0; clearInterval(this.radarT);
    if (!on) return;
    const refresh = async () => {
      try {
        const j = await (await fetch('https://api.rainviewer.com/public/weather-maps.json', { cache: 'no-store' })).json(), f = j.radar?.past?.at(-1);
        if (!f || AUX.radar.base === j.host + f.path) return;
        AUX.radar.base = j.host + f.path; this.dropAux('radar');
      } catch (e) { /* radar unavailable */ }
    };
    await refresh(); this.radarT = setInterval(refresh, 10 * 60e3);
  }
  setSun(v) { this.U.uSun.value.copy(v); }

  /** Queue the tiles you'll need around a place before the camera gets there. */
  prefetch(lat, lon) {
    this.preAt = { lat, lon }; this.pre = [];
    const y = z => Math.floor((1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2 * 2 ** z), x = z => Math.floor((lon + 180) / 360 * 2 ** z);
    for (const z of [4, 6, 8, 9, 10]) {
      const n = 2 ** z, k = z >= 9 ? 1 : 0;
      for (let j = -k; j <= k; j++) for (let i = -k; i <= k; i++) { const ty = y(z) + j; if (ty >= 0 && ty < n) this.pre.push(this.get(z, ((x(z) + i) % n + n) % n, ty)); }
    }
  }

  visible(t, O) {
    const cam = this.camE, g = Math.acos(clamp(t.dir.dot(cam) / this.D, -1, 1));
    if (g > this.hz + t.ang) return false;
    this.sph.center.copy(t.c).sub(O); this.sph.radius = t.rad;
    return this.frustum.intersectsSphere(this.sph);
  }
  px(t) { return t.size / Math.max(t.c.distanceTo(this.camE) - t.rad, 0.05) * this.K; }
  select(t, O, out, req, maxZ) {
    if (!this.visible(t, O)) return;
    t.used = this.frame;
    if (t.state !== READY) { req.push([t, 1e6 - t.z]); return; }
    const px = this.px(t);
    if (t.z < maxZ && px > SSE) {
      const kids = []; let ok = true;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const k = this.get(t.z + 1, t.x * 2 + i, t.y * 2 + j); kids.push(k);
        if (!this.visible(k, O)) { k.culled = true; continue; }
        k.culled = false; k.used = this.frame;
        if (k.state !== READY) { ok = false; req.push([k, px]); }
      }
      if (ok) { for (const k of kids) if (!k.culled) this.select(k, O, out, req, maxZ); return; }
    }
    out.push(t);
  }

  load(t) {
    if (t.state === LOADING || t.state === LOADED || t.state === READY) return;
    t.state = LOADING; this.loading++;
    const style = this.style, end = () => { this.loading--; return this.tiles.get(t.key) === t && style === this.style; };
    loadImage(TILE_STYLES[style].url(t.z, t.x, t.y), img => { if (!end()) return; t.state = LOADED; t.img = img; this.built.push(t); },
      () => { if (!end()) return; t.state = FAILED; t.failT = performance.now(); });
  }
  build(t) {
    if (this.tiles.get(t.key) !== t || t.state !== LOADED) return;
    const tex = new THREE.Texture(t.img); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = this.aniso; tex.needsUpdate = true; t.img = null;
    const seg = t.z <= 2 ? 32 : t.z <= 5 ? 16 : 8, pos = [], uv = [], idx = [], p = new THREE.Vector3();
    for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) {
      unitDir(tileLat(t.y + j / seg, t.z), tileLon(t.x + i / seg, t.z), p).multiplyScalar(EARTH_R).sub(t.c);
      pos.push(p.x, p.y, p.z); uv.push(i / seg, 1 - j / seg);
    }
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), t.rad);
    t.own = {}; for (const k of KINDS) { t.own[UNI[k][0]] = { value: null }; t.own[UNI[k][1]] = { value: new THREE.Vector4() }; }
    const mat = new THREE.MeshBasicMaterial({ map: tex, fog: true });
    mat.onBeforeCompile = patch(this.U, t.own); mat.customProgramCacheKey = () => 'globe-tile';
    t.mesh = new THREE.Mesh(g, mat); t.mesh.frustumCulled = false; t.mesh.visible = false; this.group.add(t.mesh);
    t.state = READY;
  }
  drop(t) {
    if (t.mesh) { this.group.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh.material.map.dispose(); t.mesh.material.dispose(); t.mesh = null; }
    t.img = null; t.state = NONE; this.tiles.delete(t.key);
  }

  /* place-name overlay and night lights come from other tile sets; deeper tiles borrow a corner of an ancestor's image */
  bindAux(t) {
    for (const kind of KINDS) {
      const u = t.own[UNI[kind][0]], xf = t.own[UNI[kind][1]].value, A = AUX[kind];
      if ((kind === 'names' && (!this.namesOn || !TILE_STYLES[this.style].names || t.z > A.maxZ)) || (kind === 'radar' && (!this.radarOn || !A.base))) { xf.z = 0; continue; }
      const za = Math.min(t.z, A.maxZ), k = 2 ** (t.z - za), key = kind + za + '/' + Math.floor(t.x / k) + '/' + Math.floor(t.y / k);
      let a = this.aux.get(key);
      if (!a) {
        a = { tex: null, used: 0 }; this.aux.set(key, a);
        loadImage(A.url(za, Math.floor(t.x / k), Math.floor(t.y / k)), img => {
          if (this.aux.get(key) !== a) return;
          a.tex = new THREE.Texture(img); a.tex.colorSpace = THREE.SRGBColorSpace; a.tex.needsUpdate = true;
        }, () => {});
      }
      a.used = this.frame;
      if (!a.tex) { xf.z = 0; continue; }
      u.value = a.tex; xf.set((t.x % k) / k, 1 - (t.y % k) / k - 1 / k, 1 / k, 0);
    }
  }

  update(camera, O, cssH) {
    this.frame++;
    this.camE.copy(camera.position).add(O); this.D = this.camE.length();
    this.hz = this.D > EARTH_R ? Math.acos(EARTH_R / this.D) : 0.002;
    this.K = cssH / (2 * Math.tan(camera.fov * D2R / 2));
    camera.updateMatrixWorld(); this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.pm);
    const out = [], req = [], maxZ = TILE_STYLES[this.style].maxZ;
    for (const r of this.rootTiles) this.select(r, O, out, req, maxZ);
    const wanted = req.length;
    for (const t of this.pre) if (t.state !== READY) req.push([t, -1]);
    req.sort((a, b) => b[1] - a[1]);
    const now = performance.now();
    for (const [t] of req) { if (this.loading >= MAX_LOADS) break; if (t.state === NONE || (t.state === FAILED && now - t.failT > 30000)) this.load(t); }
    for (let b = 0; b < BUILDS_PER_FRAME && this.built.length; b++) this.build(this.built.shift());
    for (const t of this.shown) if (t.mesh) t.mesh.visible = false;
    for (const t of out) { t.mesh.visible = true; t.mesh.position.subVectors(t.c, O); this.bindAux(t); }
    this.shown = out;
    this.progress = { total: out.length + wanted, done: out.length };
    this.U.uCenter.value.copy(O).negate();
    this.base.position.copy(this.U.uCenter.value); this.atmoOut.position.copy(this.base.position); this.atmoIn.position.copy(this.base.position);
    const alt = this.D - EARTH_R, ao = THREE.MathUtils.smoothstep(alt, 25, 500);
    this.atmoOut.material.uniforms.uOpacity.value = ao; this.atmoIn.material.uniforms.uOpacity.value = ao * 0.9;
    this.atmoOut.visible = this.atmoIn.visible = ao > 0.001;
    if (this.tiles.size > MAX_TILES) this.evict();
    if (this.aux.size > MAX_AUX) this.evictAux();
  }
  evict() {
    const old = [...this.tiles.values()].filter(t => t.z > ROOTZ && t.used < this.frame - 2 && !this.pre.includes(t)).sort((a, b) => a.used - b.used);
    for (let n = this.tiles.size - Math.floor(MAX_TILES * 0.85), i = 0; n > 0 && i < old.length; n--, i++) this.drop(old[i]);
  }
  evictAux() {
    const old = [...this.aux.entries()].filter(([, a]) => a.used < this.frame - 2).sort((a, b) => a[1].used - b[1].used);
    for (let n = this.aux.size - Math.floor(MAX_AUX * 0.8), i = 0; n > 0 && i < old.length; n--, i++) this.freeAux(...old[i]);
  }
  freeAux(k, a) {
    this.aux.delete(k); if (!a.tex) return;
    for (const t of this.tiles.values()) if (t.own) for (const kind of KINDS) { const u = t.own[UNI[kind][0]]; if (u.value === a.tex) { u.value = null; t.own[UNI[kind][1]].value.z = 0; } }
    a.tex.dispose();
  }
  dropAux(kind) { for (const [k, a] of [...this.aux.entries()]) if (k.startsWith(kind)) this.freeAux(k, a); }
}
