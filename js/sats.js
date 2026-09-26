// Satellites: the space stations, Hubble and the brightest objects in orbit, from CelesTrak orbital elements.
// Positions come from SGP4 (satellite.js). Visible passes need the satellite sunlit while your sky is dark.
import * as SGP from 'satellite.js';
import { D2R, R2D, EARTH_R, sunPosition, enu } from './geo.js';

const GROUPS = ['stations', 'visual'], TTL = 6 * 3600e3;
// the ones worth a name on screen and a pass prediction
export const STAR = { 25544: 'ISS', 48274: 'Tiangong', 20580: 'Hubble' };

async function group(g) {
  const key = 'squawk.tle.' + g;
  try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c && Date.now() - c.t < TTL) return c.d; } catch (e) { /* no cache */ }
  const r = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=json`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch (e) { /* storage full or blocked */ }
  return d;
}

/** Earth-centred position in the globe's frame (km: +y north pole, +z lon 0, +x lon 90E) at a date, or null. */
function ecef(sat, date) {
  const pv = SGP.propagate(sat.rec, date);
  if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
  const f = SGP.eciToEcf(pv.position, SGP.gstime(date));
  return { x: f.y, y: f.z, z: f.x };
}

export class Sats {
  constructor() { this.list = []; this.passes = []; this.ready = false; }
  async load() {
    const seen = new Set(), out = [];
    for (const g of GROUPS) {
      let d; try { d = await group(g); } catch (e) { continue; }
      for (const o of d) {
        if (seen.has(o.NORAD_CAT_ID)) continue; seen.add(o.NORAD_CAT_ID);
        // keep the stations group to crewed stations and Hubble; the visual group is the ~150 brightest objects
        if (g === 'stations' && !STAR[o.NORAD_CAT_ID]) continue;
        try { out.push({ id: o.NORAD_CAT_ID, name: STAR[o.NORAD_CAT_ID] || o.OBJECT_NAME, star: !!STAR[o.NORAD_CAT_ID], rec: SGP.json2satrec(o) }); } catch (e) { /* bad element set */ }
      }
    }
    this.list = out; this.ready = out.length > 0; return this;
  }
  /** Refresh every satellite's position (call about once a second; the renderer interpolates between calls). */
  update(date) {
    for (const s of this.list) { s.prev = s.pos; s.pos = ecef(s, date); if (s.pos) { const r = Math.hypot(s.pos.x, s.pos.y, s.pos.z); s.alt = r - EARTH_R; } }
    this.at = date;
  }
  /** Earth-centred points along a satellite's path for the next `minutes`. */
  track(s, t0, minutes = 95) { const pts = []; for (let k = 0; k <= minutes; k++) { const p = ecef(s, new Date(t0 + k * 60e3)); if (p) pts.push(p); } return pts; }
  /** Where a satellite sits in your sky: {az, el, range} from observer lat, lon. */
  static lookFrom(p, lat, lon) {
    const e = {}, n = {}, u = {}; enu(lat, lon, e, n, u);
    const c = lat * D2R, l = lon * D2R, ox = EARTH_R * Math.cos(c) * Math.sin(l), oy = EARTH_R * Math.sin(c), oz = EARTH_R * Math.cos(c) * Math.cos(l);
    const dx = p.x - ox, dy = p.y - oy, dz = p.z - oz, r = Math.hypot(dx, dy, dz);
    const E = (dx * e.x + dy * e.y + dz * e.z) / r, N = (dx * n.x + dy * n.y + dz * n.z) / r, U = (dx * u.x + dy * u.y + dz * u.z) / r;
    return { az: (Math.atan2(E, N) * R2D + 360) % 360, el: Math.asin(U) * R2D, range: r };
  }
  /** Whether a point in orbit is in sunlight (cylindrical earth shadow). */
  static sunlit(p, date) {
    const s = sunPosition(date, 0, 0), e = {}, n = {}, u = {}; enu(0, 0, e, n, u);
    const el = s.alt * D2R, az = s.az * D2R, c = Math.cos(el);
    const sx = e.x * Math.sin(az) * c + n.x * Math.cos(az) * c + u.x * Math.sin(el), sy = e.y * Math.sin(az) * c + n.y * Math.cos(az) * c + u.y * Math.sin(el), sz = e.z * Math.sin(az) * c + n.z * Math.cos(az) * c + u.z * Math.sin(el);
    const d = p.x * sx + p.y * sy + p.z * sz;
    if (d > 0) return true;
    return Math.hypot(p.x - d * sx, p.y - d * sy, p.z - d * sz) > EARTH_R;
  }
  /**
   * Visible passes of the named satellites over the next `hours`: above 10°, sunlit, with the observer's sky dark
   * (sun below -6°). Runs in slices so it never blocks a frame for long.
   */
  async predict(lat, lon, hours = 24) {
    const out = [], t0 = Date.now(), stepS = 20;
    for (const s of this.list.filter(x => x.star)) {
      let pass = null;
      for (let k = 0; k <= hours * 3600 / stepS; k++) {
        if (k % 400 === 0) await new Promise(r => setTimeout(r, 0));
        const date = new Date(t0 + k * stepS * 1000), p = ecef(s, date); if (!p) break;
        const L = Sats.lookFrom(p, lat, lon);
        if (L.el >= 10) {
          const vis = Sats.sunlit(p, date) && sunPosition(date, lat, lon).alt < -6;
          if (!pass) pass = { sat: s, start: date, startAz: L.az, max: L.el, maxAz: L.az, maxT: date, vis: false };
          if (L.el > pass.max) { pass.max = L.el; pass.maxAz = L.az; pass.maxT = date; }
          pass.vis = pass.vis || vis; pass.end = date; pass.endAz = L.az;
        } else if (pass) { if (pass.vis) out.push(pass); pass = null; }
      }
    }
    this.passes = out.sort((a, b) => a.start - b.start); this.predAt = Date.now();
    return this.passes;
  }
}
