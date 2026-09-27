// Phone heading and tilt from the motion sensors, for the compass and the sky camera.
// Vectors are in a local earth frame: x east, y north, z up.
import { D2R, R2D } from './geo.js';

const V = () => ({ x: 0, y: 0, z: 0 });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = v => { const l = Math.hypot(v.x, v.y, v.z) || 1; v.x /= l; v.y /= l; v.z /= l; return v; };
export const wrap = a => ((a % 360) + 540) % 360 - 180; // -180..180

/** live: sensor events are arriving. abs: the heading is tied to north. nudge: the viewer's own correction, in degrees. */
export const sense = { live: false, abs: false, heading: null, pitch: 0, R: V(), U: V(), F: V(), nudge: 0, t: 0, err: '' };
let on = false, hasAbs = false, off = null, first = true;

// heading of where the phone points: the camera direction when upright, the top edge when flat, a blend in between
const headOf = (F, U) => { const x = F.x + U.x, y = F.y + U.y; return Math.hypot(x, y) < 1e-3 ? null : (Math.atan2(x, y) * R2D + 360) % 360; };
const turn = (v, deg) => { const c = Math.cos(-deg * D2R), s = Math.sin(-deg * D2R), x = v.x * c - v.y * s; v.y = v.x * s + v.y * c; v.x = x; return v; };

function onOri(e, absEvt) {
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  const ios = typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0;
  if (!absEvt && !ios && hasAbs) return; // Chrome sends both events; the absolute one is tied to north
  const a = e.alpha * D2R, b = e.beta * D2R, g = e.gamma * D2R;
  const cX = Math.cos(b), cY = Math.cos(g), cZ = Math.cos(a), sX = Math.sin(b), sY = Math.sin(g), sZ = Math.sin(a);
  // columns of the W3C rotation matrix: the phone's axes (x right, y top, z out of the screen) in the earth frame
  const R = { x: cZ * cY - sZ * sX * sY, y: cY * sZ + cZ * sX * sY, z: -cX * sY };
  const U = { x: -cX * sZ, y: cZ * cX, z: sX };
  const F = { x: -(cY * sZ * sX + cZ * sY), y: -(sZ * sY - cZ * cY * sX), z: -cX * cY };
  let rot = 0;
  if (ios) { // Safari's alpha starts anywhere; webkitCompassHeading says where north is
    const h = headOf(F, U);
    if (h != null) { const d = wrap(e.webkitCompassHeading - h); off = off == null ? d : off + wrap(d - off) * 0.1; }
    rot = off ?? 0; sense.abs = off != null;
  } else sense.abs = absEvt || !!e.absolute;
  rot += sense.nudge;
  for (const v of [R, U, F]) turn(v, rot);
  const k = first ? 1 : 0.35; first = false;
  for (const [s, v] of [[sense.R, R], [sense.U, U], [sense.F, F]]) { s.x += (v.x - s.x) * k; s.y += (v.y - s.y) * k; s.z += (v.z - s.z) * k; norm(s); }
  sense.heading = headOf(sense.F, sense.U) ?? sense.heading;
  sense.pitch = Math.asin(Math.max(-1, Math.min(1, sense.F.z))) * R2D;
  sense.live = true; sense.t = performance.now();
}

/** Start listening. Call it straight from a tap: iOS only asks for motion access inside a user gesture. */
export async function startSense() {
  if (on) return true;
  const DO = window.DeviceOrientationEvent;
  if (!DO) { sense.err = 'none'; return false; }
  if (typeof DO.requestPermission === 'function') {
    try { if (await DO.requestPermission() !== 'granted') { sense.err = 'denied'; return false; } } catch (e) { sense.err = 'denied'; return false; }
  }
  on = true; sense.err = '';
  if ('ondeviceorientationabsolute' in window) { hasAbs = true; addEventListener('deviceorientationabsolute', e => onOri(e, true)); }
  addEventListener('deviceorientation', e => onOri(e, false));
  return true;
}
/** Motion access that needs no tap (Android): start it quietly. */
export const senseNeedsTap = () => typeof window.DeviceOrientationEvent?.requestPermission === 'function';
/** A heading worth showing: fresh readings tied to north. */
export const headingNow = () => (sense.live && sense.abs && performance.now() - sense.t < 1500 ? sense.heading : null);

/** The screen's right, up and forward (into the scene) directions, allowing for a phone turned sideways. */
export function axes() {
  const t = (screen.orientation?.angle ?? window.orientation ?? 0) * D2R, c = Math.cos(t), s = Math.sin(t), { R, U, F } = sense;
  return { r: { x: R.x * c - U.x * s, y: R.y * c - U.y * s, z: R.z * c - U.z * s }, u: { x: R.x * s + U.x * c, y: R.y * s + U.y * c, z: R.z * s + U.z * c }, f: F };
}
/** Where a direction (bearing and elevation in degrees) lands on a screen with focal length fpx. front is false behind the camera. */
export function toScreen(brg, elev, ax, W, H, fpx, out) {
  const ce = Math.cos(elev * D2R), T = { x: Math.sin(brg * D2R) * ce, y: Math.cos(brg * D2R) * ce, z: Math.sin(elev * D2R) };
  const z = dot(T, ax.f), x = dot(T, ax.r), y = dot(T, ax.u);
  out.front = z > 0.05; out.dx = x; out.dy = -y; // dx, dy: which way to turn for an off-screen arrow
  if (out.front) { out.x = W / 2 + x / z * fpx; out.y = H / 2 - y / z * fpx; }
  return out;
}

/** Rear camera, full screen. Resolves with the stream, or throws when there's no camera or access was refused. */
export async function startCam(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
  const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  video.srcObject = s; try { await video.play(); } catch (e) { /* plays once visible */ }
  return s;
}
export function stopCam(video, s) { s?.getTracks().forEach(t => t.stop()); video.srcObject = null; }
/** Focal length in screen pixels. A phone's main camera sees about 64° along the long side of the frame. */
export function focal(video, W, H) {
  const vw = video.videoWidth, vh = video.videoHeight, k = 1 / Math.tan(32 * D2R);
  if (!vw || !vh) return Math.max(W, H) / 2 * k;
  return Math.max(W / vw, H / vh) * Math.max(vw, vh) / 2 * k; // the video fills the screen (object-fit: cover)
}
