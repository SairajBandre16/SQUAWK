// The hobby layer: aircraft families to collect, levels, daily missions and plain-English facts for newcomers.

/** Families for the collection. `m` is the 3D model used for the silhouette; `test` matches ICAO type codes. */
const fam = (id, name, m, re, fact) => ({ id, name, m, re: new RegExp(re), fact });
export const FAMILIES = [
  fam('a380', 'Airbus A380', 'a380', '^A38', 'The largest passenger airliner ever built, with two full-length passenger decks.'),
  fam('b747', 'Boeing 747', 'jumbo', '^B74|^BLCF', 'The hump holds the upper deck. It first flew in 1969 and made long-haul travel affordable.'),
  fam('b777', 'Boeing 777', 'wide', '^B77', 'Its engines are nearly as wide as a 737\'s cabin. It was designed almost entirely on computer.'),
  fam('b787', 'Boeing 787', 'wide', '^B78', 'About half of it is carbon composite, which lets the cabin feel like a lower altitude.'),
  fam('a350', 'Airbus A350', 'wide', '^A35', 'A mostly carbon-composite widebody with wing tips that curve upward in flight.'),
  fam('a330', 'Airbus A330', 'wide', '^A33', 'A long-range twin that shares its cockpit design with the four-engine A340.'),
  fam('b767', 'Boeing 767', 'wide', '^B76', 'One of the first twin-engine jets allowed to fly long routes across the Atlantic.'),
  fam('b757', 'Boeing 757', 'narrow', '^B75', 'A narrowbody with big engines and long legs, known for steep climbs.'),
  fam('a320', 'Airbus A320 family', 'narrow', '^A31[89]|^A32|^A2[01]N|^A19N', 'The first airliner family with digital fly-by-wire and side-stick controls.'),
  fam('b737', 'Boeing 737', 'narrow', '^B73|^B3[789X]M', 'First flown in 1967 and still in production: one of the best-selling jets ever made.'),
  fam('a220', 'Airbus A220', 'narrow', '^BCS', 'It began life as the Bombardier C Series before Airbus took it over.'),
  fam('ejet', 'Embraer E-Jet', 'narrow', '^E1[79]|^E75|^E29', 'Seats are two by two, so there are no middle seats.'),
  fam('crj', 'Bombardier CRJ', 'rear', '^CRJ', 'It grew out of the Challenger business jet, which is why its engines sit at the back.'),
  fam('atr', 'ATR turboprop', 'prop', '^AT[4-7]', 'Fuel-sipping propeller airliners built for short regional hops.'),
  fam('dash8', 'Dash 8', 'prop', '^DH8', 'The Q400 version is one of the fastest turboprop airliners, cruising above 600 km/h.'),
  fam('a340', 'Airbus A340', 'quad', '^A34', 'Four engines once let it fly routes that twin-engine jets were not allowed to.'),
  fam('trijet', 'Trijet (MD-11, DC-10)', 'wide', '^MD11|^DC10|^L101', 'One of its three engines sits high in the tail.'),
  fam('bizjet', 'Business jet', 'rear', '^C25|^C5[0-9]|^C68|^C700|^C750|^CL[36]|^GLF|^GL[57]|^GLEX|^F2TH|^F900|^FA[578]|^PC24|^E5[05]P|^LJ|^H25|^G280|^HA4T', 'Many cruise above 41,000 ft, higher than most airliners.'),
  fam('light', 'Light aircraft', 'light', '^C1[5-8]|^C2[01]|^PA|^P28|^SR2|^DA[2-6]|^TBM|^PC12|^M20|^BE[3-9]|^RV', 'Usually flown by sight rather than instruments, and often low enough to read the registration.'),
  fam('heli', 'Helicopter', 'heli', '^EC|^H1[36]|^A1[0-9]9|^AS[3-6]|^S[679]|^R[2-6][26]|^B[04][0-9]|^NH90|^UH|^H60|^EH10', 'You can often hear the rotor slap before you see one.'),
  fam('lifter', 'Military transport', 'lifter', '^C17|^C130|^C30J|^A400|^IL76|^C5M|^C295', 'Built to land on short, rough runways with heavy loads.'),
  fam('beluga', 'Airbus Beluga', 'wide', '^A3ST|^A337', 'It carries whole aircraft sections between Airbus factories.'),
  fam('antonov', 'Antonov giant', 'lifter', '^A12[45]|^A225', 'Big enough to carry a railway locomotive in its hold.'),
  fam('tanker', 'Tanker or radar plane', 'quad', '^K35|^E3|^A332T|^KC', 'Tankers refuel other aircraft in mid-air; the radar planes carry a big rotating dish.')
];
export const familyOf = type => type ? FAMILIES.find(f => f.re.test(type)) || null : null;

/* ---------------- levels ---------------- */
// the first session gets you to level 2 or 3; after that it takes regular spotting
export const LEVELS = [[0, 'Sky curious'], [100, 'Runway rookie'], [250, 'Contrail chaser'], [500, 'Sky watcher'], [900, 'Spotter'], [1500, 'Keen spotter'],
  [2400, 'Ace spotter'], [3600, 'Tower regular'], [5200, 'Aviation buff'], [7500, 'Sky master'], [10000, 'Legend of the skies']];
export function levelOf(xp) {
  let i = 0; while (i < LEVELS.length - 1 && xp >= LEVELS[i + 1][0]) i++;
  const next = LEVELS[i + 1];
  return { n: i + 1, name: LEVELS[i][1], xp, from: LEVELS[i][0], to: next ? next[0] : null, pct: next ? (xp - LEVELS[i][0]) / (next[0] - LEVELS[i][0]) : 1 };
}
export const XP = { catch: 1, type: 10, airline: 5, badge: 25, seen: 25, seenType: 25, mission: 30 };

/* ---------------- daily missions ---------------- */
// Each check gets the day's record and the event that just happened; it returns true once the mission is done.
export const MISSIONS = [
  { id: 'wide', text: 'Catch a widebody jet', check: (d, e) => e.heavy },
  { id: 'air3', text: 'Log 3 different airlines today', check: d => d.airlines.length >= 3 },
  { id: 'types5', text: 'Log 5 different aircraft types today', check: d => d.types.length >= 5 },
  { id: 'low', text: 'Catch a plane below 3,000 ft', check: (d, e) => e.alt != null && e.alt < 0.914 },
  { id: 'high', text: 'Catch a plane above FL400', check: (d, e) => e.alt > 12.19 },
  { id: 'seen', text: 'See a plane with your own eyes and tap "I saw it"', check: (d, e) => e.seen },
  { id: 'prop', text: 'Catch a propeller aircraft', check: (d, e) => e.model === 'prop' || e.model === 'light' },
  { id: 'over', text: 'Have a plane pass within 5 km of you', check: (d, e) => e.over },
  { id: 'contrail', text: 'Catch a plane that should be leaving a contrail', check: (d, e) => e.ctr === 'short' || e.ctr === 'persistent' },
  { id: 'cargo', text: 'Catch a cargo flight (FedEx, UPS, DHL and friends)', check: (d, e) => /^(FDX|UPS|DHK|BCS|GTI|CLX|ABR|CKS|BOX|CAO|MPH|NCA)/.test(e.cs || '') }
];
const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
/** Three missions for a date, the same for everyone on that day. */
export function missionsFor(date) {
  const pool = [...MISSIONS], out = []; let h = hash(date);
  while (out.length < 3) { out.push(pool.splice(h % pool.length, 1)[0]); h = hash(date + out.length + h); }
  return out;
}
export const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
/** Consecutive days with activity, ending today or yesterday. */
export function streak(days) {
  const set = new Set(days); let n = 0; const d = new Date();
  if (!set.has(today())) d.setDate(d.getDate() - 1);
  for (;;) { const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); if (!set.has(k)) break; n++; d.setDate(d.getDate() - 1); }
  return n;
}

/* ---------------- plain-English facts ---------------- */
const SPAN = { narrow: 35, wide: 62, quad: 60, jumbo: 68, a380: 80, prop: 27, rear: 24, light: 11, lifter: 50, heli: 12 }; // metres, roughly
const THINGS = [[0.6, 'a grain of sand'], [2, 'a sesame seed'], [5, 'a grain of rice'], [9, 'a pea'], [16, 'a small coin'], [25, 'your thumbnail'], [45, 'a golf ball'], [80, 'a tennis ball']];
/** Two short comparisons a newcomer can picture: how high and fast, and how big it looks from where you stand. */
export function plainFacts(f, rel) {
  const out = [], kmh = Math.round(f.spd * 3600), km = f.alt;
  if (kmh > 120) out.push(`It covers ${Math.round(f.spd * 60)} km every minute${kmh > 400 ? `, about ${Math.round(kmh / 110)} times faster than a car on a motorway` : ''}.`);
  if (km > 8.85) out.push(`At ${km.toFixed(1)} km up it's ${(km - 8.85).toFixed(1)} km higher than the top of Everest.`);
  else if (km > 1) out.push(`${km.toFixed(1)} km up is about ${Math.round(km / 0.33)} Eiffel Towers stacked.`);
  if (rel && rel.d < 200 && rel.elev > 0) {
    const mm = (SPAN[f.model] || 35) / (rel.slant * 1000) * 700; // its wingspan seen at arm's length (70 cm)
    const t = THINGS.find(x => mm <= x[0]) || THINGS[THINGS.length - 1];
    out.push(`From you it looks about as wide as ${t[1]} held at arm's length.`);
  }
  return out;
}

/* ---------------- silhouettes for the collection ---------------- */
// Top-down outlines, nose up, in a 64 x 64 box.
const SIL = {
  narrow: 'M32 4c2 0 3 3 3 7v12l20 10v4l-20-5v14l6 5v3l-9-2-9 2v-3l6-5V32l-20 5v-4l20-10V11c0-4 1-7 3-7z',
  wide: 'M32 3c2.5 0 3.5 3 3.5 8v11l23 12v4l-23-6v16l7 5v3l-10.5-2L21.5 56v-3l7-5V32l-23 6v-4l23-12V11c0-5 1-8 3.5-8z',
  quad: 'M32 3c2.5 0 3.5 3 3.5 8v11l23 12v4l-23-6v16l7 5v3l-10.5-2L21.5 56v-3l7-5V32l-23 6v-4l23-12V11c0-5 1-8 3.5-8zM44 27h3v6h-3zM17 27h3v6h-3z',
  jumbo: 'M32 2c3 0 4 3 4 9v10l23 13v4l-23-6v16l7 5v3l-11-2-11 2v-3l7-5V32L5 38v-4l23-13V11c0-6 1-9 4-9zM44 27h3v6h-3zM17 27h3v6h-3z',
  a380: 'M32 2c3.5 0 4.5 3 4.5 9v10l24 14v4l-24-6v15l8 5v3l-12.5-2L19.5 56v-3l8-5V33l-24 6v-4l24-14V11c0-6 1-9 4.5-9z',
  prop: 'M32 6c2 0 2.5 3 2.5 6v8h24v4h-24v18l6 3v3h-17v-3l6-3V24h-24v-4h24v-8c0-3 .5-6 2.5-6z',
  rear: 'M32 5c1.8 0 2.5 3 2.5 7v12l16 8v3l-16-4v12l5 4v3l-7.5-1.5L24.5 50v-3l5-4V31l-16 4v-3l16-8V12c0-4 .7-7 2.5-7z',
  light: 'M32 10c1.5 0 2 2 2 4v6h22v4H34v16l5 2v3H25v-3l5-2V24H8v-4h22v-6c0-2 .5-4 2-4z',
  lifter: 'M32 4c3 0 4 3 4 8v8h23v5H36v19l8 4v3H20v-3l8-4V25H5v-5h23v-8c0-5 1-8 4-8z',
  heli: 'M32 14a8 8 0 0 1 8 8 8 8 0 0 1-6 7.7V52h5v3H25v-3h5V29.7A8 8 0 0 1 24 22a8 8 0 0 1 8-8zM6 21h52v2H6z'
};
export const silhouette = m => `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="${SIL[m] || SIL.narrow}"/></svg>`;
