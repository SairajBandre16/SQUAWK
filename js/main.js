import * as THREE from 'three';
import { World, RINGS, altColor, TILE_STYLES } from './world.js';
import * as D from './data.js';
import { Sim } from './sim.js';
import { Proj, relative, P16, P16L, pt16, clamp, haversine, curvDrop } from './geo.js';

const $ = id => document.getElementById(id);
const RANGE = 190, FEED_NM = 100, POLL_MS = 5000;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};
const settings = Object.assign({ place: D.PLACES[0], style: 'satellite', clouds: true, labels: 'nearby' }, store.get('squawk.settings', {}));
const saveSettings = () => store.set('squawk.settings', settings);
const S = { flights: new Map(), mode: 'boot', provider: '', selId: null, follow: false, tab: 'sky', view: 'orbit', weather: null, timeOff: 0,
  events: [], history: [], rec: {}, booting: false, proj: null, sim: null };
const hexOf = c => '#' + c.getHexString();
const tmpC = new THREE.Color();
const fmtAlt = km => { const ft = km * 3280.84; return ft >= 5000 ? 'FL' + String(Math.round(ft / 100)).padStart(3, '0') : (Math.round(ft / 100) * 100).toLocaleString('en') + ' ft'; };
const boardAlt = km => { const ft = km * 3280.84; return ft >= 5000 ? 'FL' + String(Math.round(ft / 100)).padStart(3, '0') : String(Math.round(ft / 100) * 100); };
const kt = f => Math.round(f.spd * 1943.84);
const fpm = f => Math.round(f.vr * 196850 / 50) * 50;
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
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
const newLog = () => ({ types: {}, airlines: {}, badges: {}, tracked: 0, since: Date.now() });
const logLive = Object.assign(newLog(), store.get(LOGKEY, {}));
const logSim = newLog();
const theLog = () => (S.mode === 'live' ? logLive : logSim);
let saveT = null;
const saveLog = () => { clearTimeout(saveT); saveT = setTimeout(() => store.set(LOGKEY, logLive), 1500); };
const ICON_STAR = '<svg viewBox="0 0 24 24"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z"/></svg>';
const BADGES = [
  { id: 'first', name: 'First contact', desc: 'Track your first aircraft' },
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
  if (S.booting) return;
  const b = BADGES.find(x => x.id === id); const el = $('badgeToast');
  el.innerHTML = `<span class="star">${ICON_STAR}</span><span>Badge unlocked: <b>${esc(b.name)}</b></span>`; el.hidden = false;
  clearTimeout(award.t); award.t = setTimeout(() => { el.hidden = true; }, 4200);
  pushEvent('badge', `Badge unlocked: ${b.name}`);
}
function localHour() { const off = S.weather?.utcOffset; const d = new Date(Date.now() + S.timeOff * 3600e3); return off != null ? new Date(d.getTime() + off * 1000).getUTCHours() : d.getHours(); }
function logCatch(f) {
  const lg = theLog(); lg.tracked++;
  if (f.type) { const t = lg.types[f.type] || (lg.types[f.type] = { n: 0, first: Date.now(), al: [] }); t.n++; const an = D.airlineName(f.callsign); if (an && !t.al.includes(an) && t.al.length < 5) t.al.push(an); }
  const ac = D.airlineCode(f.callsign); if (ac) lg.airlines[ac] = (lg.airlines[ac] || 0) + 1;
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

/* ---------------- events ---------------- */
const EV_COL = { land: 'var(--low)', heavy: 'var(--mid)', over: '#22C55E', emg: 'var(--emg)', badge: 'var(--accent)', info: 'var(--high)' };
function pushEvent(k, text) {
  S.events.unshift({ k, text, t: new Date() }); if (S.events.length > 30) S.events.length = 30;
  if (S.tab === 'board') renderEvents();
}

/* ---------------- flights ---------------- */
function addFlight(f) {
  f.id = f.id || f.hex; f.phase = Math.random() * 3; f.emg = D.isEmergency(f);
  S.flights.set(f.id, f); logCatch(f);
  if (!S.booting) {
    if (D.HEAVY.has(f.type)) pushEvent('heavy', `${f.callsign}, a ${D.typeName(f)}, is in range at ${fmtAlt(f.alt)}`);
    if (f.emg) emergency(f);
  }
}
function emergency(f) { pushEvent('emg', `${f.callsign} is squawking ${f.squawk}`); if (f.squawk === '7700') award('mayday'); }
function removeFlight(id) { S.flights.delete(id); if (S.selId === id) select(null); }
function clearFlights() { S.flights.clear(); world.resetAircraft(); select(null); }

function ingest(list) {
  const now = performance.now() / 1000;
  for (const a of list) {
    if (a.lat == null || a.lon == null || a.alt_baro === 'ground') continue;
    const ft = typeof a.alt_baro === 'number' ? a.alt_baro : (typeof a.alt_geom === 'number' ? a.alt_geom : null);
    if (ft == null) continue;
    const p = S.proj.toXZ(a.lat, a.lon); if (Math.hypot(p.x, p.z) > RANGE) continue;
    const id = 'h' + a.hex, cs = (a.flight || '').trim();
    const d = { hex: a.hex, x: p.x, z: p.z, lat: a.lat, lon: a.lon, alt: Math.max(0, ft * 0.0003048), spd: (a.gs || 0) * 0.000514444,
      vr: (a.baro_rate ?? a.geom_rate ?? 0) * 0.00000508, squawk: a.squawk || '', type: a.t || '', desc: a.desc || '', reg: a.r || '',
      cat: a.category || '', callsign: cs || a.r || String(a.hex).toUpperCase(), lastFix: now, kind: 'live' };
    const trk = a.track ?? a.true_heading ?? a.mag_heading;
    const f = S.flights.get(id);
    if (!f) addFlight({ id, trk: trk ?? 0, turn: 0, ...d });
    else { const was = f.emg; Object.assign(f, d); if (trk != null) f.trk = trk; f.emg = D.isEmergency(f); if (f.emg && !was) emergency(f); }
  }
  for (const [id, f] of S.flights) if (now - f.lastFix > 40) removeFlight(id);
}
function reckon(dt) {
  const now = performance.now() / 1000;
  for (const f of S.flights.values()) {
    if (now - f.lastFix > 20) continue;
    f.x += f.spd * Math.sin(f.trk * Math.PI / 180) * dt; f.z -= f.spd * Math.cos(f.trk * Math.PI / 180) * dt; f.alt = Math.max(0, f.alt + f.vr * dt);
  }
}
function simStep(dt) {
  const r = S.sim.step(S.flights, dt);
  for (const f of r.landed) if (!S.booting) pushEvent('land', `${f.callsign} touched down at ${S.sim.ap.name}`);
  for (const id of r.gone) removeFlight(id);
  for (const f of r.spawned) { addFlight(f); if (f.emg && !S.booting) emergency(f); }
}

/* ---------------- feed ---------------- */
let feedGen = 0, pollT = null, fails = 0, routeT = 0;
function setFeed(mode, label) { $('feedChip').dataset.mode = mode; $('feedLabel').textContent = label; }
function startSim() {
  clearFlights(); S.mode = 'sim'; S.booting = true;
  for (const f of S.sim.initial()) addFlight(f);
  for (let i = 0; i < 30; i++) simStep(1);
  S.booting = false; setFeed('sim', 'Simulated sky');
}
async function poll(gen, first) {
  if (gen !== feedGen) return;
  try {
    const { list, provider } = await D.fetchAircraft(S.proj.lat0, S.proj.lon0, FEED_NM);
    if (gen !== feedGen) return;
    if (S.mode !== 'live') { clearFlights(); S.mode = 'live'; S.booting = true; ingest(list); S.booting = false; }
    else ingest(list);
    S.provider = provider; fails = 0; setFeed('live', 'Live · ' + provider);
    if (performance.now() - routeT > 20000) { routeT = performance.now(); D.fetchRoutes([...S.flights.values()]); }
    pollT = setTimeout(() => poll(gen), POLL_MS);
  } catch (e) {
    if (gen !== feedGen) return;
    fails++;
    if (S.mode !== 'sim' && (first || fails >= 3)) startSim();
    pollT = setTimeout(() => poll(gen), S.mode === 'sim' ? 60000 : POLL_MS);
  }
  S.feedResolved = true;
}
function restartFeed() { feedGen++; clearTimeout(pollT); S.mode = 'boot'; S.feedResolved = false; setFeed('boot', 'Connecting'); poll(feedGen, true); }

/* ---------------- place ---------------- */
function setPlace(p) {
  settings.place = { name: p.name, lat: p.lat, lon: p.lon }; saveSettings();
  S.proj = new Proj(p.lat, p.lon); $('placeName').textContent = p.name;
  world.loadTiles(S.proj, settings.style); world.setAirports(D.AIRPORTS, S.proj);
  clearFlights(); world.cam.target.set(0, 2, 0); S.follow = false;
  S.sim = new Sim(S.proj); S.history = []; S.rec = {};
  buildPlaceLabels(); S.weather = null; loadWeather(); updateSun();
  restartFeed();
  if (S.tab !== 'sky') renderPanel(true);
}
async function loadWeather() {
  const at = S.proj;
  try { const w = await D.fetchWeather(at.lat0, at.lon0); if (at !== S.proj) return; S.weather = w; world.setWeather(w); }
  catch (e) { world.setWeather(null); }
  if (S.tab === 'weather') renderPanel(true);
  updateSun();
}
setInterval(() => S.proj && loadWeather(), 15 * 60e3);

function updateSun() {
  if (!S.proj) return;
  const d = new Date(Date.now() + S.timeOff * 3600e3);
  world.setSun(d, S.proj.lat0, S.proj.lon0);
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
  const cam = world.camera.position, cand = [];
  for (const f of arr) { const v = world.vis.get(f.id); if (v) cand.push([f, v, v.pos.distanceToSquared(cam)]); }
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
    const key = f.callsign + fmtAlt(f.alt) + f.emg + isSel + (f.vr > 0.001 ? 1 : f.vr < -0.001 ? 2 : 0);
    if (el._key !== key) {
      el._key = key; el.firstChild.textContent = f.callsign;
      el.lastChild.textContent = f.emg ? 'SQUAWK ' + f.squawk : `${fmtAlt(f.alt)} ${f.vr > 0.001 ? '↑' : f.vr < -0.001 ? '↓' : ''}  ${f.type || ''}`;
      el.classList.toggle('sel', isSel); el.classList.toggle('emg', f.emg);
      el.style.setProperty('--c', hexOf(v.col));
    }
    el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`; el.hidden = false;
  }
  for (let i = n; i < pool.length; i++) if (!pool[i].hidden) pool[i].hidden = true;
  for (const p of placeLbls) {
    world.project(p.pos, P);
    const show = P.vis && !(p.cls === 'ring' && S.view === 'ground');
    p.el.hidden = !show; if (show) p.el.style.transform = `translate(${P.x.toFixed(1)}px,${P.y.toFixed(1)}px) translate(-50%,-50%)`;
  }
}

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
const routeOf = f => f.route !== undefined && f.kind !== 'live' ? f.route : D.getRoute(f.callsign);
function updateCard() {
  const f = S.flights.get(S.selId); if (!f) return;
  const r = relative(f);
  $('cAirline').textContent = D.airlineName(f.callsign) || (f.kind === 'live' ? 'Operator unknown' : '');
  $('cCall').textContent = f.callsign; $('cType').textContent = D.typeName(f);
  $('cHeavy').hidden = !D.HEAVY.has(f.type);
  const sq = $('cSq'); sq.textContent = 'Squawk ' + (f.squawk || '----'); sq.className = 'pill' + (f.emg ? ' emg' : '');
  const rt = routeOf(f);
  $('cRoute').hidden = !rt;
  if (rt) {
    $('cFrom').textContent = rt.from.iata; $('cFromN').textContent = rt.from.name || ''; $('cTo').textContent = rt.to.iata; $('cToN').textContent = rt.to.name || '';
    let prog = 50;
    if (rt.from.lat != null && rt.to.lat != null && f.lat != null) { const a = haversine(rt.from.lat, rt.from.lon, f.lat, f.lon), b = haversine(f.lat, f.lon, rt.to.lat, rt.to.lon); prog = clamp(a / (a + b) * 100, 2, 98); }
    else if (f.kind === 'arr') prog = clamp(100 - f.d, 60, 98); else if (f.kind === 'dep') prog = clamp(f.flown / 30, 2, 40);
    $('cProg').style.width = prog + '%'; $('cPlaneIco').style.left = prog + '%';
  }
  const p = pt16(r.brg);
  $('cLook').textContent = r.elev < 0.5 ? `${cap(P16L[p])}, below your horizon` : `${cap(P16L[p])}, ${Math.round(r.elev)}° up`;
  $('cDist').textContent = `${r.d < 10 ? r.d.toFixed(1) : Math.round(r.d)} km away · bearing ${String(Math.round(r.brg)).padStart(3, '0')}°`;
  $('cAlt').textContent = `${fmtAlt(f.alt)} · ${Math.round(f.alt * 1000).toLocaleString('en')} m`;
  $('cSpd').textContent = `${kt(f)} kt · ${Math.round(f.spd * 3600)} km/h`;
  $('cTrk').textContent = String(Math.round(f.trk)).padStart(3, '0') + '° ' + P16[pt16(f.trk)];
  const v = fpm(f); $('cVs').textContent = Math.abs(v) < 100 ? 'Level' : (v > 0 ? '+' : '−') + Math.abs(v).toLocaleString('en') + ' ft/min';
  $('cReg').textContent = f.reg || '—'; $('cPhase').textContent = phase(f);
  const rr = 52 * (1 - clamp(r.elev, 0, 90) / 90), x = 60 + Math.sin(r.brg * Math.PI / 180) * rr, y = 60 - Math.cos(r.brg * Math.PI / 180) * rr;
  $('dLine').setAttribute('x2', x.toFixed(1)); $('dLine').setAttribute('y2', y.toFixed(1)); $('dDot').setAttribute('cx', x.toFixed(1)); $('dDot').setAttribute('cy', y.toFixed(1));
}
function setFollow(on) {
  S.follow = on && !!S.selId; $('cFollow').setAttribute('aria-pressed', String(S.follow)); $('cFollow').textContent = S.follow ? 'Following' : 'Follow';
  if (S.follow && S.view !== 'orbit') setView('orbit');
}
$('cClose').onclick = () => select(null);
$('cFollow').onclick = () => setFollow(!S.follow);
$('cGround').onclick = () => { const f = S.flights.get(S.selId); if (!f) return; setFollow(false); setView('ground'); world.lookAtFlight(f); };

/* ---------------- view, zoom, time ---------------- */
function setView(v) {
  S.view = v; world.setMode(v);
  document.querySelectorAll('#viewSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  if (v !== 'orbit') { S.follow = false; $('cFollow').setAttribute('aria-pressed', 'false'); $('cFollow').textContent = 'Follow'; }
}
document.querySelectorAll('#viewSeg button').forEach(b => b.onclick = () => setView(b.dataset.v));
$('zIn').onclick = () => world.zoom(0.75); $('zOut').onclick = () => world.zoom(1.33);
$('zHome').onclick = () => { setFollow(false); world.cam.target.set(0, 2, 0); world.cam.r = 95; if (S.view === 'ground') { world.cam.yaw = 0; world.cam.pitch = 0.4; } };
$('timeR').oninput = e => { S.timeOff = +e.target.value; $('liveBtn').setAttribute('aria-pressed', String(S.timeOff === 0)); updateSun(); };
$('liveBtn').onclick = () => { S.timeOff = 0; $('timeR').value = 0; $('liveBtn').setAttribute('aria-pressed', 'true'); updateSun(); };

/* ---------------- popovers ---------------- */
function togglePop(id, btn, show) {
  const el = $(id); const on = show ?? el.hidden; el.hidden = !on; $(btn).setAttribute('aria-expanded', String(on));
  if (on) { for (const [o, b] of [['placePop', 'placeBtn'], ['layersPop', 'layersBtn']]) if (o !== id) { $(o).hidden = true; $(b).setAttribute('aria-expanded', 'false'); } }
}
$('placeBtn').onclick = e => { e.stopPropagation(); togglePop('placePop', 'placeBtn'); if (!$('placePop').hidden) $('searchQ').focus(); };
$('layersBtn').onclick = e => { e.stopPropagation(); togglePop('layersPop', 'layersBtn'); };
document.addEventListener('pointerdown', e => {
  for (const [o, b] of [['placePop', 'placeBtn'], ['layersPop', 'layersBtn']]) if (!$(o).hidden && !$(o).contains(e.target) && !$(b).contains(e.target)) togglePop(o, b, false);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('placePop').hidden || !$('layersPop').hidden) { togglePop('placePop', 'placeBtn', false); togglePop('layersPop', 'layersBtn', false); }
  else if (S.selId) select(null); else if (S.tab !== 'sky') setTab('sky');
});
$('presets').innerHTML = D.PLACES.map((p, i) => `<li><button data-i="${i}">${esc(p.name)}<small>${p.lat.toFixed(1)}, ${p.lon.toFixed(1)}</small></button></li>`).join('');
$('presets').onclick = e => { const b = e.target.closest('button'); if (!b) return; setPlace(D.PLACES[+b.dataset.i]); togglePop('placePop', 'placeBtn', false); };
$('geoBtn').onclick = () => {
  const res = $('results');
  if (!navigator.geolocation) { res.innerHTML = '<li class="lede">This browser can\'t share its location. Search for a place instead.</li>'; return; }
  $('geoBtn').disabled = true; $('geoBtn').lastChild.textContent = 'Finding you…';
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: lat, longitude: lon } = pos.coords;
    const name = await D.reverseGeocode(lat, lon);
    $('geoBtn').disabled = false; $('geoBtn').lastChild.textContent = 'Use my current location';
    setPlace({ name, lat, lon }); togglePop('placePop', 'placeBtn', false);
  }, err => {
    $('geoBtn').disabled = false; $('geoBtn').lastChild.textContent = 'Use my current location';
    res.innerHTML = `<li class="lede">${err.code === 1 ? 'Location access was blocked. Allow it in your browser\'s site settings, or search for a place below.' : 'Couldn\'t get your location just now. Try again, or search for a place.'}</li>`;
  }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
};
let results = [];
$('searchForm').onsubmit = async e => {
  e.preventDefault(); const q = $('searchQ').value.trim(); if (!q) return;
  const res = $('results'); res.innerHTML = '<li class="lede">Searching…</li>';
  try {
    results = await D.geocode(q);
    res.innerHTML = results.length ? results.map((r, i) => `<li><button data-i="${i}" title="${esc(r.full)}">${esc(r.name)}<small>${r.lat.toFixed(2)}, ${r.lon.toFixed(2)}</small></button></li>`).join('') : '<li class="lede">No places found. Try a city name.</li>';
  } catch (err) { res.innerHTML = '<li class="lede">Search is unavailable right now. Pick a preset below.</li>'; }
};
$('results').onclick = e => { const b = e.target.closest('button'); if (!b) return; const r = results[+b.dataset.i]; setPlace(r); togglePop('placePop', 'placeBtn', false); };

function bindSeg(id, get, set) {
  const bs = document.querySelectorAll(`#${id} button`);
  const paint = () => bs.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === get())));
  bs.forEach(b => b.onclick = () => { set(b.dataset.v); paint(); }); paint();
}
bindSeg('styleSeg', () => settings.style, v => { settings.style = v; saveSettings(); world.loadTiles(S.proj, v); $('tileCredit').textContent = TILE_STYLES[v].credit; });
bindSeg('cloudSeg', () => settings.clouds ? 'on' : 'off', v => { settings.clouds = v === 'on'; saveSettings(); world.cloudsOn = settings.clouds; });
bindSeg('labelSeg', () => settings.labels, v => { settings.labels = v; saveSettings(); });
$('tileCredit').textContent = TILE_STYLES[settings.style].credit;
world.cloudsOn = settings.clouds;

/* ---------------- tabs & panels ---------------- */
const TAB_META = { board: ['Overhead board', 720], stats: ['Sky stats', 440], weather: ['Spotting weather', 420], log: ['Spotter\'s log', 460], codes: ['Squawk codes', 440] };
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
  else if (S.tab === 'stats') body.innerHTML = statsHTML();
  else if (S.tab === 'weather') { if (fresh || !renderPanel.wxDone) { body.innerHTML = weatherHTML(); renderPanel.wxDone = true; } }
  else if (S.tab === 'log') body.innerHTML = logHTML();
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
  const list = [...S.flights.values()].map(f => ({ f, r: relative(f) })).sort((a, b) => a.r.d - b.r.d).slice(0, ROWS);
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

/* stats */
function statsHTML() {
  const arr = [...S.flights.values()];
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
function tickRecords() {
  const R = S.rec;
  for (const f of S.flights.values()) {
    const r = relative(f), k = kt(f);
    if (!R.fast || k > R.fast.v) R.fast = { v: k, cs: f.callsign };
    if (!R.high || f.alt > R.high.v) R.high = { v: f.alt, cs: f.callsign };
    if (!R.far || r.d > R.far.v) R.far = { v: r.d, cs: f.callsign };
    if (!R.near || r.slant < R.near.v) R.near = { v: r.slant, cs: f.callsign };
    if (k > 600) award('fast'); if (f.alt > 13.7) award('high');
    if (r.d < 2 && f.alt < 3) award('over');
  }
}

/* weather */
const hm = s => s ? s.slice(11, 16) : '—';
function windSVG(dir) { const a = (dir ?? 0) + 180; return `<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" class="dial"/><g transform="rotate(${a} 30 30)"><path class="arrow" d="M30 8l7 14h-5v24h-4V22h-5z"/></g></svg>`; }
function weatherHTML() {
  const w = S.weather;
  if (!w) return '<p class="lede">Loading the weather for this spot. If it doesn\'t appear, the weather service may be unreachable from here.</p>';
  const code = w.weather_code ?? 0, low = w.cloud_cover_low ?? 0, vis = w.visibility != null ? w.visibility / 1000 : null;
  let score = 100 - low * 0.55 - (w.cloud_cover_mid ?? 0) * 0.15;
  if (vis != null && vis < 10) score -= (10 - vis) * 5;
  if (code >= 51) score -= 25; if (code >= 95) score -= 30; if (code === 45 || code === 48) score -= 35;
  if (world.day < 0.4) score -= 15;
  score = Math.round(clamp(score, 0, 100));
  const [lbl, col, why] = score >= 75 ? ['Excellent', '#16A34A', 'Clear views; you should see aircraft well above you.'] : score >= 55 ? ['Good', '#65A30D', 'Some cloud, but plenty of gaps to catch aircraft.'] : score >= 35 ? ['Fair', '#D97706', 'Low cloud will hide higher traffic. Low arrivals are still visible.'] : ['Poor', '#DC2626', 'Cloud, rain or haze will hide most aircraft. Try the 3D view instead.'];
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
  <div><p class="sec-h">Sun</p><div class="sunrow"><div class="tile"><p class="k">Sunrise</p><p class="v">${hm(w.sunrise)}</p></div><div class="tile"><p class="k">Golden hour</p><p class="v">${golden}</p></div><div class="tile"><p class="k">Sunset</p><p class="v">${hm(w.sunset)}</p></div></div>
  <p class="lede" style="margin-top:8px">The sun is ${sunAlt != null ? (sunAlt >= 0 ? sunAlt + '° above' : -sunAlt + '° below') : '—'} the horizon right now. The sky and lighting in the 3D view follow its real position, and the clouds follow the live cloud cover.</p></div>`;
}

/* log */
function logHTML() {
  const lg = theLog(), types = Object.entries(lg.types).sort((a, b) => b[1].first - a[1].first);
  const got = BADGES.filter(b => lg.badges[b.id]).length;
  return `${S.mode !== 'live' ? '<p class="note">You\'re watching simulated traffic, so these catches last only for this visit. Catches from the live feed are saved in this browser.</p>' : ''}
  <div class="tiles4"><div class="tile"><p class="k">Types</p><p class="v">${types.length}</p></div><div class="tile"><p class="k">Airlines</p><p class="v">${Object.keys(lg.airlines).length}</p></div><div class="tile"><p class="k">Tracked</p><p class="v">${lg.tracked}</p></div><div class="tile"><p class="k">Badges</p><p class="v">${got}/${BADGES.length}</p></div></div>
  <div><p class="sec-h">Badges</p><div class="badges">${BADGES.map(b => `<div class="bdg${lg.badges[b.id] ? ' got' : ''}"><span class="ic">${ICON_STAR}</span><b>${esc(b.name)}</b><span>${esc(b.desc)}</span></div>`).join('')}</div></div>
  <div><p class="sec-h">Aircraft types caught</p><div class="types">${types.map(([c, t]) => `<div class="ty${D.HEAVY.has(c) ? ' heavy' : ''}"><span class="ct">×${t.n}</span><span class="code">${esc(c)}</span><span class="nm">${esc(D.TYPES[c] || c)}</span><span class="nm">${esc(t.al.slice(0, 2).join(' · '))}</span></div>`).join('') || '<p class="lede">Nothing caught yet.</p>'}</div></div>`;
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
    <p class="sec-h">Data</p>
    <p>Aircraft positions come from the community-run ADS-B networks <a href="https://adsb.lol" target="_blank" rel="noopener">ADSB.lol</a>, <a href="https://airplanes.live" target="_blank" rel="noopener">airplanes.live</a> and <a href="https://adsb.fi" target="_blank" rel="noopener">adsb.fi</a>. Routes come from ADSB.lol, photos from <a href="https://www.planespotters.net" target="_blank" rel="noopener">Planespotters.net</a>, weather from <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>, and place search from <a href="https://nominatim.openstreetmap.org" target="_blank" rel="noopener">OpenStreetMap Nominatim</a>. ${esc(TILE_STYLES[settings.style].credit)}. For spotting fun only, not for navigation.</p></div>`;
}

/* ---------------- HUD ---------------- */
function updateHUD() {
  const arr = [...S.flights.values()];
  $('rCount').textContent = arr.length;
  if (!arr.length) { $('rHigh').textContent = $('rNear').textContent = '—'; $('toast').hidden = true; return; }
  const hi = arr.reduce((a, b) => (b.alt > a.alt ? b : a)); $('rHigh').textContent = fmtAlt(hi.alt).replace(' ft', ''); $('rHighS').textContent = hi.callsign;
  let near = null, nr = null; for (const f of arr) { const r = relative(f); if (!nr || r.slant < nr.slant) { near = f; nr = r; } }
  $('rNear').textContent = (nr.slant < 10 ? nr.slant.toFixed(1) : Math.round(nr.slant)) + ' km'; $('rNearS').textContent = `${near.callsign} · look ${P16[pt16(nr.brg)]}`;
  const over = arr.map(f => ({ f, r: relative(f) })).filter(o => o.r.d < 5 && o.f.alt < 6).sort((a, b) => a.r.d - b.r.d)[0];
  if (over) {
    $('toast').hidden = false;
    $('toastText').textContent = `${over.f.callsign} is ${over.r.d.toFixed(1)} km away at ${fmtAlt(over.f.alt)}, ${Math.round(over.r.elev)}° up to the ${P16L[pt16(over.r.brg)]}.`;
    if (!over.f.seenOver) { over.f.seenOver = true; pushEvent('over', `${over.f.callsign} passed near you at ${fmtAlt(over.f.alt)}`); }
  } else $('toast').hidden = true;
}

/* ---------------- loop ---------------- */
let acc = { hud: 0, card: 0, board: 2.5, panel: 0, rec: 0, hist: 15 };
const loader = $('loader'); let loaderDone = false; const bootT = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(world.clock.getDelta(), 0.1), t = world.clock.elapsedTime;
  if (S.mode === 'sim') simStep(dt); else if (S.mode === 'live') reckon(dt);
  const arr = [...S.flights.values()];
  world.syncAircraft(arr, dt, t, S.selId);
  const fp = S.follow && S.selId ? world.vis.get(S.selId)?.pos : null;
  world.frame(dt, t, fp || null);
  updateLabels(arr);
  if ((acc.hud += dt) > 0.5) { acc.hud = 0; updateHUD(); }
  if ((acc.card += dt) > 0.3) { acc.card = 0; if (S.selId) updateCard(); }
  if ((acc.rec += dt) > 1) { acc.rec = 0; tickRecords(); }
  if ((acc.hist += dt) > 20) { acc.hist = 0; if (S.mode !== 'boot') { S.history.push({ t: Date.now(), n: S.flights.size }); if (S.history.length > 90) S.history.shift(); } }
  if (S.tab === 'board' && (acc.board += dt) > 3) { acc.board = 0; updateBoard(); }
  if ((S.tab === 'stats' || S.tab === 'log') && (acc.panel += dt) > 3) { acc.panel = 0; renderPanel(false); }
  if (!loaderDone) {
    const p = world.tileProgress(), k = p.total ? p.done / p.total : 0;
    $('loadArc').style.strokeDashoffset = String(1 - Math.max(0.03, Math.min(1, k * 0.8 + (S.feedResolved ? 0.2 : 0))));
    $('loadMsg').textContent = S.feedResolved ? 'Loading the ground' : 'Tuning to 1090 MHz';
    if ((k > 0.7 && S.feedResolved) || performance.now() - bootT > 7000) { loaderDone = true; loader.classList.add('done'); world.introT = 0; }
  }
}

window.__squawk = { world, S };
setPlace(settings.place);
requestAnimationFrame(frame);
