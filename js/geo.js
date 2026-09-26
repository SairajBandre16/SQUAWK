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

/** Position of an aircraft relative to an observer at the origin: ground distance, bearing, elevation angle. */
export function relative(f) {
  const d = Math.hypot(f.x, f.z);
  const brg = (Math.atan2(f.x, -f.z) * R2D + 360) % 360;
  // elevation corrected for earth curvature
  const drop = curvDrop(f.x, f.z);
  const elev = Math.atan2(f.alt - drop, Math.max(d, 0.01)) * R2D;
  return { d, brg, elev, slant: Math.hypot(d, f.alt) };
}

export const dirVec = h => ({ x: Math.sin(h * D2R), z: -Math.cos(h * D2R) });
