// Looking ahead from where you stand: overhead passes, aircraft crossing the sun or moon, and contrails.
// Flights are extrapolated in a straight line at constant speed and climb, so predictions firm up as they get closer.
import { D2R, R2D, EARTH_R, clamp, curvDrop } from './geo.js';

const KY = 110.574, kx = lat => 111.32 * Math.cos(lat * D2R);
/** Flight position relative to observer o ({lat0, lon0}) on the local plane, km: +x east, +z south. */
function local(f, o) {
  let dl = f.lon - o.lon0; if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
  return { x: dl * kx(o.lat0), z: -(f.lat - o.lat0) * KY };
}
const look = (x, z, alt) => { const d = Math.hypot(x, z); return { d, brg: (Math.atan2(x, -z) * R2D + 360) % 360, elev: Math.atan2(alt - curvDrop(x, z), Math.max(d, 0.01)) * R2D }; };

/** When and where a flight passes closest to the observer in the next `horizon` seconds. */
export function closestApproach(f, o, horizon = 900) {
  const p = local(f, o), s = f.trk * D2R, vx = f.spd * Math.sin(s), vz = -f.spd * Math.cos(s), v2 = vx * vx + vz * vz;
  if (v2 < 1e-6) return null;
  const t = clamp(-(p.x * vx + p.z * vz) / v2, 0, horizon), x = p.x + vx * t, z = p.z + vz * t, alt = Math.max(0, f.alt + f.vr * t);
  return { t, alt, ...look(x, z, alt) };
}

/* ---------------- transits ---------------- */
// The sun and the moon are each about 0.53° across, so a pass within 0.27° of the centre crosses the disc.
export const DISC = 0.27;
const sep = (e1, a1, e2, a2) => Math.acos(clamp(Math.sin(e1 * D2R) * Math.sin(e2 * D2R) + Math.cos(e1 * D2R) * Math.cos(e2 * D2R) * Math.cos((a1 - a2) * D2R), -1, 1)) * R2D;

/**
 * Search the next `horizon` seconds for aircraft passing in front of a body. body(t) gives {alt, az} t seconds from now.
 * Returns the best moment for each flight that comes within `near` degrees, with the ground line from which it's dead centre.
 */
export function transits(flights, o, body, horizon = 600, near = 2) {
  const out = [], B0 = body(0), B1 = body(horizon / 2), B2 = body(horizon);
  if (Math.max(B0.alt, B2.alt) < 2) return out;
  const bAt = t => { const k = t / horizon, a = k < 0.5 ? B0 : B1, b = k < 0.5 ? B1 : B2, u = (k < 0.5 ? k : k - 0.5) * 2, dz = ((b.az - a.az + 540) % 360) - 180; return { alt: a.alt + (b.alt - a.alt) * u, az: a.az + dz * u }; };
  for (const f of flights) {
    const p = local(f, o), s = f.trk * D2R, vx = f.spd * Math.sin(s), vz = -f.spd * Math.cos(s);
    if (Math.hypot(p.x, p.z) > 320) continue;
    let best = null;
    for (let t = 0; t <= horizon; t += 3) {
      const x = p.x + vx * t, z = p.z + vz * t, alt = Math.max(0, f.alt + f.vr * t), L = look(x, z, alt), b = bAt(t);
      if (L.elev < 1 || b.alt < 1.5) continue;
      const d = sep(L.elev, L.brg, b.alt, b.az);
      if (!best || d < best.sep) best = { t, sep: d, x, z, alt, elev: L.elev, brg: L.brg, b };
    }
    if (!best || best.sep > near) continue;
    // centreline: for each moment, the ground point that has the plane exactly in front of the body
    const line = [];
    for (let dt = -40; dt <= 40; dt += 4) {
      const t = best.t + dt, b = bAt(clamp(t, 0, horizon)), x = p.x + vx * t, z = p.z + vz * t, alt = Math.max(0, f.alt + f.vr * t);
      const ce = Math.cos(b.alt * D2R), ux = Math.sin(b.az * D2R) * ce, uz = -Math.cos(b.az * D2R) * ce, uy = Math.sin(b.alt * D2R);
      const k = alt / Math.max(uy, 0.02); line.push({ x: x - ux * k, z: z - uz * k, t });
    }
    // how far you'd have to walk to stand on it, and which way
    let move = null;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], c = line[i], dx = c.x - a.x, dz = c.z - a.z, L2 = dx * dx + dz * dz || 1, u = clamp(-(a.x * dx + a.z * dz) / L2, 0, 1);
      const qx = a.x + dx * u, qz = a.z + dz * u, d = Math.hypot(qx, qz);
      if (!move || d < move.d) move = { d, brg: (Math.atan2(qx, -qz) * R2D + 360) % 360, t: a.t + (c.t - a.t) * u };
    }
    // the band on the ground where the plane touches the disc at all
    const width = best.alt / Math.max(Math.sin(best.b.alt * D2R), 0.02) * DISC * D2R * 2;
    out.push({ f, t: best.t, sep: best.sep, hit: best.sep <= DISC, elev: best.elev, brg: best.brg, line, move, width, dur: DISC * 2 * D2R * Math.hypot(best.x, best.z, best.alt) / Math.max(f.spd, 0.01) });
  }
  return out.sort((a, b) => a.t - b.t);
}

/* ---------------- contrails ---------------- */
// Schmidt-Appleman criterion: exhaust makes a contrail when the air is cold and moist enough that the mixing plume
// saturates. The trail persists when the air is also saturated with respect to ice.
const ew = T => 611.2 * Math.exp(17.62 * T / (243.12 + T));   // Pa over water, T in °C
const ei = T => 611.2 * Math.exp(22.46 * T / (272.62 + T));   // Pa over ice
const dew = T => ew(T) * 17.62 * 243.12 / (243.12 + T) ** 2;  // d(ew)/dT
/** Pressure (hPa) at a pressure altitude in km (ISA), which is what ADS-B barometric altitude reports. */
export const pressureAt = km => km < 11 ? 1013.25 * Math.pow(1 - 0.0065 * km * 1000 / 288.15, 5.25588) : 226.32 * Math.exp(-(km - 11) * 1000 / 6341.62);
function threshold(pHa, rh) {
  const G = 1.25 * 1004 * pHa * 100 / (0.622 * 43.2e6 * (1 - 0.35)); // mixing-line slope, Pa/K, for a modern turbofan
  let lo = -90, hi = 0;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (dew(m) < G) lo = m; else hi = m; }
  const tlm = (lo + hi) / 2; lo = -100; hi = tlm;
  // the warmest ambient temperature at which the plume still reaches water saturation for this humidity
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (ew(tlm) - G * (tlm - m) > rh * ew(m)) hi = m; else lo = m; }
  return (lo + hi) / 2;
}
/** Contrail outlook at an altitude from pressure-level weather: 'none', 'short' (fades in seconds) or 'persistent'. */
export function contrailAt(km, levels) {
  if (!levels || levels.length < 2 || km < 5) return null;
  const p = pressureAt(km), L = levels;
  let i = 0; while (i < L.length - 2 && L[i + 1].p > p) i++;
  const a = L[i], b = L[i + 1], u = clamp(Math.log(p / a.p) / Math.log(b.p / a.p), 0, 1);
  const T = a.T + (b.T - a.T) * u, rh = clamp((a.rh + (b.rh - a.rh) * u) / 100, 0, 1), rhi = rh * ew(T) / ei(T);
  const tc = threshold(p, rh), state = T > tc ? 'none' : rhi >= 1 ? 'persistent' : 'short';
  return { state, T, rhi, margin: tc - T };
}
