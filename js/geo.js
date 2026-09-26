// Geography helpers: local projection, earth curvature, sun position, compass.
export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const EARTH_R = 6371; // km

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/** Local tangent-plane projection. 1 world unit = 1 km. +x = east, -z = north. */
export class Proj {
  constructor(lat, lon) { this.set(lat, lon); }
  set(lat, lon) {
    this.lat0 = lat; this.lon0 = lon;
    this.kx = 111.32 * Math.cos(lat * D2R);
    this.ky = 110.574;
  }
  toXZ(lat, lon) {
    let dl = lon - this.lon0;
    if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
    return { x: dl * this.kx, z: -(lat - this.lat0) * this.ky };
  }
  toLL(x, z) { return { lat: this.lat0 - z / this.ky, lon: this.lon0 + x / this.kx }; }
}

/** How far the ground has dropped below the tangent plane at horizontal offset (x, z), in km. */
export const curvDrop = (x, z) => (x * x + z * z) / (2 * EARTH_R);

export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * D2R, dLon = (lon2 - lon1) * D2R;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

/** Sun altitude and azimuth (bearing from north, degrees) using the SunCalc formulas. */
export function sunPosition(date, lat, lon) {
  const dayMs = 86400000, J1970 = 2440588, J2000 = 2451545, rad = D2R;
  const d = date.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const e = rad * 23.4397;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const lw = rad * -lon, phi = rad * lat;
  const th = rad * (280.16 + 360.9856235 * d) - lw;
  const H = th - ra;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { alt: alt * R2D, az: ((az * R2D + 180) % 360 + 360) % 360 };
}

export const P16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const P16L = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast',
  'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest'];
export const pt16 = b => Math.round((((b % 360) + 360) % 360) / 22.5) % 16;

/** Initial great-circle bearing from point 1 to point 2, degrees. */
export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  return (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * R2D + 360) % 360;
}

/** Position of an aircraft relative to an observer o ({lat0, lon0}): ground distance, bearing, elevation angle, slant range. Exact on a spherical earth. */
export function relative(f, o) {
  const d = haversine(o.lat0, o.lon0, f.lat, f.lon), th = d / EARTH_R, rh = EARTH_R + f.alt;
  const brg = bearing(o.lat0, o.lon0, f.lat, f.lon);
  const elev = Math.atan2(rh * Math.cos(th) - EARTH_R, Math.max(rh * Math.sin(th), 1e-5)) * R2D;
  return { d, brg, elev, slant: Math.sqrt(Math.max(0, rh * rh + EARTH_R * EARTH_R - 2 * EARTH_R * rh * Math.cos(th))) };
}

/** Move a lat/lon point dist km along track trk (degrees). Flat step, fine for the short hops of dead reckoning. */
export function step(p, trk, dist) {
  p.lat = clamp(p.lat + dist * Math.cos(trk * D2R) / 111.195, -89.9, 89.9);
  p.lon += dist * Math.sin(trk * D2R) / (111.195 * Math.max(0.01, Math.cos(p.lat * D2R)));
  if (p.lon > 180) p.lon -= 360; else if (p.lon < -180) p.lon += 360;
  return p;
}

/* Earth-centred frame used by the globe (km). +y = north pole, +z = lat 0 / lon 0, +x = lat 0 / lon 90E. */
export function unitDir(lat, lon, out) {
  const p = lat * D2R, l = lon * D2R, c = Math.cos(p);
  out.x = c * Math.sin(l); out.y = Math.sin(p); out.z = c * Math.cos(l); return out;
}
/** Local east / north / up unit vectors at lat, lon (each written into e, n, u). */
export function enu(lat, lon, e, n, u) {
  const p = lat * D2R, l = lon * D2R, sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
  e.x = cl; e.y = 0; e.z = -sl;
  n.x = -sp * sl; n.y = cp; n.z = -sp * cl;
  if (u) { u.x = cp * sl; u.y = sp; u.z = cp * cl; }
}
export function toLatLon(x, y, z) {
  const r = Math.hypot(x, y, z) || 1;
  return { lat: Math.asin(clamp(y / r, -1, 1)) * R2D, lon: Math.atan2(x, z) * R2D, h: r - EARTH_R };
}

export const dirVec = h => ({ x: Math.sin(h * D2R), z: -Math.cos(h * D2R) });
