// Realistic simulated traffic, used when no live ADS-B feed can be reached.
import { AIRPORTS } from './data.js';
import { D2R, dirVec, haversine } from './geo.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const LET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const L = n => Array.from({ length: n }, () => pick(LET)).join('');

// [airline, weight, types, typical destinations (IATA)]
const POOLS = {
  EU: [['RYR', 26, ['B738', 'B38M'], ['STN', 'BCN', 'MAD', 'BGY', 'KRK', 'FAO', 'AGP', 'BVA']], ['EIN', 16, ['A320', 'A20N', 'A21N', 'A333', 'AT76'], ['LHR', 'JFK', 'BOS', 'CDG', 'AMS', 'ORD']],
    ['BAW', 8, ['A320', 'A319', 'A20N'], ['LHR', 'LGW']], ['EZY', 7, ['A20N', 'A319', 'A320'], ['LGW', 'BRS', 'GVA', 'MAN']], ['KLM', 5, ['E190', 'B738', 'E295'], ['AMS']],
    ['DLH', 5, ['A20N', 'A321'], ['FRA', 'MUC']], ['AFR', 4, ['A320', 'A20N'], ['CDG']], ['VLG', 3, ['A320'], ['BCN']], ['WZZ', 3, ['A21N'], ['BUD', 'OTP', 'GDN']],
    ['UAE', 2, ['B77W', 'A388'], ['DXB']], ['QTR', 2, ['B788', 'A359'], ['DOH']], ['UAL', 3, ['B763', 'B752', 'B789'], ['EWR', 'IAD', 'ORD']],
    ['DAL', 3, ['A333', 'B764', 'A339'], ['JFK', 'ATL']], ['AAL', 2, ['B772', 'B788'], ['PHL', 'DFW', 'JFK']], ['VIR', 2, ['B789', 'A35K', 'A339'], ['JFK', 'LAX', 'BOS']],
    ['ACA', 2, ['B789', 'A333'], ['YYZ', 'YUL']], ['THY', 2, ['A21N', 'A359'], ['IST']], ['SAS', 2, ['A20N'], ['CPH', 'ARN', 'OSL']]],
  NA: [['UAL', 20, ['B38M', 'A320', 'B789', 'B772'], ['ORD', 'DEN', 'SFO', 'IAH', 'EWR']], ['DAL', 20, ['A321', 'B739', 'A339', 'A21N'], ['ATL', 'MSP', 'DTW', 'SLC']],
    ['AAL', 18, ['A321', 'B38M', 'B772'], ['DFW', 'CLT', 'MIA', 'PHX']], ['SWA', 14, ['B737', 'B38M'], ['MDW', 'DAL', 'LAS', 'BWI']], ['JBU', 8, ['A320', 'A21N', 'BCS3'], ['BOS', 'FLL', 'MCO']],
    ['ASA', 6, ['B739', 'E175'], ['SEA', 'PDX']], ['ACA', 5, ['A20N', 'B789'], ['YYZ', 'YVR']], ['FDX', 3, ['B77L', 'B763'], ['MEM']], ['BAW', 3, ['B77W', 'A35K'], ['LHR']]],
  IN: [['IGO', 34, ['A20N', 'A21N', 'AT76'], ['DEL', 'BLR', 'HYD', 'MAA', 'CCU', 'GOI', 'PNQ']], ['AIC', 16, ['A20N', 'A21N', 'B788', 'B77W', 'A359'], ['DEL', 'LHR', 'JFK', 'SFO']],
    ['AKJ', 8, ['B38M'], ['BLR', 'AMD', 'DEL']], ['SEJ', 6, ['B738', 'DH8D'], ['DEL', 'GOI']], ['AXB', 6, ['B38M', 'B738'], ['DXB', 'SHJ', 'COK']],
    ['UAE', 5, ['B77W', 'A388'], ['DXB']], ['QTR', 3, ['B788', 'A359'], ['DOH']], ['ETD', 3, ['B789'], ['AUH']], ['SIA', 2, ['A359'], ['SIN']]],
  ME: [['UAE', 30, ['A388', 'B77W'], ['LHR', 'JFK', 'BOM', 'SYD', 'CDG']], ['FDB', 18, ['B38M', 'B738'], ['KWI', 'MCT', 'KTM', 'BAH']], ['QTR', 10, ['B788', 'A359', 'B77W'], ['DOH']],
    ['ETD', 8, ['B789', 'A35K'], ['AUH']], ['IGO', 8, ['A21N'], ['BOM', 'DEL']], ['AIC', 5, ['B788'], ['DEL']], ['SVA', 5, ['B789', 'A320'], ['JED', 'RUH']], ['BAW', 3, ['B77W'], ['LHR']]],
  AS: [['SIA', 18, ['A359', 'B78X', 'A388', 'B38M'], ['SIN']], ['CPA', 14, ['A359', 'B77W', 'A35K'], ['HKG']], ['ANA', 12, ['B789', 'B788', 'A321'], ['HND', 'NRT']],
    ['JAL', 12, ['B789', 'A359', 'B738'], ['HND']], ['KAL', 8, ['B77W', 'A333', 'B789'], ['ICN']], ['CCA', 6, ['A333', 'B738'], ['PEK']], ['THA', 5, ['A359', 'B77W'], ['BKK']], ['AXM', 8, ['A20N', 'A320'], ['KUL', 'BKK']]],
  AU: [['QFA', 26, ['B738', 'A332', 'B789', 'A388'], ['MEL', 'BNE', 'PER', 'LAX', 'SIN']], ['VOZ', 18, ['B38M', 'B738'], ['MEL', 'BNE', 'ADL']], ['JST', 14, ['A320', 'A21N'], ['MEL', 'OOL', 'BNE']],
    ['SIA', 5, ['A359', 'A388'], ['SIN']], ['UAE', 4, ['A388'], ['DXB']], ['ANZ', 5, ['A21N', 'B789'], ['AKL']]]
};
const regionOf = icao => { const c = (icao || 'E')[0]; if (c === 'K' || c === 'C' || c === 'M') return 'NA'; if (c === 'V') return 'IN'; if (c === 'O') return 'ME';
  if (c === 'R' || c === 'W' || c === 'Z') return 'AS'; if (c === 'Y' || c === 'N') return 'AU'; return 'EU'; };
const REGP = { RYR: 'EI-', EIN: 'EI-', BAW: 'G-', EZY: 'G-', VIR: 'G-', DLH: 'D-A', KLM: 'PH-', AFR: 'F-G', VLG: 'EC-', WZZ: '9H-', SAS: 'SE-', THY: 'TC-',
  UAE: 'A6-', FDB: 'A6-', ETD: 'A6-', QTR: 'A7-', SVA: 'HZ-', ACA: 'C-F', IGO: 'VT-', AIC: 'VT-', AKJ: 'VT-', SEJ: 'VT-', AXB: 'VT-', SIA: '9V-', CPA: 'B-', CCA: 'B-',
  ANA: 'JA', JAL: 'JA', KAL: 'HL', THA: 'HS-', AXM: '9M-', QFA: 'VH-', VOZ: 'VH-', JST: 'VH-', ANZ: 'ZK-' };
const US = new Set(['UAL', 'DAL', 'AAL', 'SWA', 'JBU', 'ASA', 'FDX']);
function makeReg(a) { if (US.has(a)) return 'N' + ri(100, 999) + L(2); const p = REGP[a] || (L(1) + '-'); return p === 'JA' ? 'JA' + ri(100, 899) + L(1) : p + L(p.length >= 3 ? 3 : 4); }
function makeCall(a) { if (a === 'RYR' || a === 'EZY') return a + ri(1, 9) + L(2); if (a === 'EIN') return a + (Math.random() < .5 ? ri(100, 799) : ri(1, 9) + L(2)); return a + ri(10, 2999); }
function weighted(list) { const t = list.reduce((s, e) => s + e[1], 0); let r = Math.random() * t; for (const e of list) { if ((r -= e[1]) <= 0) return e; } return list[0]; }
function squawk() { let s; do { s = [0, 0, 0, 0].map(() => ri(0, 7)).join(''); } while (/^(7[05-7]00|7000|2000|1200|0000)$/.test(s)); return s; }

export class Sim {
  constructor(proj) { this.proj = proj; this.uid = 0; this.reset(); }
  reset() {
    const p = this.proj;
    let best = null, bd = 1e9;
    for (const a of AIRPORTS) { const d = haversine(p.lat0, p.lon0, a[3], a[4]); if (d < bd) { bd = d; best = a; } }
    this.airport = bd < 110 ? best : null;
    this.pool = POOLS[regionOf(best && best[0])];
    if (this.airport) {
      const [icao, iata, name, lat, lon, hdg, len] = this.airport;
      const c = p.toXZ(lat, lon), a = dirVec(hdg + 180);
      this.ap = { icao, iata, name, hdg, len, c, a, thr: { x: c.x + a.x * len / 2, z: c.z + a.z * len / 2 } };
    } else this.ap = null;
    this.timers = { arr: 2, dep: 5, over: 1 };
    this.target = this.ap ? { arr: 6, dep: 6, over: 14 } : { arr: 0, dep: 0, over: 16 };
  }
  identity() {
    const [a, , types, dests] = weighted(this.pool);
    return { callsign: makeCall(a), type: pick(types), reg: makeReg(a), squawk: squawk(), dest: pick(dests), hex: 'sim' + (++this.uid) };
  }
  withRoute(f, inbound) {
    if (!this.ap) return;
    const here = { iata: this.ap.iata, name: this.ap.name }, there = { iata: f.dest, name: f.dest };
    f.route = inbound ? { from: there, to: here } : { from: here, to: there };
  }
  spawn(kind, pre, out) {
    const ap = this.ap;
    if (kind === 'arr' && ap) {
      const f = { kind, ...this.identity(), d: pre ? rnd(4, 60) : rnd(58, 70), trk: ap.hdg, turn: 0 };
      if (Math.random() < 0.02) f.squawk = '7700';
      this.placeArr(f); this.withRoute(f, true); out.push(f); return;
    }
    if (kind === 'dep' && ap) {
      const f = { kind, ...this.identity(), x: ap.thr.x - ap.a.x * 1.9, z: ap.thr.z - ap.a.z * 1.9, alt: 0, trk: ap.hdg, spd: 0.085, vr: 0.012,
        goal: rnd(0, 360), cruise: rnd(9.5, 11.9), flown: 0, turn: 0 };
      if (pre) { const n = ri(0, 700); for (let i = 0; i < n; i++) this.stepDep(f, 1); if (Math.hypot(f.x, f.z) > 185) return; }
      this.withRoute(f, false); out.push(f); return;
    }
    const h = rnd(0, 360), dir = dirVec(h), off = rnd(-120, 120);
    const f = { kind: 'over', ...this.identity(), trk: h, spd: rnd(0.225, 0.27), vr: 0, alt: ri(31, 41) * 0.3048, turn: 0 };
    const back = pre ? rnd(-180, 185) : 190;
    f.x = -dir.x * back - dir.z * off; f.z = -dir.z * back + dir.x * off;
    if (Math.random() < 0.06) f.squawk = '2000';
    f.route = null; out.push(f);
  }
  placeArr(f) {
    const ap = this.ap;
    f.x = ap.thr.x + ap.a.x * f.d; f.z = ap.thr.z + ap.a.z * f.d;
    f.alt = Math.min(f.d * 0.0524 + 0.015, 4.5);
    f.spd = Math.min(0.068 + f.d * 0.0017, 0.14); f.vr = -f.spd * 0.0524;
  }
  stepDep(f, dt) {
    f.spd = Math.min(f.spd + 0.0011 * dt, f.alt > 3 ? 0.245 : 0.14);
    f.vr = f.alt < f.cruise ? (f.alt < 3 ? 0.0125 : 0.008) : 0; f.alt = Math.min(f.cruise, f.alt + f.vr * dt);
    f.flown += f.spd * dt; f.turn = 0;
    if (f.flown > 5 && f.alt > 0.9) {
      const diff = ((f.goal - f.trk + 540) % 360) - 180;
      if (Math.abs(diff) > 0.5) { const t = Math.max(-2.2 * dt, Math.min(2.2 * dt, diff)); f.trk = (f.trk + t + 360) % 360; f.turn = t / dt; }
    }
    f.x += f.spd * Math.sin(f.trk * D2R) * dt; f.z -= f.spd * Math.cos(f.trk * D2R) * dt;
  }
  /** Advance all simulated flights. Returns {spawned:[], landed:[flight], gone:[id]} */
  step(flights, dt) {
    const res = { spawned: [], landed: [], gone: [] }, counts = { arr: 0, dep: 0, over: 0 };
    for (const f of flights.values()) {
      counts[f.kind] = (counts[f.kind] || 0) + 1;
      if (f.kind === 'arr') { f.d -= f.spd * dt; this.placeArr(f); if (f.d < 0.12) { res.landed.push(f); res.gone.push(f.id); } }
      else if (f.kind === 'dep') { this.stepDep(f, dt); if (Math.hypot(f.x, f.z) > 192) res.gone.push(f.id); }
      else {
        f.x += f.spd * Math.sin(f.trk * D2R) * dt; f.z -= f.spd * Math.cos(f.trk * D2R) * dt;
        if (f.x * Math.sin(f.trk * D2R) - f.z * Math.cos(f.trk * D2R) > 192) res.gone.push(f.id);
      }
      const ll = this.proj.toLL(f.x, f.z); f.lat = ll.lat; f.lon = ll.lon;
    }
    for (const k of ['arr', 'dep', 'over']) {
      this.timers[k] -= dt;
      if (counts[k] < this.target[k] && this.timers[k] <= 0) { this.spawn(k, false, res.spawned); this.timers[k] = k === 'over' ? rnd(4, 12) : rnd(20, 45); }
    }
    for (const f of res.spawned) { const ll = this.proj.toLL(f.x, f.z); f.lat = ll.lat; f.lon = ll.lon; }
    return res;
  }
  initial() {
    const out = [];
    for (let i = 0; i < this.target.arr; i++) this.spawn('arr', true, out);
    for (let i = 0; i < this.target.dep; i++) this.spawn('dep', true, out);
    for (let i = 0; i < this.target.over; i++) this.spawn('over', true, out);
    for (const f of out) { const ll = this.proj.toLL(f.x, f.z); f.lat = ll.lat; f.lon = ll.lon; }
    return out;
  }
}
