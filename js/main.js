import * as THREE from 'three';
import { World, RINGS, altColor, TILE_STYLES, HOME_R, SPACE_R } from './world.js';
import * as D from './data.js';
import { Sim } from './sim.js';
import { Proj, relative, P16, P16L, pt16, clamp, haversine, curvDrop, step, sunPosition, moonPosition } from './geo.js';
import { closestApproach, transits, contrailAt, pressureAt } from './predict.js';
import { Sats } from './sats.js';
import { modelOf, LIVERY } from './models.js';
import { FAMILIES, familyOf, levelOf, XP, missionsFor, today, streak, bestStreak, plainFacts, silhouette } from './spotter.js';
import { sense, startSense, senseNeedsTap, headingNow, axes, toScreen, startCam, stopCam, focal, wrap } from './sense.js';
import { cloudOn, onUser, signInGoogle, signInEmail, resetPassword, signOut, authError, syncLog } from './cloud.js';

const $ = id => document.getElementById(id);
const IN_RANGE = 185, FEED_NM = 100, POLL_MS = 5000;
const coarse = matchMedia('(pointer: coarse)').matches; // a phone or tablet: offer the compass and the sky camera
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};
const stored = store.get('squawk.settings', {});
// placeSrc: 'gps' when home came from your location, 'pick' when you chose it, '' until then
const settings = Object.assign({ place: D.PLACES[0], placeSrc: '', style: 'satellite', clouds: true, labels: 'nearby', names: true, sats: true, radar: false, alerts: false, relay: '', nudge: 0 }, stored);
if (!settings.place || !Number.isFinite(settings.place.lat) || !Number.isFinite(settings.place.lon) || typeof settings.place.name !== 'string') settings.place = D.PLACES[0];
if (!settings.placeSrc && stored.place && stored.place.name !== D.PLACES[0].name) settings.placeSrc = 'pick'; // chosen before this setting existed
sense.nudge = Number.isFinite(settings.nudge) ? settings.nudge : 0;
// a relay must be a full https URL (plain http only while Squawk itself runs on http, e.g. localhost)
const relayOK = s => { try { const u = new URL(s); return u.protocol === 'https:' || (u.protocol === 'http:' && location.protocol === 'http:'); } catch (e) { return false; } };
if (settings.relay && !relayOK(settings.relay)) settings.relay = '';
// ?relay= only lasts for this visit: a shared link can't quietly reroute the feed for good
{ const q = new URLSearchParams(location.search).get('relay'); D.feedConfig.relayUrl = q && relayOK(q) ? q : settings.relay; }
const saveSettings = () => store.set('squawk.settings', settings);
const S = { flights: new Map(), mode: 'boot', provider: '', selId: null, follow: false, tab: 'sky', view: 'orbit', weather: null, timeOff: 0,
  events: [], history: [], rec: {}, booting: false, quiet: false, feedResolved: false, region: null, proj: null, sim: null,
  pred: { over: [], tr: [], rare: [] }, sats: new Sats(), alerted: new Set() };
const hexOf = c => '#' + c.getHexString();
const tmpC = new THREE.Color();
const fmtAlt = km => { const ft = km * 3280.84; return ft >= 5000 ? 'FL' + String(Math.round(ft / 100)).padStart(3, '0') : (Math.round(ft / 100) * 100).toLocaleString('en') + ' ft'; };
const boardAlt = km => { const ft = km * 3280.84; return ft >= 5000 ? 'FL' + String(Math.round(ft / 100)).padStart(3, '0') : String(Math.round(ft / 100) * 100); };
const kt = f => Math.round(f.spd * 1943.84);
const fpm = f => Math.round(f.vr * 196850 / 50) * 50;
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const dur = s => s < 90 ? Math.round(s) + ' s' : s < 3600 ? Math.round(s / 60) + ' min' : Math.floor(s / 3600) + ' h ' + String(Math.round(s % 3600 / 60)).padStart(2, '0') + ' min';
const mmss = t => t >= 3600 ? Math.floor(t / 3600) + 'h ' + String(Math.floor(t % 3600 / 60)).padStart(2, '0') + 'm' : Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
const hhmm = d => { const off = S.weather?.utcOffset; const x = off != null ? new Date(d.getTime() + off * 1000) : d; return off != null ? String(x.getUTCHours()).padStart(2, '0') + ':' + String(x.getUTCMinutes()).padStart(2, '0') : x.toTimeString().slice(0, 5); };
const rel = f => relative(f, S.proj);
const dLon = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180); // across the date line too
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- boot ---------------- */
let world;
try { world = new World($('gl')); }
catch (e) {
  $('loadMsg').textContent = 'Your browser could not start WebGL, which Squawk needs to draw the sky.';
  throw e;
}
const resize = () => world.resize(innerWidth, innerHeight);
addEventListener('resize', resize); resize();

/* ---------------- log & badges ---------------- */
const LOGKEY = 'squawk.log.v2';
// recent/seenHex remember which airframes were caught or seen in the last 12 h, so a reload doesn't count them twice
const newLog = () => ({ types: {}, airlines: {}, badges: {}, tracked: 0, since: Date.now(), xp: 0, seen: 0, seenTypes: {}, days: [], day: null, recent: {}, seenHex: {} });
// Signed in, the log belongs to the account (cached here as squawk.log.v2.<uid>); signed out, to this browser.
let acct = cloudOn ? store.get('squawk.acct', null) : null;
const logKey = () => acct ? LOGKEY + '.' + acct.uid : LOGKEY;
const logLive = Object.assign(newLog(), store.get(logKey(), {}));
const logSim = newLog();
const theLog = () => (S.mode === 'live' ? logLive : logSim);
const AGAIN = 12 * 3600e3;
let saveT = null;
function writeLog() {
  clearTimeout(saveT); saveT = null; const t = Date.now();
  for (const m of [logLive.recent, logLive.seenHex]) if (m) for (const k in m) if (t - m[k] > AGAIN) delete m[k];
  store.set(logKey(), logLive);
  if (acct) { dirty = true; cloudSave(); }
}
const saveLog = () => { if (!saveT) saveT = setTimeout(writeLog, 1500); };
addEventListener('pagehide', () => { if (saveT) writeLog(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && saveT) writeLog(); if (!document.hidden) cloudSave(1500); });
function useLog(v) {
  v = { ...v }; for (const k in logLive) delete logLive[k]; Object.assign(logLive, newLog(), v); paintLevel();
  if (S.tab === 'log' || (S.tab === 'profile' && !$('panel').contains(document.activeElement))) renderPanel(false);
}
// another tab saved its log: take that copy, so this tab's next save doesn't wipe the other's progress
addEventListener('storage', e => {
  if (e.key !== logKey() || !e.newValue) return;
  try { useLog(JSON.parse(e.newValue)); } catch (x) { /* ignore a bad copy */ }
});
/** Two copies of a log in one: the union of what was caught, the larger of each count. Safe to repeat. A newer reset wins outright. */
function mergeLog(a, b) {
  if (!a) return b; if (!b) return a;
  if ((a.reset || 0) !== (b.reset || 0)) return (a.reset || 0) > (b.reset || 0) ? a : b;
  const mx = (x, y) => Math.max(x || 0, y || 0), mn = (x, y) => x && y ? Math.min(x, y) : x || y, uni = (x, y) => [...new Set([...(x || []), ...(y || [])])];
  const maxMap = (x, y) => { const r = { ...x }; for (const k in y) r[k] = mx(r[k], y[k]); return r; };
  const o = Object.assign(newLog(), a, { tracked: mx(a.tracked, b.tracked), xp: mx(a.xp, b.xp), seen: mx(a.seen, b.seen), since: mn(a.since, b.since),
    airlines: maxMap(a.airlines, b.airlines), seenTypes: maxMap(a.seenTypes, b.seenTypes), recent: maxMap(a.recent, b.recent), seenHex: maxMap(a.seenHex, b.seenHex),
    badges: { ...a.badges }, types: {}, days: uni(a.days, b.days).sort().slice(-400) });
  for (const k in b.badges) o.badges[k] = mn(o.badges[k], b.badges[k]);
  for (const src of [a.types, b.types]) for (const k in src) { const t = src[k], e = o.types[k]; o.types[k] = e ? { n: mx(e.n, t.n), first: mn(e.first, t.first), al: uni(e.al, t.al).slice(0, 5) } : { n: t.n || 0, first: t.first || Date.now(), al: (t.al || []).slice(0, 5) }; }
  const x = a.day, y = b.day;
  o.day = !x ? y : !y ? x : x.date !== y.date ? (x.date > y.date ? x : y) : { date: x.date, airlines: uni(x.airlines, y.airlines), types: uni(x.types, y.types), done: { ...y.done, ...x.done } };
  return o;
}
// the account copy is merged with the cloud a few seconds after changes, when the tab comes back, and on sign-in
let cloudT = null, syncing = false, dirty = false;
// the profile: display name and picture (av is a plane avatar id, 'photo' or 'google'); at = last edit
const profKey = () => 'squawk.profile.' + acct.uid;
let prof = acct ? store.get(profKey(), null) : null;
function cloudSave(ms = 10000) { if (acct && !cloudT) cloudT = setTimeout(pushLog, ms); }
async function pushLog() {
  clearTimeout(cloudT); cloudT = null; if (!acct) return;
  if (syncing) { cloudSave(); return; }
  syncing = true; dirty = false; const uid = acct.uid; // a save while this runs marks it dirty again
  try {
    const r = await syncLog(uid, logLive, mergeLog, prof);
    if (acct?.uid === uid) {
      useLog(mergeLog(r.log, logLive)); store.set(logKey(), logLive);
      if (r.profile && (r.profile.at || 0) > (prof?.at || 0)) { prof = r.profile; store.set(profKey(), prof); paintAcct(); }
    }
  } catch (e) { dirty = true; cloudSave(60000); } finally { syncing = false; }
}
const ICON_STAR = '<svg viewBox="0 0 24 24"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z"/></svg>';
const BADGES = [
  { id: 'first', name: 'First contact', desc: 'Track your first aircraft' },
  { id: 'eyes', name: 'Eyes on the sky', desc: 'See a plane with your own eyes and log it' },
  { id: 'heavy', name: 'Heavy metal', desc: 'Spot a widebody heavy' },
  { id: 'a380', name: 'Superjumbo', desc: 'Spot an Airbus A380' },
  { id: 'b747', name: 'Queen of the Skies', desc: 'Spot a Boeing 747' },
  { id: 'mil', name: 'Top brass', desc: 'Spot a military flight' },
  { id: 'rotor', name: 'Chopper', desc: 'Spot a helicopter' },
  { id: 'over', name: 'Right overhead', desc: 'An aircraft within 2 km of you, below 3,000 m' },
  { id: 'fast', name: 'Jet stream rider', desc: 'Ground speed above 600 kt' },
  { id: 'high', name: 'Stratosphere', desc: 'An aircraft above FL450' },
  { id: 'mayday', name: 'Mayday', desc: 'Witness a 7700 squawk' },
  { id: 'owl', name: 'Night owl', desc: 'Spot a flight between midnight and 5 am' },
  { id: 'golden', name: 'Golden hour', desc: 'Spot a flight while the sun is low' },
  { id: 'air10', name: 'Globetrotter', desc: 'Log 10 different airlines' },
  { id: 'types15', name: 'Collector', desc: 'Log 15 aircraft types' },
  { id: 'types40', name: 'Encyclopaedia', desc: 'Log 40 aircraft types' }
];
function award(id) {
  const lg = theLog(); if (lg.badges[id]) return; lg.badges[id] = Date.now(); if (lg === logLive) saveLog();
  gain(XP.badge);
  if (S.booting || S.quiet || lg !== logLive) return;
  const b = BADGES.find(x => x.id === id); const el = $('badgeToast');
  el.innerHTML = `<span class="star">${ICON_STAR}</span><span>Badge unlocked: <b>${esc(b.name)}</b></span>`; el.hidden = false;
  clearTimeout(award.t); award.t = setTimeout(() => { el.hidden = true; }, 4200);
  pushEvent('badge', `Badge unlocked: ${b.name}`);
}
function localHour() { const off = S.weather?.utcOffset; const d = new Date(Date.now() + S.timeOff * 3600e3); return off != null ? new Date(d.getTime() + off * 1000).getUTCHours() : d.getHours(); }
function logCatch(f) {
  const lg = theLog(); lg.tracked++; gain(XP.catch);
  if (f.type) {
    const fresh = !lg.types[f.type], t = lg.types[f.type] || (lg.types[f.type] = { n: 0, first: Date.now(), al: [] }); t.n++;
    const an = D.airlineName(f.callsign); if (an && !t.al.includes(an) && t.al.length < 5) t.al.push(an);
    if (fresh) { gain(XP.type); if (!S.booting && !S.quiet && Object.keys(lg.types).length > 1) pushEvent('badge', `New type for your log: ${D.typeName(f)} (${f.callsign})`); }
  }
  const ac = D.airlineCode(f.callsign); if (ac) { if (!lg.airlines[ac]) gain(XP.airline); lg.airlines[ac] = (lg.airlines[ac] || 0) + 1; }
  const d = dayRec(); if (f.type && !d.types.includes(f.type)) d.types.push(f.type); if (ac && !d.airlines.includes(ac)) d.airlines.push(ac);
  mission({ heavy: D.HEAVY.has(f.type), alt: f.alt, model: f.model, ctr: f.ctr, cs: f.callsign });
  award('first');
  if (D.HEAVY.has(f.type)) award('heavy');
  if (f.type === 'A388') award('a380');
  if (/^B74/.test(f.type)) award('b747');
  if (D.MILITARY.some(p => (f.callsign || '').startsWith(p))) award('mil');
  if (D.HELI.has(f.type) || f.cat === 'A7') award('rotor');
  if (localHour() < 5) award('owl');
  if (world.sun && world.sun.alt > -1 && world.sun.alt < 8) award('golden');
  if (Object.keys(lg.airlines).length >= 10) award('air10');
  const nt = Object.keys(lg.types).length; if (nt >= 15) award('types15'); if (nt >= 40) award('types40');
  if (lg === logLive) saveLog();
}

/* ---------------- levels, missions and real sightings ---------------- */
function gain(n) {
  const lg = theLog(), before = levelOf(lg.xp || 0).n; lg.xp = (lg.xp || 0) + n;
  if (lg === logLive) saveLog();
  paintLevel();
  if (S.booting || S.quiet || lg !== logLive) return; // simulated traffic earns nothing you'd notice
  floatXP(n);
  const L = levelOf(lg.xp);
  if (L.n > before) { flash(`Level ${L.n}: <b>${esc(L.name)}</b>`); pushEvent('badge', `You reached level ${L.n}, ${L.name}`); confetti(); }
}
function flash(html) {
  const el = $('badgeToast'); el.innerHTML = `<span class="star">${ICON_STAR}</span><span>${html}</span>`; el.hidden = false;
  clearTimeout(award.t); award.t = setTimeout(() => { el.hidden = true; }, 4200);
}
function dayRec() {
  const lg = theLog(), d = today();
  if (!lg.day || lg.day.date !== d) lg.day = { date: d, airlines: [], types: [], done: {} };
  lg.days = lg.days || []; if (!lg.days.includes(d)) { lg.days.push(d); if (lg.days.length > 400) lg.days.shift(); }
  return lg.day;
}
function mission(e) {
  const d = dayRec();
  for (const m of missionsFor(d.date)) if (!d.done[m.id] && m.check(d, e)) {
    d.done[m.id] = Date.now(); gain(XP.mission);
    if (!S.booting && !S.quiet && S.mode === 'live') { flash(`Mission done: <b>${esc(m.text)}</b>`); pushEvent('badge', `Daily mission done: ${m.text}`); }
  }
}
function paintLevel() {
  const L = levelOf(logLive.xp || 0), el = $('lvlChip');
  el.textContent = 'Lv ' + L.n; el.style.setProperty('--p', Math.round(L.pct * 100) + '%'); el.title = `${L.name} · ${L.xp} XP`;
}
function floatXP(n) {
  if (n < 2) return;
  const el = document.createElement('span'); el.className = 'xp-float'; el.textContent = `+${n} XP`;
  const r = $('lvlChip').getBoundingClientRect(); el.style.left = r.left + r.width / 2 + 'px'; el.style.top = r.bottom + 'px';
  document.body.appendChild(el); setTimeout(() => el.remove(), 1400);
}
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div'); box.className = 'confetti';
  for (let i = 0; i < 44; i++) { const s = document.createElement('i'); s.style.cssText = `left:${Math.random() * 100}%;background:${['#FF5A1F', '#FFC53D', '#29C5FF', '#FF3D8B', '#22C55E'][i % 5]};animation-delay:${Math.random() * 0.3}s;--dx:${(Math.random() - 0.5) * 160}px;--r:${Math.random() * 720}deg`; box.appendChild(s); }
  document.body.appendChild(box); setTimeout(() => box.remove(), 2200);
}
/** "I saw it!": a real sighting, worth more than tracking it on screen. */
const seenBefore = f => f.seen || Date.now() - ((theLog().seenHex || {})[f.hex || f.id] || 0) < AGAIN;
function sawIt(f) {
  if (!f || seenBefore(f)) return;
  const lg = theLog(); f.seen = true; (lg.seenHex = lg.seenHex || {})[f.hex || f.id] = Date.now();
  lg.seen = (lg.seen || 0) + 1; lg.seenTypes = lg.seenTypes || {};
  const key = f.type || '?', first = !lg.seenTypes[key]; lg.seenTypes[key] = (lg.seenTypes[key] || 0) + 1;
  gain(XP.seen + (first && f.type ? XP.seenType : 0)); mission({ seen: true }); award('eyes'); confetti();
  pushEvent('badge', `You saw ${f.callsign} with your own eyes${first && f.type ? `, your first ${D.typeName(f)}` : ''}`);
  if (lg === logLive) saveLog();
  if (S.selId === f.id) updateCard();
}

/* ---------------- first-sighting guide ---------------- */
// Walks a newcomer through finding a real plane in the sky, once, then gets out of the way.
const coach = { on: false, id: null, skip: new Set(), later: false };
function coachPick() {
  let best = null, bs = -1e9;
  for (const { f, r } of inRange()) {
    if (coach.skip.has(f.id) || r.elev < 8 || r.elev > 75 || r.d > 50 || f.alt < 0.3) continue;
    const s = r.elev - r.d * 0.4 + (['wide', 'jumbo', 'a380', 'quad'].includes(f.model) ? 12 : 0);
    if (s > bs) { bs = s; best = f; }
  }
  return best;
}
function coachStart() {
  if (coach.on || coach.later || !$('welcome').hidden || store.get('squawk.coach', false) || S.mode !== 'live' || document.body.classList.contains('photo')) return;
  const f = coachPick(); if (!f) return;
  coach.on = true; coach.id = f.id; $('coach').hidden = false; coachShow(f, true);
}
function coachShow(f, fresh) {
  const r = rel(f), fists = Math.max(1, Math.round(r.elev / 10)), night = world.day < 0.35;
  $('coachText').innerHTML = `Step outside and face <b>${esc(P16L[pt16(r.brg)])}</b>. Look <b>${Math.round(r.elev)}°</b> up, about ${fists} fist${fists > 1 ? 's' : ''} above the horizon with your arm held out.
    <span>${esc(f.callsign)} is ${/^[AEIOU]/.test(D.typeName(f)) ? 'an' : 'a'} ${esc(D.typeName(f))}, ${r.d.toFixed(1)} km away at ${fmtAlt(f.alt)}.${night ? ' At night, look for a steady light with a blinking red or white strobe.' : f.ctr && f.ctr !== 'none' ? ' It may be drawing a white contrail.' : ''}</span>`;
  if (fresh) { select(f.id); setView('ground'); world.lookAtRel(r); }
}
function coachTick() {
  if (!coach.on) { if (loaderDone && performance.now() - bootT > 14000) coachStart(); return; }
  if (S.mode !== 'live') { coach.on = false; $('coach').hidden = true; return; } // the feed dropped to simulated traffic: nothing real to look for
  const f = S.flights.get(coach.id), r = f && rel(f);
  if (!f || r.d > 70 || r.elev < 3) { coach.skip.add(coach.id); const n = coachPick(); if (n) { coach.id = n.id; coachShow(n, true); } else coachEnd(false); return; }
  coachShow(f, false);
}
function coachEnd(done) { coach.on = false; $('coach').hidden = true; if (done) store.set('squawk.coach', true); else coach.later = true; }
$('coachSaw').onclick = () => { const f = S.flights.get(coach.id); sawIt(f); coachEnd(true); flash(f ? '<b>First sighting!</b> That plane is now in your log.' : '<b>Nice spotting!</b> Tap a plane and press "I saw it!" to log the next one.'); };
$('coachNext').onclick = () => { coach.skip.add(coach.id); const n = coachPick(); if (n) { coach.id = n.id; coachShow(n, true); } else coachEnd(false); };
$('coachLater').onclick = () => coachEnd(false);

/* ---------------- events ---------------- */
const EV_COL = { land: 'var(--low)', heavy: 'var(--mid)', over: '#22C55E', emg: 'var(--emg)', badge: 'var(--accent)', info: 'var(--high)' };
function pushEvent(k, text) {
  S.events.unshift({ k, text, t: new Date() }); if (S.events.length > 30) S.events.length = 30;
  if (S.tab === 'board') renderEvents();
}

/* ---------------- coming up: overhead passes, transits, rare aircraft, satellites ---------------- */
// Recomputed every 2 s from the live positions. Times are seconds from S.pred.at.
function predictAll() {
  const o = S.proj, now = Date.now(), near = [];
  for (const f of S.flights.values()) if (Math.abs(f.lat - o.lat0) < 4 && dLon(f.lon, o.lon0) < 6 && haversine(o.lat0, o.lon0, f.lat, f.lon) < 450) near.push(f);
  const over = [];
  for (const f of near) {
    f.ctr = f.alt > 5 ? contrailAt(f.alt, S.weather?.levels)?.state : null;
    const c = closestApproach(f, o, 900);
    f.next = c && c.t > 1 && c.d < 60 ? c : null;
    if (c && c.t > 1 && c.d < 8 && c.alt > 0.15) over.push({ f, ...c });
  }
  over.sort((a, b) => a.t - b.t);
  const lat = o.lat0, lon = o.lon0, when = t => new Date(now + t * 1000);
  const tr = [...transits(near, o, t => sunPosition(when(t), lat, lon)).map(x => ({ ...x, body: 'sun' })),
    ...transits(near, o, t => moonPosition(when(t), lat, lon)).map(x => ({ ...x, body: 'moon' }))]
    .filter(x => x.hit || (x.move && x.move.d < 25)).sort((a, b) => a.t - b.t);
  const rare = [];
  for (const f of near) { const what = D.rareOf(f); if (!what) continue; const r = rel(f); if (r.d < IN_RANGE || (f.next && f.next.d < IN_RANGE)) rare.push({ f, what, r }); }
  S.pred = { at: now, over, tr, rare };
  world.setTransitLines(tr.filter(x => x.move && x.move.d < 40).slice(0, 3));
  for (const x of over) if (x.t < 75) ping('over:' + x.f.id, 'LOOK UP', `${x.f.callsign} passes ${x.d < 1 ? 'right over you' : x.d.toFixed(1) + ' km ' + P16[pt16(x.brg)]} in ${Math.round(x.t)} s, ${Math.round(x.elev)}° up.`, x.f.id);
  for (const x of tr) if (x.t < 120 && (x.hit || x.move.d < 3)) ping('tr:' + x.body + x.f.id, x.body === 'sun' ? 'SUN TRANSIT' : 'MOON TRANSIT', transitText(x), x.f.id);
  for (const x of rare) ping('rare:' + x.f.id, 'RARE', `${x.what}: ${x.f.callsign} is ${Math.round(x.r.d)} km ${P16[pt16(x.r.brg)]} of you.`, x.f.id);
  const p = S.sats.passes.find(p => p.start > now && p.start - now < 180e3);
  if (p) ping('sat:' + p.sat.id + +p.start, p.sat.name.toUpperCase(), `${p.sat.name} rises in the ${P16L[pt16(p.startAz)]} in ${mmss((p.start - now) / 1000)}, climbing to ${Math.round(p.max)}°.`);
}
function transitText(x) {
  const body = x.body === 'sun' ? 'the sun' : 'the moon', when = x.t < 90 ? `in ${Math.round(x.t)} s` : `in ${mmss(x.t)}`;
  if (x.hit) return `${x.f.callsign} crosses ${body} ${when}, seen from right where you are. Look ${P16L[pt16(x.brg)]}, ${Math.round(x.elev)}° up. It lasts about ${x.dur < 1 ? 'a split second' : x.dur.toFixed(1) + ' s'}.`;
  return `${x.f.callsign} passes ${x.sep.toFixed(1)}° from ${body} ${when}. Move ${x.move.d < 1 ? Math.round(x.move.d * 1000) + ' m' : x.move.d.toFixed(1) + ' km'} ${P16L[pt16(x.move.brg)]} to see it cross dead centre.`;
}

// alerts: a toast while you're looking, plus a chime, a buzz and a system notification when you've switched them on
let audio = null;
function chime() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    for (const [f, d] of [[880, 0], [1320, 0.12]]) { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.5); o.connect(g).connect(audio.destination); o.start(t + d); o.stop(t + d + 0.55); }
  } catch (e) { /* no audio */ }
}
function ping(key, head, text, id) {
  if (S.alerted.has(key) || S.mode !== 'live') return; // never send anyone outside to look for a simulated plane
  S.alerted.add(key);
  const el = $('ping'); $('pingHead').textContent = head; $('pingText').textContent = text; el.hidden = false; el.dataset.id = id || '';
  clearTimeout(ping.t); ping.t = setTimeout(() => { el.hidden = true; }, 9000);
  pushEvent('info', `${head === 'LOOK UP' ? 'Overhead' : cap(head.toLowerCase())}: ${text}`);
  if (!settings.alerts) return;
  chime(); navigator.vibrate?.([80, 60, 80]);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') { try { new Notification('Squawk · ' + head, { body: text, tag: key }); } catch (e) { /* not allowed here */ } }
}
$('ping').onclick = () => { const id = $('ping').dataset.id; if (id && S.flights.has(id)) { select(id); } $('ping').hidden = true; };
async function toggleAlerts() {
  settings.alerts = !settings.alerts; saveSettings();
  if (settings.alerts) { chime(); if ('Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (e) { /* ignored */ } } }
  paintAlerts();
}
function paintAlerts() { for (const b of document.querySelectorAll('.alert-btn')) { b.setAttribute('aria-pressed', String(settings.alerts)); b.lastChild.textContent = settings.alerts ? 'Alerts on' : 'Alert me'; } }

// satellites: positions once a second, visible passes every 30 minutes and whenever home moves
let satT = 0, satPredT = 0;
async function startSats() {
  if (!settings.sats || S.sats.ready || S.sats.loading) return;
  S.sats.loading = true; try { await S.sats.load(); } catch (e) { /* CelesTrak unreachable */ } S.sats.loading = false;
  tickSats(true);
}
function tickSats(force) {
  if (!S.sats.ready || !settings.sats) return;
  const now = Date.now();
  if (force || now - satT > 1000) {
    satT = now; S.sats.update(new Date(now));
    for (const s of S.sats.list) if (s.pos) s.lit = Sats.sunlit(s.pos, new Date(now));
  }
  if (force || now - satPredT > 30 * 60e3) {
    satPredT = now; S.sats.predict(S.proj.lat0, S.proj.lon0, 24).then(() => { if (S.tab === 'next') renderPanel(false); });
    const iss = S.sats.list.find(s => s.id === 25544);
    if (iss) world.setOrbit(S.sats.track(iss, now));
  }
}

/* ---------------- flights ---------------- */
// The feed can hold thousands of aircraft from around the world. Only the ones that come within IN_RANGE of you
// count as catches for the log, badges and events.
function addFlight(f) {
  f.id = f.id || f.hex; f.phase = Math.random() * 3; f.emg = D.isEmergency(f); f.quiet = S.booting; dress(f);
  S.flights.set(f.id, f);
  if (f.emg) emergency(f);
}
// which 3D model and tail colour to draw
function dress(f) { f.model = modelOf(f.type, f.cat); f.livery = LIVERY[D.airlineCode(f.callsign)] || null; }
function catchFlight(f) {
  f.caught = true;
  const lg = theLog(), k = f.hex || f.id, now = Date.now(); lg.recent = lg.recent || {};
  if (now - (lg.recent[k] || 0) < AGAIN) return; // already caught in the last 12 h (a reload, or it flew out and back)
  lg.recent[k] = now;
  S.quiet = f.quiet; try { logCatch(f); } finally { S.quiet = false; }
  if (!f.quiet && D.HEAVY.has(f.type)) pushEvent('heavy', `${f.callsign}, a ${D.typeName(f)}, is in range at ${fmtAlt(f.alt)}`);
}
function emergency(f) { if (rel(f).d > IN_RANGE * 4) return; pushEvent('emg', `${f.callsign} is squawking ${f.squawk}`); if (f.squawk === '7700') award('mayday'); }
function removeFlight(id) { S.flights.delete(id); if (S.selId === id) select(null); }
function clearFlights() { S.flights.clear(); world.resetAircraft(); select(null); }

const staleAfter = () => Math.max(40, (S.region?.ms || POLL_MS) / 1000 * 2.5);
// feed values are checked, not trusted: a bad number would put NaN into the camera, a non-string would throw mid-batch
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : typeof v === 'number' && Number.isFinite(v) ? String(v).slice(0, n) : '');
function ingest(list) {
  const now = performance.now() / 1000;
  if (list.length > 20000) list = list.slice(0, 20000);
  for (const a of list) {
    if (!a || typeof a !== 'object' || a.alt_baro === 'ground') continue;
    const lat = num(a.lat), lon = num(a.lon), hex = str(a.hex, 12).toLowerCase();
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !hex) continue;
    const ft = num(a.alt_baro) ?? num(a.alt_geom);
    if (ft == null || ft > 200000) continue;
    const id = 'h' + hex, cs = str(a.flight, 10), reg = str(a.r, 12);
    const d = { hex, lat, lon, alt: Math.max(0, ft * 0.0003048), spd: clamp(num(a.gs) ?? 0, 0, 2500) * 0.000514444,
      vr: clamp(num(a.baro_rate) ?? num(a.geom_rate) ?? 0, -20000, 20000) * 0.00000508, squawk: str(a.squawk, 4), type: str(a.t, 6).toUpperCase(), desc: str(a.desc, 60), reg,
      cat: str(a.category, 2), callsign: cs || reg || hex.toUpperCase(), lastFix: now, kind: 'live', mil: !!(a.dbFlags & 1), odd: !!(a.dbFlags & 2) };
    const trk = num(a.track) ?? num(a.true_heading) ?? num(a.mag_heading);
    const f = S.flights.get(id);
    if (!f) addFlight({ id, trk: trk ?? 0, turn: 0, ...d });
    else { const was = f.emg, ty = f.type; Object.assign(f, d); if (trk != null) f.trk = trk; f.emg = D.isEmergency(f); if (f.emg && !was) emergency(f); if (ty !== f.type) dress(f); }
  }
  const stale = staleAfter(); for (const [id, f] of S.flights) if (now - f.lastFix > stale) removeFlight(id);
}
function reckon(dt) {
  const now = performance.now() / 1000, lim = staleAfter() * 0.6;
  for (const f of S.flights.values()) {
    if (now - f.lastFix > lim) continue;
    step(f, f.trk, f.spd * dt); f.alt = Math.max(0, f.alt + f.vr * dt);
  }
}
function simStep(dt) {
  const r = S.sim.step(S.flights, dt);
  for (const f of r.landed) if (!S.booting) pushEvent('land', `${f.callsign} touched down at ${S.sim.ap.name}`);
  for (const id of r.gone) removeFlight(id);
  for (const f of r.spawned) addFlight(f);
}

/* ---------------- feed ---------------- */
// The feed follows the camera. Looking at home it asks for 100 nm around you every 5 s. Look somewhere else and it
// asks around that spot instead, with a wider radius and a slower refresh the further out you zoom.
let feedGen = 0, pollT = null, fails = 0, inflight = false, lastReq = 0;
function region() {
  const f = world.focus(), vr = world.viewRadius(), home = S.proj;
  // until the feed works, and in ground view (you stand at home), just ask for home: small, quick and what matters first
  if (S.mode !== 'live' || !loaderDone || S.view === 'ground' || (haversine(home.lat0, home.lon0, f.lat, f.lon) < 120 && vr < 260)) return { lat: home.lat0, lon: home.lon0, nm: FEED_NM, ms: POLL_MS, home: true };
  const nm = [100, 250, 500, 1000, 2000, 3500].find(n => n * 1.852 >= vr) || 3500;
  return { lat: +f.lat.toFixed(2), lon: +f.lon.toFixed(2), nm, ms: nm <= 250 ? 5000 : nm <= 1000 ? 10000 : 30000 };
}
const regionMoved = (a, b) => !a || a.nm !== b.nm || haversine(a.lat, a.lon, b.lat, b.lon) > a.nm * 1.852 * 0.3;
function setFeed(mode, label) {
  $('feedChip').dataset.mode = mode; $('feedLabel').textContent = label;
  const every = S.region ? S.region.ms / 1000 : 5;
  $('feedNote').textContent = mode === 'live' ? `Receiving live positions from ${S.provider}, refreshed every ${every} seconds. ${S.region && !S.region.home ? `Showing up to ${S.region.nm.toLocaleString('en')} nm around the spot you're looking at.` : ''}`
    : mode === 'sim' ? 'Squawk can\'t reach the flight-tracking networks right now, so you are watching realistic simulated traffic. It tries again every minute. If it never connects, the networks may be blocking this site: host Squawk on Vercel or Netlify (the included config relays the feed), or paste a relay URL below. The README has the two-minute setup.'
    : 'Connecting to the flight-tracking networks.';
}
function startSim() {
  clearFlights(); S.mode = 'sim'; S.booting = true;
  for (const f of S.sim.initial()) addFlight(f);
  for (let i = 0; i < 30; i++) simStep(1);
  S.booting = false; setFeed('sim', 'Simulated sky');
}
async function poll(gen) {
  if (gen !== feedGen) return;
  clearTimeout(pollT); inflight = true; lastReq = performance.now();
  if (S.mode === 'sim') D.resetFeedSources(); // give every source a fresh chance on each retry
  const reg = S.region = region();
  let wait = reg.ms;
  try {
    const { list, provider } = await D.fetchAircraft(reg.lat, reg.lon, reg.nm);
    if (gen !== feedGen) return;
    if (S.mode !== 'live') { clearFlights(); S.mode = 'live'; S.booting = true; ingest(list); S.booting = false; }
    else ingest(list);
    S.provider = provider; fails = 0; setFeed('live', 'Live · ' + provider);
  } catch (e) {
    if (gen !== feedGen) return;
    // rate limited: back off (never faster than the normal refresh), and don't count it as the feed failing
    if (e.rate) { wait = Math.max(reg.ms * 2, 20000); if (S.mode === 'boot') startSim(); }
    else { fails++; if (S.mode !== 'sim' && (S.mode === 'boot' || fails >= 3)) startSim(); if (S.mode === 'sim') wait = 60000; }
  } finally {
    if (gen === feedGen) { inflight = false; S.feedResolved = true; pollT = setTimeout(() => poll(gen), wait); }
  }
}
function restartFeed() { feedGen++; clearTimeout(pollT); inflight = false; S.mode = 'boot'; S.region = null; S.feedResolved = false; setFeed('boot', 'Connecting'); poll(feedGen); }
// Called once a second: when the view has moved to a new area, ask for it now instead of waiting for the next poll.
function followView() {
  if (S.mode !== 'live' || !loaderDone || inflight || world.fly || performance.now() - lastReq < 2500) return;
  if (regionMoved(S.region, region())) poll(feedGen);
}

/* ---------------- place ---------------- */
// "Home" is where you stand: the pin, range rings, ground view, weather, log and badges all belong to it.
// On the first load the camera starts in space above home; later moves fly there.
function setPlace(p, boot, src) {
  settings.place = { name: p.name, lat: p.lat, lon: p.lon }; if (src) { settings.placeSrc = src; $('welcome').hidden = true; } saveSettings();
  S.proj = new Proj(p.lat, p.lon); $('placeName').textContent = p.name;
  const back = 'Back to ' + p.name.split(',')[0]; $('recenterBtn').dataset.tip = back; $('recenterBtn').setAttribute('aria-label', back + ' (H)');
  world.setHome(p.lat, p.lon); world.setAirports(D.AIRPORTS, S.proj);
  if (boot) world.flyTo(p.lat, p.lon, SPACE_R, { instant: true, theta: 0, phi: 0 });
  else { if (S.view === 'ground') setView('orbit'); world.flyTo(p.lat, p.lon, HOME_R, S.view === 'top' ? { theta: 0, phi: 0.02 } : { theta: 0.6, phi: 1.02 }); }
  clearFlights(); S.follow = false; S.pred = { over: [], tr: [], rare: [] }; world.setTransitLines([]);
  S.sim = new Sim(S.proj); S.history = []; S.rec = {}; satPredT = 0;
  buildPlaceLabels(); S.weather = null; loadWeather(); updateSun();
  restartFeed();
  if (S.tab !== 'sky') renderPanel(true);
}
async function loadWeather() {
  const at = S.proj;
  try { const w = await D.fetchWeather(at.lat0, at.lon0); if (at !== S.proj) return; S.weather = w; world.setWeather(w); }
  catch (e) { if (at !== S.proj) return; world.setWeather(null); }
  if (S.tab === 'weather') renderPanel(true);
  updateSun();
}
setInterval(() => S.proj && loadWeather(), 15 * 60e3);

function updateSun() {
  if (!S.proj) return;
  const d = new Date(Date.now() + S.timeOff * 3600e3);
  world.setSun(d);
  document.documentElement.dataset.sky = world.day > 0.45 ? 'day' : 'night';
  const off = S.weather?.utcOffset;
  const loc = off != null ? new Date(d.getTime() + off * 1000) : d;
  const hh = off != null ? loc.getUTCHours() : loc.getHours(), mm = off != null ? loc.getUTCMinutes() : loc.getMinutes();
  $('timeT').textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + (S.timeOff ? ` (${S.timeOff > 0 ? '+' : ''}${S.timeOff}h)` : ' local');
}
setInterval(updateSun, 20000);

/* ---------------- labels ---------------- */
const labelsEl = $('labels'), pool = [], placeLbls = [], P = { x: 0, y: 0, vis: false };
function getLabel(i) {
  if (!pool[i]) {
    const el = document.createElement('div'); el.className = 'pl'; el.innerHTML = '<b></b><span></span>';
    el.addEventListener('click', () => { if (el._id) select(el._id); }); labelsEl.appendChild(el); pool[i] = el;
  }
  return pool[i];
}
function buildPlaceLabels() {
  for (const p of placeLbls) p.el.remove(); placeLbls.length = 0;
  const add = (text, pos, cls) => { const el = document.createElement('div'); el.className = 'place-lbl ' + cls; el.textContent = text; labelsEl.appendChild(el); placeLbls.push({ el, pos, cls }); };
  add('You', new THREE.Vector3(0, 0.4, 0), 'you');
  for (const r of RINGS) add(r + ' km', new THREE.Vector3(0, -curvDrop(0, r) + 0.1, -r), 'ring');
  for (const a of world.airports) add(a.a[1] + ' · ' + a.a[2], a.pos, 'ap');
}
function updateLabels(arr) {
  const max = settings.labels === 'all' ? 150 : settings.labels === 'nearby' ? 24 : 0;
  const cam = world.camera.position, cand = [], lim = S.view === 'ground' ? Infinity : world.cam.r > 1500 ? 0 : (world.cam.r * 2.5 + 80) ** 2;
  if (max) for (const f of lim ? arr : S.selId && S.flights.has(S.selId) ? [S.flights.get(S.selId)] : []) { const v = world.vis.get(f.id); if (v) { const d = v.pos.distanceToSquared(cam); if (d < lim || f.id === S.selId) cand.push([f, v, d]); } }
  cand.sort((a, b) => a[2] - b[2]);
  const sel = S.selId && cand.findIndex(c => c[0].id === S.selId);
  if (sel > 0) cand.unshift(cand.splice(sel, 1)[0]);
  const rects = []; let n = 0;
  for (const [f, v] of cand) {
    const isSel = f.id === S.selId;
    if (n >= max && !isSel) break;
    world.project(v.pos, P); if (!P.vis) continue;
    const w = 12 + f.callsign.length * 7.2, h = 30, x = P.x + 12, y = P.y - 38;
    if (!isSel && rects.some(r => x < r[2] && x + w > r[0] && y < r[3] && y + h > r[1])) continue;
    rects.push([x, y, x + w, y + h]);
    const el = getLabel(n++); el._id = f.id;
    const rare = !!D.rareOf(f), key = f.callsign + fmtAlt(f.alt) + f.emg + isSel + rare + (f.vr > 0.001 ? 1 : f.vr < -0.001 ? 2 : 0);
    if (el._key !== key) {
      el._key = key; el.firstChild.textContent = f.callsign + (rare ? ' ★' : '');
      el.lastChild.textContent = f.emg ? 'SQUAWK ' + f.squawk : `${fmtAlt(f.alt)} ${f.vr > 0.001 ? '↑' : f.vr < -0.001 ? '↓' : ''}  ${f.type || ''}`;
      el.classList.toggle('sel', isSel); el.classList.toggle('emg', f.emg); el.classList.toggle('rare', rare && !f.emg);
      el.style.setProperty('--c', hexOf(v.col));
    }
    el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`; el.hidden = false;
  }
  for (let i = n; i < pool.length; i++) if (!pool[i].hidden) pool[i].hidden = true;
  const far = world.cam.r > 1500 && S.view !== 'ground';
  for (const p of placeLbls) {
    world.projectHome(p.pos, P);
    const show = P.vis && !(p.cls === 'ring' && S.view === 'ground') && !(far && p.cls !== 'you');
    p.el.hidden = !show; if (show) p.el.style.transform = `translate(${P.x.toFixed(1)}px,${P.y.toFixed(1)}px) translate(-50%,-50%)`;
  }
  let k = 0;
  if (settings.sats) for (const s of S.sats.list) {
    if (!s.star || !s.scene) continue;
    world.project(s.scene, P); if (!P.vis) continue;
    const el = satLbls[k] || (satLbls[k] = Object.assign(document.createElement('div'), { className: 'place-lbl sat' }));
    if (!el.isConnected) { labelsEl.appendChild(el); el.onclick = () => { if (el._s?.pos) { const ll = toLL(el._s.pos); setFollow(false); if (S.view === 'ground') setView('orbit'); world.flyTo(ll.lat, ll.lon, 4000, { phi: 0 }); } }; }
    el._s = s; el.textContent = `${s.name} · ${Math.round(s.alt)} km${s.lit === false ? ' · in shadow' : ''}`;
    el.style.transform = `translate(${(P.x + 10).toFixed(1)}px,${(P.y - 10).toFixed(1)}px)`; el.hidden = false; k++;
  }
  for (let i = k; i < satLbls.length; i++) satLbls[i].hidden = true;
}
const satLbls = [], toLL = p => { const r = Math.hypot(p.x, p.y, p.z); return { lat: Math.asin(p.y / r) * 180 / Math.PI, lon: Math.atan2(p.x, p.z) * 180 / Math.PI }; };

/* ---------------- selection & card ---------------- */
world.onPick = (cx, cy) => {
  let best = null, bd = 30 * 30;
  for (const f of S.flights.values()) {
    const v = world.vis.get(f.id); if (!v) continue; world.project(v.pos, P); if (!P.vis) continue;
    const d = (P.x - cx) ** 2 + (P.y - cy) ** 2; if (d < bd) { bd = d; best = f; }
  }
  select(best ? best.id : null);
};
function select(id) {
  S.selId = id && S.flights.has(id) ? id : null;
  $('card').hidden = !S.selId;
  if (!S.selId) { setFollow(false); return; }
  if (innerWidth < 760 && S.tab !== 'sky') setTab('sky');
  const f = S.flights.get(S.selId);
  if (f.kind === 'live') D.wantRoutes([f.callsign]);
  const ph = $('cPhoto'); ph.querySelector('img')?.remove(); $('cPhotoEmpty').hidden = false; $('cCredit').textContent = '';
  $('cPhotoEmpty').textContent = f.kind === 'live' ? 'Looking for a photo' : 'Simulated aircraft';
  $('cFr24').hidden = $('cAdsb').hidden = f.kind !== 'live';
  if (f.kind === 'live') {
    $('cFr24').href = `https://www.flightradar24.com/${encodeURIComponent(f.callsign)}`; $('cAdsb').href = `https://adsb.lol/?icao=${encodeURIComponent(f.hex)}`;
    D.fetchPhoto(f.hex).then(p => {
      if (S.selId !== id) return;
      if (!p) { $('cPhotoEmpty').textContent = 'No photo on Planespotters yet'; return; }
      const img = new Image(); img.alt = `${f.callsign} photographed by ${p.by}`; img.src = p.src; img.onload = () => { if (S.selId === id) { $('cPhotoEmpty').hidden = true; ph.appendChild(img); } };
      $('cCredit').innerHTML = `Photo © <a href="${esc(p.link)}" target="_blank" rel="noopener">${esc(p.by)} / Planespotters</a>`;
    });
  }
  updateCard();
}
function phase(f) {
  if (f.kind === 'arr') return f.d < 12 ? 'Final approach' : 'Inbound, descending';
  if (f.kind === 'dep') return f.alt < 3 ? 'Climbing out' : f.alt < f.cruise - 0.1 ? 'Climbing to cruise' : 'Cruising';
  if (f.kind === 'over') return 'Overflight';
  const v = fpm(f);
  if (f.alt < 3.5 && v < -300) return 'Approach, descending';
  if (f.alt < 5 && v > 300) return 'Climbing out';
  if (f.alt > 8 && Math.abs(v) < 400) return 'Cruising';
  return v > 300 ? 'Climbing' : v < -300 ? 'Descending' : 'Level flight';
}
// adsbdb matches routes by callsign, and callsigns get reused, so drop a route the aircraft is nowhere near
const routeFits = (f, rt) => rt.from.lat == null || rt.to.lat == null || f.lat == null ||
  haversine(rt.from.lat, rt.from.lon, f.lat, f.lon) + haversine(f.lat, f.lon, rt.to.lat, rt.to.lon) < haversine(rt.from.lat, rt.from.lon, rt.to.lat, rt.to.lon) * 1.2 + 250;
const routeOf = f => { if (f.kind !== 'live') return f.route; const rt = D.getRoute(f.callsign); return rt && routeFits(f, rt) ? rt : null; };
function updateCard() {
  const f = S.flights.get(S.selId); if (!f) return;
  const r = rel(f);
  $('cAirline').textContent = D.airlineName(f.callsign) || D.getRoute(f.callsign)?.airline || (f.kind === 'live' ? 'Operator unknown' : '');
  $('cCall').textContent = f.callsign; $('cType').textContent = D.typeName(f);
  $('cHeavy').hidden = !D.HEAVY.has(f.type);
  const sq = $('cSq'); sq.textContent = 'Squawk ' + (f.squawk || '----'); sq.className = 'pill' + (f.emg ? ' emg' : '');
  const rare = D.rareOf(f); $('cRare').hidden = !rare; $('cRare').textContent = rare || '';
  const ct = f.ctr; $('cCtr').hidden = !ct; $('cCtr').textContent = ct === 'persistent' ? 'Lasting contrail' : ct === 'short' ? 'Short contrail' : 'No contrail';
  $('cCtr').title = ct === 'persistent' ? 'Cold, ice-saturated air at this height: the trail should spread and linger.' : ct === 'short' ? 'Cold enough for a contrail, but dry air: it should fade within seconds.' : 'Too warm at this height for a contrail.';
  const rt = routeOf(f);
  $('cRoute').hidden = !rt;
  if (rt) {
    $('cFrom').textContent = rt.from.iata; $('cFromN').textContent = rt.from.name || ''; $('cTo').textContent = rt.to.iata; $('cToN').textContent = rt.to.name || '';
    let prog = 50;
    if (rt.from.lat != null && rt.to.lat != null && f.lat != null) { const a = haversine(rt.from.lat, rt.from.lon, f.lat, f.lon), b = haversine(f.lat, f.lon, rt.to.lat, rt.to.lon); prog = clamp(a / (a + b) * 100, 2, 98); }
    else if (f.kind === 'arr') prog = clamp(100 - f.d, 60, 98); else if (f.kind === 'dep') prog = clamp(f.flown / 30, 2, 40);
    $('cProg').style.width = prog + '%'; $('cPlaneIco').style.left = prog + '%';
  }
  // time to landing and time since take-off, from the great-circle distance at the current ground speed
  let eta = '';
  if (rt && rt.to.lat != null && f.spd > 0.05 && f.alt > 0.1 && f.lat != null) {
    const left = haversine(f.lat, f.lon, rt.to.lat, rt.to.lon) / f.spd, gone = rt.from.lat != null ? haversine(rt.from.lat, rt.from.lon, f.lat, f.lon) / f.spd : null;
    eta = `Lands in about <b>${dur(left)}</b> (${hhmm(new Date(Date.now() + left * 1000))} here)` + (gone != null && gone > 300 ? ` · left ${esc(rt.from.name || rt.from.iata)} about ${dur(gone)} ago` : '');
  }
  $('cEta').hidden = !eta; $('cEta').innerHTML = eta;
  const h = f.hist || [];
  $('cProf').hidden = h.length < 3;
  if (h.length >= 3) {
    const t0 = h[0][0], t1 = h[h.length - 1][0], top = Math.max(12.5, ...h.map(x => x[1])), X = t => ((t - t0) / Math.max(1, t1 - t0) * 300).toFixed(1), Y = a => (58 - a / top * 54).toFixed(1);
    const pts = h.map(x => X(x[0]) + ',' + Y(x[1])).join(' ');
    $('cProfL').setAttribute('points', pts); $('cProfA').setAttribute('points', `0,60 ${pts} 300,60`); $('cProfT').textContent = dur((t1 - t0) / 1000);
  }
  const home = settings.place.name.split(',')[0];
  lookText(r, home);
  $('cDist').textContent = `${r.d < 10 ? r.d.toFixed(1) : Math.round(r.d).toLocaleString('en')} km ${r.d > 600 ? 'from ' + home : 'away'} · bearing ${String(Math.round(r.brg)).padStart(3, '0')}°`;
  // what's coming: its closest pass, and any sun or moon crossing
  const age = S.pred.at ? (Date.now() - S.pred.at) / 1000 : 0, nx = f.next, tr = S.pred.tr.find(x => x.f === f);
  const ahead = nx && nx.t - age > 2 && nx.d < r.d - 1 ? `Closest in ${mmss(nx.t - age)}: ${nx.d < 1 ? 'right overhead' : nx.d.toFixed(1) + ' km ' + P16[pt16(nx.brg)]}, ${Math.round(nx.elev)}° up` : '';
  $('cNext').hidden = !(ahead || tr); $('cNext').textContent = tr ? transitText({ ...tr, t: Math.max(0, tr.t - age) }) : ahead;
  $('cNext').classList.toggle('tr', !!tr);
  $('cAlt').textContent = `${fmtAlt(f.alt)} · ${Math.round(f.alt * 1000).toLocaleString('en')} m`;
  $('cSpd').textContent = `${kt(f)} kt · ${Math.round(f.spd * 3600)} km/h`;
  $('cTrk').textContent = String(Math.round(f.trk)).padStart(3, '0') + '° ' + P16[pt16(f.trk)];
  const v = fpm(f); $('cVs').textContent = Math.abs(v) < 100 ? 'Level' : (v > 0 ? '+' : '−') + Math.abs(v).toLocaleString('en') + ' ft/min';
  $('cReg').textContent = f.reg || '—'; $('cPhase').textContent = phase(f);
  const fam = familyOf(f.type), facts = plainFacts(f, r);
  $('cFact').hidden = !fam && !facts.length; $('cFact').innerHTML = (fam ? `<b>${esc(fam.name)}.</b> ${esc(fam.fact)} ` : '') + esc(facts.join(' '));
  const canSee = S.mode === 'live' && r.d < 120 && r.elev > 1, seen = S.mode === 'live' && seenBefore(f);
  $('cSaw').hidden = !canSee && !seen; $('cSaw').disabled = seen; $('cSaw').lastChild.textContent = seen ? 'In your log as seen' : 'I saw it!';
  paintCompass(r);
}
// "Where to look" in plain words: which way to turn (or face, without a phone compass), then how high
function lookText(r, home) {
  const h = headingNow(), fists = Math.max(1, Math.round(r.elev / 10));
  let look, up;
  if (r.d > 600) { look = 'Too far to see'; up = `It's beyond the horizon from ${home}`; }
  else {
    if (h == null) look = `Face ${P16L[pt16(r.brg)]}`;
    else { const d = wrap(r.brg - h), a = Math.abs(d); look = a < 12 ? 'Straight ahead' : a > 160 ? 'Turn around' : `Turn ${d > 0 ? 'right' : 'left'} ${Math.round(a)}°`; }
    up = r.elev < 0.5 ? 'It\'s below your horizon for now' : r.elev > 75 ? 'Look almost straight up' : `Look ${Math.round(r.elev)}° up, about ${fists} fist${fists > 1 ? 's' : ''} above the horizon`;
  }
  $('cLook').textContent = look; $('cUp').textContent = up;
  const tb = coarse && r.d <= 600; $('cLookB').hidden = !tb; $('cCompass').hidden = !tb || sense.live;
}
// the compass turns with the phone, so the arrow always points at the plane; without a compass, north is up
let cmpH = NaN;
const roseLetters = [];
{
  let t = ''; for (let i = 0; i < 360; i += 15) { const a = i * Math.PI / 180, r1 = i % 90 ? 48 : 44, sn = Math.sin(a), cs = Math.cos(a); t += `M${(60 + sn * r1).toFixed(1)} ${(60 - cs * r1).toFixed(1)}L${(60 + sn * 52).toFixed(1)} ${(60 - cs * 52).toFixed(1)}`; }
  $('dRose').innerHTML = '<circle cx="60" cy="60" r="54" class="ring"/>' + `<path class="tick" d="${t}"/>` +
    ['N', 'E', 'S', 'W'].map((l, i) => `<text class="cl${i ? '' : ' n'}" x="${60 + [0, 1, 0, -1][i] * 35}" y="${60 - [1, 0, -1, 0][i] * 35}" text-anchor="middle" dominant-baseline="central">${l}</text>`).join('');
  roseLetters.push(...$('dRose').querySelectorAll('text'));
}
function paintCompass(r) {
  const h = headingNow(), hh = h ?? 0;
  if (Math.abs(hh - cmpH) > 0.3 || Number.isNaN(cmpH)) {
    cmpH = hh; $('dRose').setAttribute('transform', `rotate(${(-hh).toFixed(1)} 60 60)`);
    for (const t of roseLetters) t.setAttribute('transform', `rotate(${hh.toFixed(1)} ${t.getAttribute('x')} ${t.getAttribute('y')})`);
  }
  $('dArrow').setAttribute('transform', `rotate(${(r.brg - hh).toFixed(1)} 60 60)`);
  $('dYou').classList.toggle('off', h == null);
  $('dElev').textContent = r.elev < 0.5 ? '—' : Math.round(r.elev) + '°';
}
function setFollow(on) {
  S.follow = on && !!S.selId; $('cFollow').setAttribute('aria-pressed', String(S.follow)); $('cFollow').textContent = S.follow ? 'Following' : 'Follow';
  if (S.follow && S.view !== 'orbit') setView('orbit');
}
$('cClose').onclick = () => select(null);
$('cSaw').onclick = () => sawIt(S.flights.get(S.selId));
$('lvlChip').onclick = e => { e.stopPropagation(); setTab('log'); };
$('cFollow').onclick = () => setFollow(!S.follow);
$('cGround').onclick = () => { const f = S.flights.get(S.selId); if (!f) return; setFollow(false); setView('ground'); world.lookAtRel(rel(f)); };
world.onUnfollow = () => setFollow(false);

$('cCompass').onclick = async () => { if (!await startSense()) flash(sense.err === 'denied' ? 'Motion access was refused. Allow it in your browser settings to use the compass.' : 'This device has no compass.'); };
$('cAR').onclick = () => openAR(S.selId);

/* ---------------- sky camera ---------------- */
// Point the phone at the sky: the camera fills the screen and every aircraft in range gets a tag where it really is.
// Tags use true angles from home, so they line up when you stand at home. Drag sideways to fix a compass that's off.
const ar = { on: false, cam: null, pick: null, aim: null, pool: [], drag: null, infoT: 0, infoId: undefined, err: '' };
const AR_MAX = 30, arPt = {};
async function openAR(id) {
  if (ar.on) return;
  const sP = startSense(), cP = startCam($('arVid')).catch(() => null); // both straight from the tap, as iOS wants
  ar.on = true; ar.pick = id && S.flights.has(id) ? id : null; ar.aim = null; ar.infoId = undefined; ar.err = '';
  $('ar').hidden = false; $('ar').classList.remove('nocam'); $('arMsg').textContent = 'Starting the camera…';
  togglePop('placePop', 'placeBtn', false); togglePop('layersPop', 'layersBtn', false);
  const [okS, cam] = await Promise.all([sP, cP]);
  if (!ar.on) { stopCam($('arVid'), cam); return; }
  ar.cam = cam; $('ar').classList.toggle('nocam', !cam);
  if (!okS) ar.err = sense.err === 'denied' ? 'Motion access was refused, so Squawk can\'t tell where your phone points. Allow it in your browser settings and try again.' : 'This device has no motion sensor, so the sky camera can\'t follow it.';
  else if (!cam) { ar.err = 'No camera, so here are the tags on their own. They still point the right way.'; setTimeout(() => { if (ar.err.startsWith('No camera')) ar.err = ''; }, 6000); }
}
function closeAR() {
  if (!ar.on) return;
  ar.on = false; $('ar').hidden = true; stopCam($('arVid'), ar.cam); ar.cam = null;
  if (ar.pick && S.flights.has(ar.pick)) select(ar.pick);
}
function arTag(i) {
  if (!ar.pool[i]) { const el = document.createElement('div'); el.className = 'ar-tag'; el.innerHTML = '<i></i><div><b></b><span></span></div>'; $('arTags').appendChild(el); ar.pool[i] = el; }
  return ar.pool[i];
}
const hzLine = (x1, y1, x2, y2) => { const l = $('arHz'); l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2); };
function updateAR() {
  const W = innerWidth, H = innerHeight, now = performance.now(), fresh = sense.live && now - sense.t < 1500;
  const home = settings.place.name.split(',')[0];
  $('arDir').textContent = fresh ? `Facing ${P16[pt16(sense.heading)]} ${String(Math.round(sense.heading)).padStart(3, '0')}° · ${Math.abs(Math.round(sense.pitch))}° ${sense.pitch < 0 ? 'down' : 'up'}` : 'Sky camera';
  const msg = ar.err || (!fresh ? 'Waiting for the motion sensor…' : !sense.abs ? 'This phone doesn\'t report north. Drag sideways to line the tags up with the planes.'
    : sense.pitch < -15 ? 'Point your phone up at the sky.' : settings.placeSrc !== 'gps' ? `Tags show the sky from ${home}. Use your location if you're somewhere else.`
    : S.mode === 'sim' ? 'The live feed is down, so these are simulated planes.' : !inRange().length ? 'No aircraft within 185 km right now.' : '');
  if ($('arMsg').textContent !== msg) $('arMsg').textContent = msg;
  $('arGeo').hidden = settings.placeSrc === 'gps' || !!ar.err || !fresh; $('arReset').hidden = Math.abs(sense.nudge) < 0.5;
  if (!fresh) { for (const el of ar.pool) el.hidden = true; $('arEdge').hidden = true; $('arInfo').hidden = true; hzLine(0, 0, 0, 0); return; }
  const ax = axes(), fp = focal($('arVid'), W, H), hd = sense.heading;
  // horizon: two points on it either side of where you face, stretched across the screen
  const a = toScreen(hd - 10, 0, ax, W, H, fp, {}), b = toScreen(hd + 10, 0, ax, W, H, fp, {});
  if (a.front && b.front) { const dx = b.x - a.x, dy = b.y - a.y, k = (W + H) * 2 / (Math.hypot(dx, dy) || 1); hzLine(a.x - dx * k, a.y - dy * k, a.x + dx * k, a.y + dy * k); } else hzLine(0, 0, 0, 0);
  // tags, nearest first; the one nearest the middle of the screen is the one you're aiming at
  const list = inRange().filter(o => o.r.elev > -1 || o.f.id === ar.pick).sort((p, q) => p.r.slant - q.r.slant), shown = [];
  let aim = null, ad = (Math.min(W, H) * 0.18) ** 2, pickOn = false;
  for (const { f, r } of list) {
    toScreen(r.brg, r.elev, ax, W, H, fp, arPt);
    if (!arPt.front || arPt.x < -30 || arPt.x > W + 30 || arPt.y < -30 || arPt.y > H + 30) continue;
    if (f.id === ar.pick) pickOn = true;
    const d = (arPt.x - W / 2) ** 2 + (arPt.y - H / 2) ** 2; if (d < ad) { ad = d; aim = f; }
    shown.push({ f, r, x: arPt.x, y: arPt.y });
  }
  ar.aim = aim?.id || null;
  const rects = []; let n = 0;
  for (const o of shown) {
    const sel = o.f.id === ar.pick, top = sel || o.f.id === ar.aim;
    if (n >= AR_MAX && !top) continue;
    const w = 20 + Math.max(o.f.callsign.length * 10, 110), x = o.x, y = o.y - 16;
    if (!top && rects.some(q => x < q[2] && x + w > q[0] && y < q[3] && y + 38 > q[1])) continue;
    rects.push([x, y, x + w, y + 38]);
    const el = arTag(n++), key = o.f.callsign + fmtAlt(o.f.alt) + Math.round(o.r.d) + sel + top + o.f.emg;
    el._id = o.f.id; el._x = o.x; el._y = o.y;
    if (el._key !== key) {
      el._key = key; el.querySelector('b').textContent = o.f.callsign;
      el.querySelector('span').textContent = `${o.f.type || D.typeName(o.f)} · ${fmtAlt(o.f.alt)} · ${o.r.d < 10 ? o.r.d.toFixed(1) : Math.round(o.r.d)} km`;
      el.classList.toggle('sel', sel); el.classList.toggle('aim', top && !sel); el.classList.toggle('far', o.r.d > 80 && !top);
      el.style.setProperty('--c', o.f.emg ? '#FF2B2B' : hexOf(altColor(o.f.alt, tmpC)));
    }
    el.style.transform = `translate(${o.x.toFixed(1)}px,${o.y.toFixed(1)}px)`; el.style.zIndex = top ? 2 : 1; el.hidden = false;
  }
  for (let i = n; i < ar.pool.length; i++) if (!ar.pool[i].hidden) ar.pool[i].hidden = true;
  // the plane you tapped, when it's off the screen: an arrow at the edge showing which way to turn
  const pf = ar.pick && S.flights.get(ar.pick);
  if (pf && !pickOn) {
    const r = rel(pf); toScreen(r.brg, r.elev, ax, W, H, fp, arPt);
    let dx = arPt.dx, dy = arPt.dy; if (!arPt.front && Math.hypot(dx, dy) < 0.2) { dx = wrap(r.brg - hd) > 0 ? 1 : -1; dy = 0; }
    const ang = Math.atan2(dy, dx), ex = W / 2 + Math.cos(ang) * (W / 2 - 70), ey = H / 2 + Math.sin(ang) * (H / 2 - 130);
    $('arEdge').hidden = false; $('arEdge').style.transform = `translate(${ex.toFixed(0)}px,${ey.toFixed(0)}px) translate(-50%,-50%)`;
    $('arEdge').firstChild.style.transform = `rotate(${(ang * 180 / Math.PI + 180).toFixed(0)}deg)`;
    const turnBy = wrap(r.brg - hd);
    $('arEdgeT').textContent = r.elev < 0 ? `${pf.callsign} is below the horizon` : Math.abs(turnBy) > 25 ? `Turn ${turnBy > 0 ? 'right' : 'left'} for ${pf.callsign}` : `Tilt ${r.elev > sense.pitch ? 'up' : 'down'} for ${pf.callsign}`;
  } else $('arEdge').hidden = true;
  // the card at the bottom: the plane you tapped, or else the one in the middle
  const id = ar.pick && S.flights.has(ar.pick) ? ar.pick : ar.aim;
  if (id !== ar.infoId || now - ar.infoT > 500) { ar.infoId = id; ar.infoT = now; arInfo(id); }
}
function arInfo(id) {
  const f = id && S.flights.get(id); $('arInfo').hidden = !f; if (!f) return;
  const r = rel(f), rt = routeOf(f), al = D.airlineName(f.callsign) || rt?.airline || '';
  if (f.kind === 'live') D.wantRoutes([f.callsign]);
  $('arAl').textContent = [id === ar.pick ? 'Tracking' : 'You\'re pointing at', al].filter(Boolean).join(' · ');
  $('arCall').textContent = f.callsign;
  $('arSub').textContent = `${D.typeName(f)}${rt ? ` · ${rt.from.iata} to ${rt.to.iata}` : ''} · ${fmtAlt(f.alt)} · ${r.d < 10 ? r.d.toFixed(1) : Math.round(r.d)} km away, ${Math.max(0, Math.round(r.elev))}° up`;
  const canSee = S.mode === 'live' && r.d < 120 && r.elev > 1, seen = S.mode === 'live' && seenBefore(f);
  $('arSaw').hidden = !canSee && !seen; $('arSaw').disabled = seen; $('arSaw').textContent = seen ? 'Seen' : 'I saw it!';
}
$('arBtn').hidden = !coarse;
$('arBtn').onclick = () => openAR(S.selId);
$('arClose').onclick = e => { e.stopPropagation(); closeAR(); };
$('arMore').onclick = e => { e.stopPropagation(); ar.pick = ar.pick || ar.aim; closeAR(); };
$('arSaw').onclick = e => { e.stopPropagation(); const f = S.flights.get(ar.pick || ar.aim); if (f) { sawIt(f); ar.infoT = 0; } };
$('arGeo').onclick = e => { e.stopPropagation(); useMyLocation($('arGeo'), m => { ar.err = m; setTimeout(() => { ar.err = ''; }, 6000); }); };
$('arReset').onclick = e => { e.stopPropagation(); sense.nudge = 0; settings.nudge = 0; saveSettings(); };
// tap a tag to track it, tap the sky to let go; drag sideways to turn the tags if the compass is off
$('ar').addEventListener('pointerdown', e => { if (e.target.closest('button,.ar-info')) return; ar.drag = { x: e.clientX, id: e.pointerId, moved: false }; });
$('ar').addEventListener('pointermove', e => {
  const d = ar.drag; if (!d || d.id !== e.pointerId) return;
  const dx = e.clientX - d.x; if (!d.moved && Math.abs(dx) < 10) return;
  d.moved = true; d.x = e.clientX; sense.nudge = wrap(sense.nudge - dx / focal($('arVid'), innerWidth, innerHeight) * 180 / Math.PI);
});
$('ar').addEventListener('pointerup', e => {
  const d = ar.drag; if (!d || d.id !== e.pointerId) return; ar.drag = null;
  if (d.moved) { settings.nudge = +sense.nudge.toFixed(1); saveSettings(); return; }
  let best = null, bd = 44 * 44; // the tag marker nearest the tap, or the tag you tapped
  for (const el of ar.pool) { if (el.hidden) continue; const q = (e.clientX - el._x) ** 2 + (e.clientY - el._y) ** 2; if (q < bd) { bd = q; best = el._id; } }
  const tag = e.target.closest('.ar-tag'); if (!best && tag) best = tag._id;
  ar.pick = best || null; ar.infoT = 0;
});
$('ar').addEventListener('pointercancel', () => { ar.drag = null; });
// Android: the compass needs no tap, so start it as soon as it could be useful
if (coarse && !senseNeedsTap()) startSense();

/* ---------------- view, zoom, time ---------------- */
function setView(v) {
  if (v === 'globe') { if (S.view === 'ground') setView('orbit'); setFollow(false); const f = world.focus(); world.flyTo(f.lat, f.lon, 16000, { phi: 0 }); paintView(); return; }
  S.view = v; world.setMode(v);
  if (v !== 'orbit') { S.follow = false; $('cFollow').setAttribute('aria-pressed', 'false'); $('cFollow').textContent = 'Follow'; }
  paintView();
}
// "Globe" isn't a camera mode, it's orbit or map zoomed out far enough to see the planet
function paintView() {
  const globe = S.view !== 'ground' && (world.fly ? world.fly.b.r : world.cam.r) > 6000;
  document.querySelectorAll('#viewSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === 'globe' ? globe : b.dataset.v === S.view && !globe)));
}
document.querySelectorAll('#viewSeg button').forEach(b => b.onclick = () => setView(b.dataset.v));
$('zIn').onclick = () => world.zoom(0.75); $('zOut').onclick = () => world.zoom(1.33);
function recenter() { setFollow(false); world.recenter(); }
$('zHome').onclick = recenter; $('recenterBtn').onclick = recenter;
$('timeR').oninput = e => { S.timeOff = +e.target.value; $('liveBtn').setAttribute('aria-pressed', String(S.timeOff === 0)); updateSun(); };
$('liveBtn').onclick = () => { S.timeOff = 0; $('timeR').value = 0; $('liveBtn').setAttribute('aria-pressed', 'true'); updateSun(); };

/* ---------------- popovers ---------------- */
const POPS = [['placePop', 'placeBtn'], ['layersPop', 'layersBtn'], ['acctPop', 'acctBtn']];
function togglePop(id, btn, show) {
  const el = $(id); const on = show ?? el.hidden; el.hidden = !on; $(btn).setAttribute('aria-expanded', String(on));
  if (on) { for (const [o, b] of POPS) if (o !== id) { $(o).hidden = true; $(b).setAttribute('aria-expanded', 'false'); } }
}
$('placeBtn').onclick = e => { e.stopPropagation(); togglePop('placePop', 'placeBtn'); if (!$('placePop').hidden) $('searchQ').focus(); };
$('layersBtn').onclick = e => { e.stopPropagation(); togglePop('layersPop', 'layersBtn'); };
$('feedChip').onclick = e => { e.stopPropagation(); togglePop('layersPop', 'layersBtn', true); };
$('relayQ').value = D.feedConfig.relayUrl;
$('relayQ').oninput = () => $('relayQ').setCustomValidity('');
$('relayForm').onsubmit = e => {
  e.preventDefault(); const v = $('relayQ').value.trim();
  if (v && !relayOK(v)) { $('relayQ').setCustomValidity('Use a full https:// address'); $('relayQ').reportValidity(); return; }
  settings.relay = v; saveSettings(); D.feedConfig.relayUrl = v; D.resetFeedSources(); restartFeed();
};
document.addEventListener('pointerdown', e => {
  for (const [o, b] of POPS) if (!$(o).hidden && !$(o).contains(e.target) && !$(b).contains(e.target) && !$('feedChip').contains(e.target)) togglePop(o, b, false);
});
document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName) || e.ctrlKey || e.metaKey || e.altKey;
  if ((e.key === 'h' || e.key === 'H') && !typing) { recenter(); return; }
  if ((e.key === 'p' || e.key === 'P') && !typing) { setPhoto(!document.body.classList.contains('photo')); return; }
  if (e.key !== 'Escape') return;
  if (ar.on) { closeAR(); return; }
  if (document.body.classList.contains('photo')) { setPhoto(false); return; }
  if (POPS.some(([o]) => !$(o).hidden)) { for (const [o, b] of POPS) togglePop(o, b, false); }
  else if (S.selId) select(null); else if (S.tab !== 'sky') setTab('sky');
});
$('presets').innerHTML = D.PLACES.map((p, i) => `<li><button data-i="${i}">${esc(p.name)}<small>${p.lat.toFixed(1)}, ${p.lon.toFixed(1)}</small></button></li>`).join('');
$('presets').onclick = e => { const b = e.target.closest('button'); if (!b) return; setPlace(D.PLACES[+b.dataset.i], false, 'pick'); togglePop('placePop', 'placeBtn', false); };
$('geoBtn').onclick = async () => { if (await useMyLocation($('geoBtn'), m => { $('results').innerHTML = `<li class="lede">${esc(m)}</li>`; })) togglePop('placePop', 'placeBtn', false); };

/* ---------------- your location ---------------- */
// Everyone starts with a guess from their time zone, then gets asked once per visit until they share a location or pick a place.
// With location already allowed, a returning visitor is quietly moved to where they are now.
function tzGuess() {
  try {
    const city = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').split('/').pop().replace(/_/g, ' ').replace('Calcutta', 'Kolkata');
    if (!city) return null;
    const p = D.PLACES.find(p => p.name.startsWith(city)); if (p) return p;
    const a = D.AIRPORTS.find(a => a[2].startsWith(city)); if (a) return { name: a[2], lat: a[3], lon: a[4] };
  } catch (e) { /* no Intl */ }
  return null;
}
async function geoState() {
  if (!window.isSecureContext) return 'insecure';
  if (!navigator.geolocation) return 'none';
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch (e) { return 'prompt'; }
}
const locate = () => new Promise((ok, no) => navigator.geolocation.getCurrentPosition(p => ok({ lat: p.coords.latitude, lon: p.coords.longitude }), no, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }));
async function useMyLocation(btn, fail) {
  if (!window.isSecureContext) { fail('Browsers only share your location with secure (https) sites. Open Squawk from its https link, or search for your town.'); return false; }
  if (!navigator.geolocation) { fail('This browser can\'t share its location. Search for your town instead.'); return false; }
  const lbl = btn.lastChild.textContent; btn.disabled = true; btn.lastChild.textContent = 'Finding you…';
  try {
    const c = await locate(), name = await D.reverseGeocode(c.lat, c.lon);
    setPlace({ name, lat: c.lat, lon: c.lon }, !loaderDone, 'gps'); return true;
  } catch (err) {
    fail(err.code === 1 ? 'Location access is blocked for this site. Allow it in your browser\'s site settings, or search for your town.' : 'Couldn\'t get your location just now. Try again, or search for your town.'); return false;
  } finally { btn.disabled = false; btn.lastChild.textContent = lbl; }
}
let welcomeDue = false;
async function bootLocate() {
  const st = await geoState();
  if (st === 'granted' && settings.placeSrc !== 'pick') {
    try {
      const c = await locate(), h = settings.place;
      if (settings.placeSrc === 'gps' && haversine(h.lat, h.lon, c.lat, c.lon) < 3) return; // still at home
      setPlace({ name: await D.reverseGeocode(c.lat, c.lon), lat: c.lat, lon: c.lon }, !loaderDone, 'gps'); return;
    } catch (e) { /* fall through and ask */ }
  }
  if (settings.placeSrc) return;
  const at = settings.place.name.split(',')[0];
  $('welT').textContent = st === 'insecure' ? `You're looking at the sky over ${at}. Browsers only share your location with secure (https) sites, so search for your town to see the planes above you.`
    : st === 'denied' ? `You're looking at the sky over ${at}. Location is blocked for this site: allow it in your browser's site settings, or search for your town.`
    : `You're looking at the sky over ${at}. Share your location to see the planes above you right now. It stays in this browser.`;
  $('welGeo').hidden = st === 'insecure' || st === 'none';
  if (loaderDone) $('welcome').hidden = false; else welcomeDue = true;
}
$('welGeo').onclick = () => useMyLocation($('welGeo'), m => { $('welT').textContent = m; });
$('welPick').onclick = e => { e.stopPropagation(); $('welcome').hidden = true; togglePop('placePop', 'placeBtn', true); $('searchQ').focus(); };
$('welLater').onclick = () => { $('welcome').hidden = true; };

let results = [];
$('searchForm').onsubmit = async e => {
  e.preventDefault(); const q = $('searchQ').value.trim(); if (!q) return;
  const res = $('results'); res.innerHTML = '<li class="lede">Searching…</li>';
  try {
    results = await D.geocode(q);
    res.innerHTML = results.length ? results.map((r, i) => `<li><button data-i="${i}" title="${esc(r.full)}">${esc(r.name)}<small>${r.lat.toFixed(2)}, ${r.lon.toFixed(2)}</small></button></li>`).join('') : '<li class="lede">No places found. Try a city name.</li>';
  } catch (err) { res.innerHTML = '<li class="lede">Search is unavailable right now. Pick a preset below.</li>'; }
};
$('results').onclick = e => { const b = e.target.closest('button'); if (!b) return; const r = results[+b.dataset.i]; setPlace(r, false, 'pick'); togglePop('placePop', 'placeBtn', false); };

function bindSeg(id, get, set) {
  const bs = document.querySelectorAll(`#${id} button`);
  const paint = () => bs.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === get())));
  bs.forEach(b => b.onclick = () => { set(b.dataset.v); paint(); }); paint();
}
bindSeg('styleSeg', () => settings.style, v => { settings.style = v; saveSettings(); world.setStyle(v); $('tileCredit').textContent = TILE_STYLES[v].credit; });
bindSeg('namesSeg', () => settings.names ? 'on' : 'off', v => { settings.names = v === 'on'; saveSettings(); world.setNames(settings.names); });
bindSeg('cloudSeg', () => settings.clouds ? 'on' : 'off', v => { settings.clouds = v === 'on'; saveSettings(); world.cloudsOn = settings.clouds; });
bindSeg('labelSeg', () => settings.labels, v => { settings.labels = v; saveSettings(); });
bindSeg('radarSeg', () => settings.radar ? 'on' : 'off', v => { settings.radar = v === 'on'; saveSettings(); world.setRadar(settings.radar); });
bindSeg('satSeg', () => settings.sats ? 'on' : 'off', v => { settings.sats = v === 'on'; saveSettings(); if (settings.sats) startSats(); });
$('tileCredit').textContent = TILE_STYLES[settings.style].credit;
world.setStyle(settings.style); world.setNames(settings.names); world.setRadar(settings.radar);
world.cloudsOn = settings.clouds;

/* ---------------- account and profile ---------------- */
const PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-4.4 0-8 2.5-8 5.5V21h16v-1.5c0-3-3.6-5.5-8-5.5z"/></svg>';
// plane avatars: a silhouette on a colour; everyone starts with one picked from their account id
const AVATARS = [['a380', '#FF5A1F', 'A380'], ['jumbo', '#2563EB', '747'], ['wide', '#FF3D8B', 'Widebody'], ['narrow', '#16A34A', 'Narrowbody'], ['prop', '#D97706', 'Turboprop'],
  ['heli', '#7C3AED', 'Helicopter'], ['light', '#0891B2', 'Light aircraft'], ['lifter', '#475569', 'Military transport'], ['rear', '#EA580C', 'Business jet'], ['quad', '#0D9488', 'Four-engine jet']].map(([id, c, name]) => ({ id, c, name }));
const hashS = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const avOf = () => prof?.av || AVATARS[hashS(acct?.uid || '') % AVATARS.length].id;
const planeAv = a => `<span class="pa" style="--c:${a.c}">${silhouette(a.id)}</span>`;
function avatar() {
  const av = avOf();
  if (av === 'photo' && prof?.photo) return `<img src="${esc(prof.photo)}" alt="">`;
  if (av === 'google' && acct?.photo) return `<img src="${esc(acct.photo)}" alt="" referrerpolicy="no-referrer">`;
  return planeAv(AVATARS.find(a => a.id === av) || AVATARS[0]);
}
const myName = () => prof?.name || acct?.name || (acct?.email || '').split('@')[0] || 'Spotter';
function setProf(patch) {
  if (!acct) return; prof = { ...prof, ...patch, at: Date.now() }; store.set(profKey(), prof); paintAcct(); pushLog();
}
let acctMode = 'in';
function paintAcct() {
  const b = $('acctBtn'), u = acct; b.hidden = !cloudOn; b.classList.toggle('in', !!u);
  b.innerHTML = u ? avatar() : PERSON; b.setAttribute('aria-label', u ? `Your profile: ${myName()}` : 'Sign in');
  if (S.tab === 'log' || (S.tab === 'profile' && !$('panel').contains(document.activeElement))) renderPanel(false);
}
function acctMsg(t, bad) { $('acctMsg').textContent = t; $('acctMsg').classList.toggle('bad', !!bad); }
function paintAcctMode() {
  $('emailGo').textContent = acctMode === 'new' ? 'Create account' : 'Sign in';
  $('acctSwap').textContent = acctMode === 'new' ? 'Have an account? Sign in' : 'New here? Create an account';
  $('pwQ').autocomplete = acctMode === 'new' ? 'new-password' : 'current-password'; $('acctForgot').hidden = acctMode === 'new';
}
// Moving between accounts (or back to this browser's own log) saves the old log first, then loads the new one.
// A new account starts with an empty log; this browser's signed-out log stays where it is.
function switchAcct(u) {
  const was = acct?.uid || null, now = u?.uid || null;
  if (saveT) writeLog();
  if (was === now) { if (u) { acct = u; store.set('squawk.acct', u); paintAcct(); pushLog(); } return; }
  const clean = !dirty; clearTimeout(cloudT); cloudT = null; dirty = false;
  if (!u && was && clean) { try { localStorage.removeItem(LOGKEY + '.' + was); localStorage.removeItem('squawk.profile.' + was); } catch (e) { /* storage unavailable */ } } // all of it is in the cloud
  acct = u; if (u) store.set('squawk.acct', u); else { try { localStorage.removeItem('squawk.acct'); } catch (e) { /* storage unavailable */ } }
  prof = u ? store.get(profKey(), null) : null;
  useLog(store.get(logKey(), null) || newLog()); store.set(logKey(), logLive);
  if (!u && S.tab === 'profile') setTab('sky');
  paintAcct();
  if (u) pushLog();
}
async function busy(btn, job, msg = acctMsg) {
  btn.disabled = true; msg('');
  try { await job(); } catch (e) { msg(authError(e), true); } finally { btn.disabled = false; }
}
$('acctBtn').onclick = e => { e.stopPropagation(); if (acct) setTab(S.tab === 'profile' ? 'sky' : 'profile'); else togglePop('acctPop', 'acctBtn'); };
$('gBtn').onclick = () => busy($('gBtn'), signInGoogle);
$('acctSwap').onclick = () => { acctMode = acctMode === 'new' ? 'in' : 'new'; paintAcctMode(); acctMsg(''); };
$('acctForgot').onclick = () => {
  const m = $('emailQ').value.trim(); if (!m || !$('emailQ').checkValidity()) { acctMsg('Type your email above first, then tap "Forgot password?" again.', true); return; }
  busy($('acctForgot'), async () => { await resetPassword(m); acctMsg(`If there's an account for ${m}, a reset link is on its way. Check your spam folder too.`); });
};
$('emailForm').onsubmit = e => { e.preventDefault(); busy($('emailGo'), () => signInEmail($('emailQ').value.trim(), $('pwQ').value, acctMode === 'new')); };
paintAcct(); paintAcctMode();
onUser(u => { if (u) { $('pwQ').value = ''; acctMsg(''); if (!$('acctPop').hidden) togglePop('acctPop', 'acctBtn', false); } switchAcct(u); });

const dkey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function profileHTML() {
  const lg = logLive, L = levelOf(lg.xp || 0), days = lg.days || [], types = Object.entries(lg.types), al = Object.entries(lg.airlines);
  const fams = new Set(types.map(([c]) => familyOf(c)?.id).filter(Boolean)).size;
  const topT = [...types].sort((a, b) => b[1].n - a[1].n)[0], topA = [...al].sort((a, b) => b[1] - a[1])[0];
  const got = BADGES.filter(b => lg.badges[b.id]).sort((a, b) => lg.badges[b.id] - lg.badges[a.id]);
  const since = new Date(lg.reset || lg.since || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  // the last 12 weeks, one square per day: columns are weeks starting on Monday
  const on = new Set(days), d = new Date(); d.setHours(12); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 77);
  const now = dkey(new Date()), from = dkey(d); let heat = '';
  for (let i = 0; i < 84; i++, d.setDate(d.getDate() + 1)) { const k = dkey(d); heat += `<i class="${k > now ? 'fut' : on.has(k) ? 'on' : ''}${k === now ? ' today' : ''}" title="${k}"></i>`; }
  const active = days.filter(k => k >= from).length;
  const tile = (k, v) => `<div class="tile"><p class="k">${k}</p><p class="v">${v}</p></div>`;
  const fav = (k, v, s) => `<div class="fav"><small>${k}</small><b>${v ? esc(v) : '—'}</b>${v && s ? `<span>${esc(s)}</span>` : ''}</div>`;
  const cur = avOf(), opt = (id, inner, label) => `<button class="av-opt" type="button" data-av="${id}" aria-pressed="${cur === id}" aria-label="${esc(label)}" title="${esc(label)}">${inner}</button>`;
  return `<div class="pf-head"><span class="pf-av">${avatar()}</span><div class="pf-id"><h3>${esc(myName())}</h3><p>Level ${L.n} · ${esc(L.name)}</p><small>Log started ${since}</small></div></div>
  <div class="pf-xp"><div class="xpbar"><i style="width:${Math.round(L.pct * 100)}%"></i></div><small>${L.xp.toLocaleString('en')} XP${L.to ? ` · ${(L.to - L.xp).toLocaleString('en')} to level ${L.n + 1}` : ' · top level'}</small></div>
  <div class="tiles4">${tile('Caught', (lg.tracked || 0).toLocaleString('en'))}${tile('Types', types.length)}${tile('Airlines', al.length)}${tile('Seen', lg.seen || 0)}</div>
  <div class="tiles4">${tile('Streak', streak(days))}${tile('Best run', bestStreak(days))}${tile('Days out', days.length)}${tile('Badges', `${got.length}/${BADGES.length}`)}</div>
  <div><p class="sec-h">Favourites</p><div class="favs">${fav('Most caught', topT && (D.TYPES[topT[0]] || topT[0]), topT && `×${topT[1].n}`)}${fav('Top airline', topA && (D.AIRLINES[topA[0]] || topA[0]), topA && `×${topA[1]}`)}${fav('Collection', `${fams} of ${FAMILIES.length}`, 'families')}</div></div>
  <div><p class="sec-h">Last 12 weeks · ${active} ${active === 1 ? 'day' : 'days'} spotting</p><div class="heat">${heat}</div></div>
  <div><p class="sec-h">Latest badges</p>${got.length ? `<div class="pf-badges">${got.slice(0, 3).map(b => `<span class="chip-b">${ICON_STAR}${esc(b.name)}</span>`).join('')}</div>` : '<p class="lede">No badges yet. Your first catch earns one.</p>'}</div>
  <div class="pf-edit"><p class="sec-h">Your picture</p>
    <div class="av-grid">${AVATARS.map(a => opt(a.id, planeAv(a), a.name)).join('')}${prof?.photo ? opt('photo', `<img src="${esc(prof.photo)}" alt="">`, 'Your photo') : ''}${acct?.photo ? opt('google', `<img src="${esc(acct.photo)}" alt="" referrerpolicy="no-referrer">`, 'Google photo') : ''}</div>
    <button class="btn wide" type="button" id="pfUpload"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/></svg>${prof?.photo ? 'Change your photo' : 'Use your own photo'}</button>
    <input type="file" id="pfFile" accept="image/*" hidden>
    <p class="acct-msg" id="pfMsg" role="status"></p>
    <p class="sec-h">Display name</p>
    <form class="search" id="pfNameForm"><label class="sr" for="pfName">Display name</label><input id="pfName" maxlength="40" autocomplete="nickname" value="${esc(myName())}"><button class="btn" type="submit">Save</button></form></div>
  <div class="pf-edit"><p class="sec-h">Account</p><p class="lede">Signed in as <b>${esc(acct?.email || '')}</b>. Your log, streak and badges are saved to your account and follow you to any device you sign in on.</p>
    <div class="pf-actions"><button class="btn" type="button" id="signOutBtn">Sign out</button><button class="btn danger" type="button" id="resetBtn">Start my log again</button></div></div>`;
}
// a square crop, 192 px, as a JPEG data URL: about 20 KB, small enough to live in the profile document
async function photoFrom(file) {
  const img = await createImageBitmap(file), n = 192, c = document.createElement('canvas'), s = Math.min(img.width, img.height);
  c.width = c.height = n; c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, n, n);
  return c.toDataURL('image/jpeg', 0.85);
}
function bindProfile() {
  const msg = (t, bad) => { const el = $('pfMsg'); if (el) { el.textContent = t; el.classList.toggle('bad', !!bad); } };
  for (const b of $('panelBody').querySelectorAll('.av-opt')) b.onclick = () => setProf({ av: b.dataset.av });
  $('pfUpload').onclick = () => $('pfFile').click();
  $('pfFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 25e6) { msg('That picture is too big. Pick one under 25 MB.', true); return; }
    try { setProf({ av: 'photo', photo: await photoFrom(f) }); } catch (x) { msg('Couldn\'t read that picture. Try a JPEG or PNG.', true); }
  };
  $('pfNameForm').onsubmit = e => { e.preventDefault(); const v = $('pfName').value.trim().slice(0, 40); $('pfName').blur(); setProf({ name: v }); flash('Name saved'); };
  $('signOutBtn').onclick = () => busy($('signOutBtn'), async () => { if (saveT) writeLog(); if (dirty) await pushLog(); await signOut(); }, msg);
  const r = $('resetBtn');
  r.onclick = () => {
    if (!r.classList.contains('armed')) { r.classList.add('armed'); r.textContent = 'Tap again to erase your log'; setTimeout(() => { r.classList.remove('armed'); r.textContent = 'Start my log again'; }, 4000); return; }
    useLog({ ...newLog(), reset: Date.now() }); writeLog(); pushLog(); renderPanel(false); flash('Your log starts again from today');
  };
}

/* ---------------- phone bottom sheets: drag the handle down to close, up to expand ---------------- */
function sheet(el, close) {
  const g = el.querySelector('.grab'); let y0 = null, dy = 0;
  g.addEventListener('pointerdown', e => { y0 = e.clientY; dy = 0; g.setPointerCapture(e.pointerId); el.classList.add('dragging'); });
  g.addEventListener('pointermove', e => { if (y0 == null) return; dy = e.clientY - y0; el.style.transform = `translateY(${Math.max(dy, -40)}px)`; });
  const end = () => {
    if (y0 == null) return; y0 = null; el.classList.remove('dragging'); el.style.transform = '';
    if (dy > 90) { el.classList.remove('tall'); close(); } else if (dy < -50) el.classList.add('tall'); else if (dy > 30) el.classList.remove('tall');
  };
  g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
}
sheet($('panel'), () => setTab('sky')); sheet($('card'), () => select(null));

/* ---------------- photo mode ---------------- */
function setPhoto(on) {
  document.body.classList.toggle('photo', on); $('photoBar').hidden = !on; world.cinematic = on;
  if (on) for (const [o, b] of POPS) togglePop(o, b, false);
}
$('photoBtn').onclick = () => setPhoto(true); $('photoExit').onclick = () => setPhoto(false);
$('shotBtn').onclick = () => {
  // draw a fresh frame and copy it before the browser clears the buffer, then add a small caption
  world.composer.render();
  const src = world.renderer.domElement, c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const g = c.getContext('2d'); g.drawImage(src, 0, 0);
  const k = c.width / innerWidth, pad = 22 * k, text = `SQUAWK · ${settings.place.name} · ${new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`;
  g.font = `600 ${15 * k}px 'Martian Mono', monospace`; g.fillStyle = 'rgba(0,0,0,.35)'; g.fillText(text, pad + k, c.height - pad + k); g.fillStyle = '#fff'; g.fillText(text, pad, c.height - pad);
  c.toBlob(b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `squawk-${Date.now()}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png');
};

/* ---------------- tabs & panels ---------------- */
const TAB_META = { next: ['Coming up', 460], board: ['Overhead board', 720], stats: ['Sky stats', 440], weather: ['Spotting weather', 420], log: ['Spotter\'s log', 460], codes: ['Squawk codes', 440], profile: ['Your profile', 460] };
function setTab(t) {
  S.tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  const panel = $('panel');
  if (t === 'sky') { panel.hidden = true; return; }
  if (innerWidth < 760 && S.selId) select(null);
  panel.hidden = false; panel.style.setProperty('--pw', TAB_META[t][1] + 'px'); $('panelTitle').textContent = TAB_META[t][0];
  renderPanel(true);
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setTab(S.tab === b.dataset.tab && b.dataset.tab !== 'sky' ? 'sky' : b.dataset.tab));
$('panelClose').onclick = () => setTab('sky');

function renderPanel(fresh) {
  const body = $('panelBody');
  if (S.tab === 'board') { if (fresh || !$('flapBoard')) buildBoard(body); updateBoard(); renderEvents(); }
  else if (S.tab === 'next') { body.innerHTML = nextHTML(); for (const b of body.querySelectorAll('[data-id]')) b.onclick = () => { if (S.flights.has(b.dataset.id)) { select(b.dataset.id); setFollow(true); } }; for (const b of body.querySelectorAll('.alert-btn')) b.onclick = toggleAlerts; paintAlerts(); }
  else if (S.tab === 'stats') body.innerHTML = statsHTML();
  else if (S.tab === 'weather') { if (fresh || !renderPanel.wxDone) { body.innerHTML = weatherHTML(); renderPanel.wxDone = true; } }
  else if (S.tab === 'profile') { if (!acct) { setTab('sky'); return; } body.innerHTML = profileHTML(); bindProfile(); }
  else if (S.tab === 'log') { body.innerHTML = logHTML(); $('shareBtn').onclick = shareLog; if ($('logSignIn')) $('logSignIn').onclick = e => { e.stopPropagation(); togglePop('acctPop', 'acctBtn', true); }; }
  else if (S.tab === 'codes' && fresh) body.innerHTML = codesHTML();
  if (fresh) renderPanel.wxDone = S.tab === 'weather';
}

/* board */
const COLS = [{ k: 'call', w: 7, h: 'Flight' }, { k: 'type', w: 4, h: 'Type' }, { k: 'route', w: 7, h: 'Route' }, { k: 'alt', w: 5, h: 'Alt' }, { k: 'dist', w: 4, h: 'Km' }, { k: 'look', w: 7, h: 'Look' }];
const ROWS = 14, FLAP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
let rowEls = [];
function buildBoard(body) {
  body.innerHTML = `<p class="lede">Nearest aircraft first. LOOK gives the compass direction and how many degrees above the horizon to look from ${esc(settings.place.name)}. Tap a row to find it in the sky.</p>
    <div class="board" id="flapBoard"></div><div class="board-foot"><span>ALT in feet below FL050</span><span id="boardSrc"></span></div>
    <div><p class="sec-h">Spotter's feed</p><ul class="events" id="events"></ul></div>`;
  const board = $('flapBoard'); rowEls = [];
  const head = document.createElement('div'); head.className = 'brow head';
  for (const c of COLS) { const s = document.createElement('span'); s.className = 'h'; s.textContent = c.h; s.style.width = `calc(${c.w} * (1.3 * 12px + 2px))`; head.appendChild(s); }
  board.appendChild(head);
  for (let i = 0; i < ROWS; i++) {
    const row = document.createElement('button'); row.className = 'brow'; row.type = 'button'; const cells = {};
    for (const c of COLS) { const cell = document.createElement('span'); cell.className = 'cell col-' + c.k; const fl = []; for (let j = 0; j < c.w; j++) { const f = document.createElement('span'); f.className = 'f'; f.textContent = ' '; cell.appendChild(f); fl.push(f); } cells[c.k] = fl; row.appendChild(cell); }
    row.onclick = () => { if (row.dataset.id) { select(row.dataset.id); setFollow(true); } };
    board.appendChild(row); rowEls.push({ row, cells });
  }
}
function flipTo(el, ch, delay) {
  if (el.dataset.t === ch) return; el.dataset.t = ch;
  let n = 3 + Math.floor(Math.random() * 3);
  const tick = () => { el.classList.remove('flip'); void el.offsetWidth; el.classList.add('flip'); if (n-- > 0) { el.textContent = FLAP[Math.floor(Math.random() * FLAP.length)]; setTimeout(tick, 65); } else el.textContent = el.dataset.t; };
  setTimeout(tick, delay);
}
function setCell(fl, str, i) { const s = (str || '').toUpperCase().slice(0, fl.length).padEnd(fl.length, ' '); fl.forEach((el, j) => flipTo(el, s[j], i * 35 + j * 22)); }
function updateBoard() {
  if (!$('flapBoard')) return;
  const list = [...S.flights.values()].map(f => ({ f, r: rel(f) })).sort((a, b) => a.r.d - b.r.d).slice(0, ROWS);
  if (S.mode === 'live') D.wantRoutes(list.map(x => x.f.callsign));
  rowEls.forEach((re, i) => {
    const it = list[i];
    if (!it) { re.row.dataset.id = ''; COLS.forEach(c => setCell(re.cells[c.k], '', i)); return; }
    const { f, r } = it, rt = routeOf(f); re.row.dataset.id = f.id; re.row.classList.toggle('on', f.id === S.selId);
    setCell(re.cells.call, f.callsign, i); setCell(re.cells.type, f.type || '----', i); setCell(re.cells.route, rt ? `${rt.from.iata} ${rt.to.iata}` : '', i);
    setCell(re.cells.alt, boardAlt(f.alt), i); setCell(re.cells.dist, r.d < 10 ? r.d.toFixed(1) : String(Math.round(r.d)), i);
    setCell(re.cells.look, `${P16[pt16(r.brg)]} ${Math.max(0, Math.round(r.elev))}°`, i);
  });
  const src = $('boardSrc'); if (src) src.textContent = S.mode === 'live' ? 'Live · ' + S.provider : 'Simulated traffic';
}
function renderEvents() {
  const ul = $('events'); if (!ul) return;
  ul.innerHTML = S.events.length ? S.events.slice(0, 12).map(e => `<li><time>${e.t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time><span><i class="dot" style="--c:${EV_COL[e.k]}"></i>${esc(e.text)}</span></li>`).join('')
    : '<li><time></time><span>Landings, heavies, emergencies and overhead passes will show up here.</span></li>';
}

/* coming up */
function nextHTML() {
  const age = S.pred.at ? (Date.now() - S.pred.at) / 1000 : 0, left = t => Math.max(0, t - age), now = Date.now();
  const row = (id, time, title, text, cls = '') => `<li class="${cls}"${id ? ` data-id="${esc(id)}" role="button" tabindex="0"` : ''}><time>${time}</time><span><b>${esc(title)}</b>${esc(text)}</span></li>`;
  const over = S.pred.over.filter(x => left(x.t) > 0).slice(0, 8).map(x => row(x.f.id, mmss(left(x.t)), x.f.callsign + (x.f.type ? ' · ' + x.f.type : ''),
    `${x.d < 1 ? 'Right over you' : x.d.toFixed(1) + ' km ' + P16[pt16(x.brg)]}, ${Math.round(x.elev)}° up at ${fmtAlt(x.alt)}`));
  const tr = S.pred.tr.filter(x => left(x.t) > 0).slice(0, 6).map(x => row(x.f.id, mmss(left(x.t)), `${x.f.callsign} ${x.hit ? 'crosses' : 'near'} the ${x.body}`, transitText({ ...x, t: left(x.t) }), x.hit ? 'hot' : ''));
  const rare = S.pred.rare.slice(0, 8).map(x => row(x.f.id, x.r.d < IN_RANGE ? 'now' : x.f.next ? mmss(left(x.f.next.t)) : '', `${x.what} · ${x.f.callsign}`,
    `${Math.round(x.r.d)} km ${P16[pt16(x.r.brg)]} of you${x.f.next ? `, closest ${Math.round(x.f.next.d)} km` : ''}`, 'rare'));
  const sats = S.sats.passes.filter(p => p.end > now).slice(0, 6).map(p => row(null, hhmm(p.start), `${p.sat.name}${p.start < now ? ' · up now' : ''}`,
    `${Math.round((p.end - p.start) / 60000) || 1} min, rising ${P16L[pt16(p.startAz)]}, up to ${Math.round(p.max)}°, setting ${P16L[pt16(p.endAz)]}`, 'sat'));
  const lv = (S.weather?.levels || []).map(l => ({ l, c: contrailAt(isaKm(l.p), S.weather.levels) })).filter(x => x.c && x.c.state !== 'none');
  const ctr = !S.weather?.levels ? 'Waiting for upper-air weather.' : lv.length ? `Contrails likely from ${fl(isaKm(lv[0].l.p))} upward${lv.some(x => x.c.state === 'persistent') ? ', and they should linger and spread' : ', but they should fade quickly'}. Planes making one show a white trail in the 3D view.` : 'The air up high is too warm or dry for contrails right now. Planes will leave clean skies.';
  const sec = (h, list, empty) => `<div><p class="sec-h">${h}</p><ul class="events next-list">${list.length ? list.join('') : `<li><time></time><span>${empty}</span></li>`}</ul></div>`;
  return `${skyReport()}<div class="alert-row"><p class="lede">Squawk looks ahead at every aircraft near ${esc(settings.place.name.split(',')[0])}. Times firm up as planes get closer; turns can change them.</p>
    <button class="btn alert-btn" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2.5 2.5 0 0 0 2.4-2h-4.8a2.5 2.5 0 0 0 2.4 2zm7-6V11a7 7 0 0 0-5.5-6.8V3a1.5 1.5 0 0 0-3 0v1.2A7 7 0 0 0 5 11v5l-2 2v1h18v-1z"/></svg><span>Alert me</span></button></div>
  ${sec('Overhead soon', over, 'Nothing is heading right over you in the next 15 minutes.')}
  ${sec('Crossing the sun or moon', tr, S.pred.at ? 'No aircraft will cross the sun or moon near you in the next 10 minutes.' : 'Checking…')}
  ${sec('Rare and special', rare, 'No rare aircraft nearby right now. A380s, 747s, military flights and oddities show up here.')}
  ${sec('Satellites you can see', sats, !settings.sats ? 'Satellites are switched off in the layers menu.' : S.sats.ready ? 'No bright satellite passes in the next 24 hours. The ISS needs a dark sky with the station still in sunlight.' : 'Loading orbits…')}
  <div><p class="sec-h">Contrails</p><p class="lede">${ctr}</p></div>`;
}
// a short "your sky today" summary for newcomers: when to look, what's worth looking for
function skyReport() {
  const w = S.weather, now = new Date(), items = [], hour = localHour();
  if (w) {
    const s = spotScore(w); items.push(`<b>${s.lbl} spotting</b> right now (${s.score}/100). ${esc(s.why)}`);
    if (w.sunset) { const [h, m] = w.sunset.slice(11, 16).split(':').map(Number), t = h * 60 + m - 60; if (hour < h) items.push(`<b>Golden hour</b> from ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}, sunset ${w.sunset.slice(11, 16)}. Aircraft glow orange against the sky.`); }
  }
  const p = S.sats.passes.find(x => x.end > now);
  if (p) items.push(`<b>${esc(p.sat.name)}</b> ${p.start <= now ? 'is passing over right now' : 'passes at ' + hhmm(p.start)}: a bright, steady light crossing in about ${Math.max(1, Math.round((p.end - p.start) / 60000))} minutes, up to ${Math.round(p.max)}°.`);
  const mo = moonPosition(now, S.proj.lat0, S.proj.lon0);
  if (mo.alt > 5) items.push(`<b>The moon</b> is ${Math.round(mo.lit * 100)}% lit and ${Math.round(mo.alt)}° up in the ${P16L[pt16(mo.az)]}. Keep an eye on the Next tab for planes crossing it.`);
  const near = inRange().length; items.push(`<b>${near} aircraft</b> within ${IN_RANGE} km of you${S.pred.over.length ? `, ${S.pred.over.length} heading close overhead in the next 15 minutes` : ''}.`);
  return `<div class="tonight"><h3>${hour >= 16 || hour < 4 ? 'Your sky tonight' : 'Your sky today'}</h3><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul></div>`;
}
const isaKm = p => p > 226.32 ? (1 - Math.pow(p / 1013.25, 1 / 5.25588)) * 288.15 / 6.5 : 11 - Math.log(p / 226.32) * 6.34162;
const fl = km => 'FL' + String(Math.round(km * 32.8084 / 10) * 10).padStart(3, '0');

/* stats */
function statsHTML() {
  const arr = inRange().map(o => o.f);
  const climb = arr.filter(f => fpm(f) > 300).length, desc = arr.filter(f => fpm(f) < -300).length, cruise = arr.filter(f => f.alt > 7 && Math.abs(fpm(f)) <= 300).length;
  const bins = new Array(9).fill(0);
  for (const f of arr) bins[Math.min(8, Math.floor(f.alt * 3280.84 / 5000))]++;
  const bmax = Math.max(1, ...bins);
  const binLbl = ['0–5', '5–10', '10–15', '15–20', '20–25', '25–30', '30–35', '35–40', '40+'];
  const hist = bins.map((n, i) => { const c = hexOf(altColor((i * 5000 + 2500) / 3280.84, tmpC)); return `<div class="col" title="${n} aircraft at ${binLbl[i]}k ft"><span class="n">${n || ''}</span><div class="b" style="height:${n / bmax * 100}%;background:${c}"></div></div>`; }).join('');
  const al = new Map(); for (const f of arr) { const n = D.airlineName(f.callsign); if (n) al.set(n, (al.get(n) || 0) + 1); }
  const top = [...al.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8), amax = Math.max(1, ...top.map(t => t[1]));
  const cats = new Map([['Light', 0], ['Small', 0], ['Large', 0], ['Heavy', 0], ['Rotorcraft', 0], ['Unknown', 0]]);
  for (const f of arr) { const k = D.HEAVY.has(f.type) || f.cat === 'A5' ? 'Heavy' : f.cat === 'A7' || D.HELI.has(f.type) ? 'Rotorcraft' : f.cat === 'A1' ? 'Light' : f.cat === 'A2' ? 'Small' : f.cat === 'A3' || f.cat === 'A4' || (f.type && f.kind !== 'live') ? 'Large' : 'Unknown'; cats.set(k, cats.get(k) + 1); }
  const cmax = Math.max(1, ...cats.values());
  const bar = (name, n, m) => `<div class="hbar" title="${esc(name)}: ${n}"><span class="nm">${esc(name)}</span><span class="tr"><i style="width:${n / m * 100}%"></i></span><span class="c">${n}</span></div>`;
  const h = S.history, W = 400, H = 80;
  let spark = '<p class="lede">The traffic trend appears after a minute or so.</p>';
  if (h.length > 1) {
    const hm = Math.max(...h.map(p => p.n)), x = i => i / (h.length - 1) * W, y = n => H - 14 - n / Math.max(1, hm) * (H - 24);
    const pts = h.map((p, i) => `${x(i).toFixed(1)},${y(p.n).toFixed(1)}`).join(' ');
    spark = `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line class="gd" x1="0" x2="${W}" y1="${H - 14}" y2="${H - 14}"/><polygon class="ar" points="0,${H - 14} ${pts} ${W},${H - 14}"/><polyline class="ln" points="${pts}"/><text x="0" y="${H - 2}">${Math.round((Date.now() - h[0].t) / 60000)} min ago</text><text x="${W}" y="${H - 2}" text-anchor="end">now · ${h[h.length - 1].n}</text></svg>`;
  }
  const R = S.rec, rt = (k, lbl, fmt) => `<div class="tile"><p class="k">${lbl}</p><p class="v">${R[k] ? fmt(R[k].v) : '—'}</p><p class="s">${R[k] ? esc(R[k].cs) : '&nbsp;'}</p></div>`;
  return `<div class="tiles4"><div class="tile"><p class="k">In range</p><p class="v">${arr.length}</p></div><div class="tile"><p class="k">Climbing</p><p class="v">${climb}</p></div><div class="tile"><p class="k">Descending</p><p class="v">${desc}</p></div><div class="tile"><p class="k">Cruising</p><p class="v">${cruise}</p></div></div>
  <div><p class="sec-h">Altitude, thousands of feet</p><div class="hist">${hist}</div><div class="hist-x">${binLbl.map(l => `<span>${l}</span>`).join('')}</div></div>
  <div><p class="sec-h">Traffic in range</p>${spark}</div>
  <div><p class="sec-h">Top airlines overhead</p><div class="hbars">${top.length ? top.map(([n, c]) => bar(n, c, amax)).join('') : '<p class="lede">No airline callsigns in range yet.</p>'}</div></div>
  <div><p class="sec-h">Aircraft size</p><div class="hbars">${[...cats.entries()].filter(([, n]) => n).map(([n, c]) => bar(n, c, cmax)).join('')}</div></div>
  <div><p class="sec-h">Records this session</p><div class="records">${rt('fast', 'Fastest', v => v + ' kt')}${rt('high', 'Highest', v => fmtAlt(v))}${rt('far', 'Farthest seen', v => Math.round(v) + ' km')}${rt('near', 'Closest pass', v => v.toFixed(1) + ' km')}</div></div>`;
}
// altitude history for the flight card's profile: every 10 s, for aircraft near home and the one you've selected
let histT = 0;
function tickHistory() {
  const now = Date.now(); if (now - histT < 10000) return; histT = now;
  for (const f of S.flights.values()) {
    if (f.id !== S.selId && (Math.abs(f.lat - S.proj.lat0) > 6 || dLon(f.lon, S.proj.lon0) > 9)) continue;
    (f.hist || (f.hist = [])).push([now, f.alt]); if (f.hist.length > 60) f.hist.shift();
  }
}
function tickRecords() {
  const R = S.rec; tickHistory();
  for (const f of S.flights.values()) {
    const r = rel(f); if (r.d > IN_RANGE) continue;
    if (!f.caught) catchFlight(f);
    const k = kt(f);
    if (!R.fast || k > R.fast.v) R.fast = { v: k, cs: f.callsign };
    if (!R.high || f.alt > R.high.v) R.high = { v: f.alt, cs: f.callsign };
    if (!R.far || r.d > R.far.v) R.far = { v: r.d, cs: f.callsign };
    if (!R.near || r.slant < R.near.v) R.near = { v: r.slant, cs: f.callsign };
    if (k > 600) award('fast'); if (f.alt > 13.7) award('high');
    if (r.d < 2 && f.alt < 3) award('over');
    if (r.d < 5 && !f.overM) { f.overM = true; S.quiet = f.quiet; mission({ over: true }); S.quiet = false; }
  }
}

/* weather */
const hm = s => s ? s.slice(11, 16) : '—';
function windSVG(dir) { const a = (dir ?? 0) + 180; return `<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" class="dial"/><g transform="rotate(${a} 30 30)"><path class="arrow" d="M30 8l7 14h-5v24h-4V22h-5z"/></g></svg>`; }
function spotScore(w) {
  const code = w.weather_code ?? 0, low = w.cloud_cover_low ?? 0, vis = w.visibility != null ? w.visibility / 1000 : null;
  let score = 100 - low * 0.55 - (w.cloud_cover_mid ?? 0) * 0.15;
  if (vis != null && vis < 10) score -= (10 - vis) * 5;
  if (code >= 51) score -= 25; if (code >= 95) score -= 30; if (code === 45 || code === 48) score -= 35;
  if (world.day < 0.4) score -= 15;
  score = Math.round(clamp(score, 0, 100));
  const [lbl, col, why] = score >= 75 ? ['Excellent', '#16A34A', 'Clear views; you should see aircraft well above you.'] : score >= 55 ? ['Good', '#65A30D', 'Some cloud, but plenty of gaps to catch aircraft.'] : score >= 35 ? ['Fair', '#D97706', 'Low cloud will hide higher traffic. Low arrivals are still visible.'] : ['Poor', '#DC2626', 'Cloud, rain or haze will hide most aircraft. Try the 3D view instead.'];
  return { score, lbl, col, why, vis, code };
}
function weatherHTML() {
  const w = S.weather;
  if (!w) return '<p class="lede">Loading the weather for this spot. If it doesn\'t appear, the weather service may be unreachable from here.</p>';
  const { score, lbl, col, why, vis, code } = spotScore(w);
  const layer = (n, v) => `<div class="hbar"><span class="nm">${n}</span><span class="tr"><i style="width:${v ?? 0}%;background:var(--high)"></i></span><span class="c">${v ?? '–'}%</span></div>`;
  const dirTxt = d => d == null ? '' : 'from ' + P16[pt16(d)];
  const sunAlt = world.sun ? Math.round(world.sun.alt) : null;
  const golden = w.sunset ? (() => { const [h, m] = w.sunset.slice(11, 16).split(':').map(Number); const t = h * 60 + m - 60; return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); })() : '—';
  return `<div class="wx-hero"><div><div class="temp">${Math.round(w.temperature_2m ?? 0)}°</div><p class="cond">${esc(D.WMO[code] || 'Current conditions')}</p></div><p class="lede" style="text-align:right">${esc(settings.place.name)}<br>Visibility ${vis != null ? (vis >= 10 ? vis.toFixed(0) : vis.toFixed(1)) + ' km' : '—'}</p></div>
  <div class="score" style="background:${col}"><div class="n">${score}</div><p><b>${lbl} for spotting</b>${why}</p></div>
  <div><p class="sec-h">Cloud layers</p><div class="hbars">${layer('High, above 6 km', w.cloud_cover_high)}${layer('Mid, 2–6 km', w.cloud_cover_mid)}${layer('Low, below 2 km', w.cloud_cover_low)}</div></div>
  <div><p class="sec-h">Wind</p><div class="winds">
    <div class="wind">${windSVG(w.wind_direction_10m)}<p><b>${Math.round(w.wind_speed_10m ?? 0)} km/h</b>At ground level, ${dirTxt(w.wind_direction_10m)}</p></div>
    <div class="wind">${windSVG(w.jet?.dir)}<p><b>${w.jet?.speed != null ? Math.round(w.jet.speed) + ' km/h' : '—'}</b>Jet stream, about FL340, ${dirTxt(w.jet?.dir)}</p></div></div>
    <p class="lede" style="margin-top:8px">Aircraft land and take off into the wind, so the ground wind decides which way arrivals line up. A strong westerly jet stream is why eastbound flights across the Atlantic are faster.</p></div>
  ${w.levels ? `<div><p class="sec-h">Contrails by height</p><div class="ctr-grid">${w.levels.slice().reverse().map(l => { const c = contrailAt(isaKm(l.p), w.levels); return c ? `<div class="ctr ${c.state}"><b>${fl(isaKm(l.p))}</b><span>${c.state === 'persistent' ? 'Lasting' : c.state === 'short' ? 'Short' : 'None'}</span><small>${Math.round(l.T)}°C · ${Math.round(c.rhi * 100)}% ice RH</small></div>` : ''; }).join('')}</div>
    <p class="lede" style="margin-top:8px">A jet leaves a contrail when the air is cold enough for its exhaust to condense. If the air is also saturated with respect to ice, the trail lingers and spreads into cirrus.</p></div>` : ''}
  <div><p class="sec-h">Sun</p><div class="sunrow"><div class="tile"><p class="k">Sunrise</p><p class="v">${hm(w.sunrise)}</p></div><div class="tile"><p class="k">Golden hour</p><p class="v">${golden}</p></div><div class="tile"><p class="k">Sunset</p><p class="v">${hm(w.sunset)}</p></div></div>
  <p class="lede" style="margin-top:8px">The sun is ${sunAlt != null ? (sunAlt >= 0 ? sunAlt + '° above' : -sunAlt + '° below') : '—'} the horizon right now. The sky and lighting in the 3D view follow its real position, and the clouds follow the live cloud cover.</p></div>`;
}

/* log */
const FLAME = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2s1 3.2-1.4 6.3C10 11 8 12.2 8 15.5a4 4 0 0 0 8 0c0-1.6-.8-2.8-.8-2.8s2.8 1.2 2.8 4.3A6 6 0 0 1 6 17c0-5.3 5-7.2 5-11.3 0 0 2.5 1.2 2.5-3.7z"/></svg>';
function logHTML() {
  const lg = theLog(), types = Object.entries(lg.types).sort((a, b) => b[1].first - a[1].first);
  const got = BADGES.filter(b => lg.badges[b.id]).length, L = levelOf(lg.xp || 0), st = streak(lg.days || []);
  const day = lg.day && lg.day.date === today() ? lg.day : { done: {} };
  const miss = missionsFor(today()).map(m => `<li class="${day.done[m.id] ? 'done' : ''}"><span class="chk"></span>${esc(m.text)}<small>+${XP.mission} XP</small></li>`).join('');
  // collection: one card per family, locked until you've caught one
  const byFam = new Map(); for (const [c, t] of types) { const f = familyOf(c); if (f) { const e = byFam.get(f.id) || { n: 0, seen: 0 }; e.n += t.n; e.seen += (lg.seenTypes || {})[c] || 0; byFam.set(f.id, e); } }
  const cards = FAMILIES.map(f => { const e = byFam.get(f.id); return e ? `<div class="cc">${silhouette(f.m)}<span class="n">×${e.n}</span>${e.seen ? `<span class="eye">seen ${e.seen}</span>` : ''}<b>${esc(f.name)}</b><small>${esc(f.fact)}</small></div>`
    : `<div class="cc locked">${silhouette(f.m)}<b>${esc(f.name)}</b><small>Not caught yet</small></div>`; }).join('');
  return `${S.mode !== 'live' ? `<p class="note">You're watching simulated traffic, so these catches last only for this visit. Catches from the live feed are saved ${acct ? 'to your account' : 'in this browser'}.</p>` : ''}
  ${cloudOn && !acct ? '<p class="note">Your log is kept in this browser only. <button class="link" id="logSignIn" type="button">Sign in</button> to keep it in your own account on every device.</p>' : ''}
  <div class="lvl-card"><div class="lvl-n">${L.n}</div><div><b>${esc(L.name)}</b><div class="xpbar"><i style="width:${Math.round(L.pct * 100)}%"></i></div><small>${L.xp.toLocaleString('en')} XP${L.to ? ` · ${(L.to - L.xp).toLocaleString('en')} to level ${L.n + 1}` : ' · top level'}</small></div><div class="streak">${FLAME}${st}<small>day streak</small></div></div>
  <div><p class="sec-h">Today's missions</p><ul class="missions">${miss}</ul></div>
  <div class="tiles4"><div class="tile"><p class="k">Types</p><p class="v">${types.length}</p></div><div class="tile"><p class="k">Airlines</p><p class="v">${Object.keys(lg.airlines).length}</p></div><div class="tile"><p class="k">Seen by eye</p><p class="v">${lg.seen || 0}</p></div><div class="tile"><p class="k">Badges</p><p class="v">${got}/${BADGES.length}</p></div></div>
  <div><p class="sec-h">Collection · ${byFam.size} of ${FAMILIES.length} families</p><div class="coll">${cards}</div></div>
  <div><p class="sec-h">Badges</p><div class="badges">${BADGES.map(b => `<div class="bdg${lg.badges[b.id] ? ' got' : ''}"><span class="ic">${ICON_STAR}</span><b>${esc(b.name)}</b><span>${esc(b.desc)}</span></div>`).join('')}</div></div>
  <div><p class="sec-h">Aircraft types caught</p><div class="types">${types.map(([c, t]) => `<div class="ty${D.HEAVY.has(c) ? ' heavy' : ''}"><span class="ct">×${t.n}</span><span class="code">${esc(c)}</span><span class="nm">${esc(D.TYPES[c] || c)}</span><span class="nm">${esc(t.al.slice(0, 2).join(' · '))}</span></div>`).join('') || '<p class="lede">Nothing caught yet.</p>'}</div></div>
  <div><p class="sec-h">How you earn XP</p><p class="lede">Aircraft that come within ${IN_RANGE} km count as caught: +${XP.catch} each, +${XP.type} for a new type, +${XP.airline} for a new airline. Seeing one with your own eyes and tapping "I saw it!" is worth +${XP.seen}, and +${XP.seenType} more for a type you've never seen. Badges give +${XP.badge} and daily missions +${XP.mission}.</p>
  <button class="btn share-btn" id="shareBtn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7l-6.7 3.4a3 3 0 1 0 0 3.2L15 17a3 3 0 1 0 3-1z"/></svg>Share my progress</button></div>`;
}
async function shareLog() {
  const lg = theLog(), L = levelOf(lg.xp || 0);
  const text = `I'm a level ${L.n} ${L.name} on Squawk: ${Object.keys(lg.types).length} aircraft types, ${Object.keys(lg.airlines).length} airlines, ${lg.seen || 0} seen with my own eyes and a ${streak(lg.days || [])}-day streak.`;
  try { if (navigator.share) await navigator.share({ title: 'My Squawk log', text, url: location.origin }); else { await navigator.clipboard.writeText(text + ' ' + location.origin); flash('Copied to your clipboard'); } } catch (e) { /* share cancelled */ }
}
function codesHTML() {
  return `<p class="lede">Every transponder broadcasts a four-digit code set by air traffic control. A few are reserved, and Squawk turns any aircraft using an emergency code red.</p>
  <div class="codes">
    <div class="code alert"><div class="n">7700</div><b>General emergency</b><p>Engine trouble, a medical case, anything needing priority.</p></div>
    <div class="code alert"><div class="n">7600</div><b>Radio failure</b><p>The crew can't talk to ATC and follow lost-comms procedures.</p></div>
    <div class="code alert"><div class="n">7500</div><b>Unlawful interference</b><p>Reserved for hijack. You should never see it.</p></div>
    <div class="code"><div class="n">7000</div><b>VFR conspicuity</b><p>Light aircraft flying visually in Europe without an assigned code.</p></div>
    <div class="code"><div class="n">2000</div><b>Entering controlled airspace</b><p>Arrivals from oceanic airspace before ATC assigns a code.</p></div>
    <div class="code"><div class="n">1200</div><b>US VFR</b><p>The North American equivalent of 7000.</p></div>
  </div>
  <div class="prose"><p class="sec-h">Reading the 3D view</p>
    <p><b>Colour is altitude.</b> Amber is low (arrivals and departures), pink is mid-level, and blue is cruise height.</p>
    <p><b>Height is exaggerated 2.2×</b> in Orbit and Map views so climbs and descents read clearly. Ground view uses true angles, so it matches what you see outside.</p>
    <p><b>The ground curves.</b> Aircraft 150 km away sit below the horizon line, just like in reality.</p>
    <p><b>It's a whole planet.</b> Zoom out (or tap Globe) to see live traffic across continents. The night side of the earth follows the real sun and lights up with cities. Press H or tap ⌖ to fly back home.</p>
    <p class="sec-h">Data</p>
    <p>Aircraft positions come from the community-run ADS-B networks <a href="https://adsb.lol" target="_blank" rel="noopener">ADSB.lol</a>, <a href="https://airplanes.live" target="_blank" rel="noopener">airplanes.live</a> and <a href="https://adsb.fi" target="_blank" rel="noopener">adsb.fi</a>. Routes come from <a href="https://www.adsbdb.com" target="_blank" rel="noopener">adsbdb.com</a>, photos from <a href="https://www.planespotters.net" target="_blank" rel="noopener">Planespotters.net</a>, weather from <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>, and place search from <a href="https://nominatim.openstreetmap.org" target="_blank" rel="noopener">OpenStreetMap Nominatim</a>. ${esc(TILE_STYLES[settings.style].credit)}. For spotting fun only, not for navigation.</p></div>`;
}

/* ---------------- HUD ---------------- */
// aircraft within IN_RANGE of home, refreshed with the HUD
let nearCache = [], nearT = 0;
function inRange() {
  if (performance.now() - nearT > 400) { nearT = performance.now(); nearCache = []; for (const f of S.flights.values()) { const r = rel(f); if (r.d <= IN_RANGE) nearCache.push({ f, r }); } }
  return nearCache;
}
function updateExplore() {
  const d = world.homeDist(), away = S.view !== 'ground' && (d > 40 || world.cam.r > 2500) && !(world.fly && world.fly.b.r === HOME_R && haversine(world.fly.b.lat, world.fly.b.lon, S.proj.lat0, S.proj.lon0) < 1);
  $('recenterBtn').hidden = !away;
  if (away) $('recenterBtn').title = `${$('recenterBtn').dataset.tip} · ${d < 40 ? 'zoomed out' : Math.round(d).toLocaleString('en') + ' km away'} (H)`;
  paintView();
}
// the next plane to pass within a few km of you, counting down
function updateNext() {
  const age = S.pred.at ? (Date.now() - S.pred.at) / 1000 : 0, x = S.pred.over.find(o => o.t - age > 0);
  $('rNextBox').dataset.id = x ? x.f.id : ''; $('rNextBox').hidden = !x;
  $('rNext').textContent = x ? mmss(x.t - age) : '—';
  $('rNextS').textContent = x ? `${x.f.callsign} · ${x.d < 1 ? 'right overhead' : Math.round(x.elev) + '° ' + P16[pt16(x.brg)]}` : '';
  $('rNextBox').classList.toggle('soon', !!x && x.t - age < 60);
}
$('rNextBox').onclick = () => { const id = $('rNextBox').dataset.id; if (id && S.flights.has(id)) { select(id); setFollow(true); } };
function updateHUD() {
  updateExplore(); updateNext();
  const near = inRange(), arr = near.map(o => o.f);
  $('rCount').textContent = arr.length;
  if (!arr.length) { $('rHigh').textContent = $('rNear').textContent = '—'; $('rHighS').innerHTML = $('rNearS').innerHTML = '&nbsp;'; $('toast').hidden = true; return; }
  const hi = arr.reduce((a, b) => (b.alt > a.alt ? b : a)); $('rHigh').textContent = fmtAlt(hi.alt).replace(' ft', ''); $('rHighS').textContent = hi.callsign;
  let nf = null, nr = null; for (const { f, r } of near) if (!nr || r.slant < nr.slant) { nf = f; nr = r; }
  $('rNear').textContent = (nr.slant < 10 ? nr.slant.toFixed(1) : Math.round(nr.slant)) + ' km'; $('rNearS').textContent = `${nf.callsign} · look ${P16[pt16(nr.brg)]}`;
  const over = near.filter(o => o.r.d < 5 && o.f.alt < 6).sort((a, b) => a.r.d - b.r.d)[0];
  if (over && S.mode === 'live') {
    $('toast').hidden = false;
    $('toastText').textContent = `${over.f.callsign} is ${over.r.d.toFixed(1)} km away at ${fmtAlt(over.f.alt)}, ${Math.round(over.r.elev)}° up to the ${P16L[pt16(over.r.brg)]}.`;
    if (!over.f.seenOver) { over.f.seenOver = true; pushEvent('over', `${over.f.callsign} passed near you at ${fmtAlt(over.f.alt)}`); }
  } else $('toast').hidden = true;
}

// one-time tip on how to move around the globe
function showHint() {
  if (store.get('squawk.hint', false)) return;
  const touch = matchMedia('(pointer: coarse)').matches, el = $('hint');
  el.textContent = touch ? 'Drag to orbit · Pinch to zoom · Two fingers to move and turn · Zoom out and drag to spin the globe' : 'Drag to orbit · Right-drag to move · Scroll to zoom · Zoom out and drag to spin the globe · H to come home';
  setTimeout(() => { el.hidden = false; setTimeout(() => { el.hidden = true; }, 7000); }, 4500);
  store.set('squawk.hint', true);
}

/* ---------------- loop ---------------- */
let acc = { hud: 0, card: 0, board: 2.5, panel: 0, rec: 0, hist: 15, pred: 1.5, next: 0 };
const loader = $('loader'); let loaderDone = false; const bootT = performance.now();
function frame() {
  requestAnimationFrame(frame);
  tick(Math.min(world.clock.getDelta(), 0.1));
}
function tick(dt) {
  const t = world.clock.elapsedTime;
  if (S.mode === 'sim') simStep(dt); else if (S.mode === 'live') reckon(dt);
  if (ar.on) { tickSats(); updateAR(); } // the 3D view is covered: skip drawing it
  else {
    const arr = [...S.flights.values()];
    world.syncAircraft(arr, dt, t, S.selId);
    const fp = S.follow && S.selId ? world.vis.get(S.selId)?.pos : null;
    tickSats(); world.syncSats(S.sats.list, satT ? (Date.now() - satT) / 1000 : 0, settings.sats && S.sats.ready);
    world.frame(dt, t, fp || null);
    updateLabels(arr);
    if (S.selId && sense.live) { const f = S.flights.get(S.selId); if (f) paintCompass(rel(f)); }
  }
  if ((acc.pred += dt) > 2) { acc.pred = 0; if (S.mode !== 'boot') predictAll(); }
  if (S.tab === 'next' && (acc.next += dt) > 1) { acc.next = 0; renderPanel(false); }
  if ((acc.hud += dt) > 0.5) { acc.hud = 0; updateHUD(); }
  if ((acc.card += dt) > 0.3) { acc.card = 0; if (S.selId) updateCard(); }
  if ((acc.rec += dt) > 1) { acc.rec = 0; tickRecords(); followView(); coachTick(); }
  if ((acc.hist += dt) > 20) { acc.hist = 0; if (S.mode !== 'boot') { S.history.push({ t: Date.now(), n: inRange().length }); if (S.history.length > 90) S.history.shift(); } }
  if (S.tab === 'board' && (acc.board += dt) > 3) { acc.board = 0; updateBoard(); }
  if ((S.tab === 'stats' || S.tab === 'log') && (acc.panel += dt) > 3) { acc.panel = 0; renderPanel(false); }
  if (!loaderDone) {
    const p = world.tileProgress(), k = p.total ? p.done / p.total : 0;
    $('loadArc').style.strokeDashoffset = String(1 - Math.max(0.03, Math.min(1, k * 0.8 + (S.feedResolved ? 0.2 : 0))));
    $('loadMsg').textContent = S.feedResolved ? 'Loading the ground' : 'Tuning to 1090 MHz';
    if ((k > 0.7 && S.feedResolved) || performance.now() - bootT > 7000) { loaderDone = true; loader.classList.add('done'); world.intro(); showHint(); if (welcomeDue && !settings.placeSrc) $('welcome').hidden = false; setTimeout(startSats, 1500); }
  }
}

// console hooks for debugging; step(n) runs n frames by hand, which also works while the tab is in the background
window.__squawk = { world, S, ingest: list => { if (S.mode !== 'live') { clearFlights(); S.mode = 'live'; } ingest(list); },
  step: (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) { world.clock.elapsedTime += dt; tick(dt); } } };
$('timeR').value = 0;
paintLevel();
setPlace(settings.placeSrc ? settings.place : tzGuess() || settings.place, true);
bootLocate();
requestAnimationFrame(frame);
