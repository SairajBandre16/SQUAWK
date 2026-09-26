// Reference data and network sources (ADS-B feeds, routes, photos, weather, geocoding).

export const AIRLINES = {
  RYR: 'Ryanair', RUK: 'Ryanair UK', MAY: 'Malta Air', EIN: 'Aer Lingus', BAW: 'British Airways', SHT: 'BA Shuttle', CFE: 'BA CityFlyer',
  EZY: 'easyJet', EJU: 'easyJet Europe', EZS: 'easyJet Switzerland', KLM: 'KLM', DLH: 'Lufthansa', AFR: 'Air France', UAL: 'United Airlines',
  DAL: 'Delta Air Lines', AAL: 'American Airlines', SWA: 'Southwest', JBU: 'JetBlue', ASA: 'Alaska Airlines', NKS: 'Spirit', FFT: 'Frontier',
  HAL: 'Hawaiian', UAE: 'Emirates', QTR: 'Qatar Airways', ETD: 'Etihad', FDB: 'flydubai', SVA: 'Saudia', ACA: 'Air Canada', WJA: 'WestJet',
  VIR: 'Virgin Atlantic', ICE: 'Icelandair', SAS: 'SAS', FIN: 'Finnair', THY: 'Turkish Airlines', PGT: 'Pegasus', LOG: 'Loganair',
  ABR: 'ASL Airlines Ireland', VLG: 'Vueling', IBE: 'Iberia', AEA: 'Air Europa', WZZ: 'Wizz Air', WUK: 'Wizz Air UK', EXS: 'Jet2', TOM: 'TUI',
  TAP: 'TAP Air Portugal', SWR: 'Swiss', AUA: 'Austrian', EWG: 'Eurowings', BEL: 'Brussels Airlines', LOT: 'LOT Polish', NAX: 'Norwegian',
  NSZ: 'Norwegian', ITY: 'ITA Airways', AIC: 'Air India', AXB: 'Air India Express', IGO: 'IndiGo', AKJ: 'Akasa Air', SEJ: 'SpiceJet',
  VTI: 'Vistara', SIA: 'Singapore Airlines', CPA: 'Cathay Pacific', ANA: 'All Nippon', JAL: 'Japan Airlines', KAL: 'Korean Air',
  AAR: 'Asiana', CCA: 'Air China', CES: 'China Eastern', CSN: 'China Southern', THA: 'Thai Airways', MAS: 'Malaysia Airlines',
  AXM: 'AirAsia', QFA: 'Qantas', VOZ: 'Virgin Australia', JST: 'Jetstar', ANZ: 'Air New Zealand', ETH: 'Ethiopian', MSR: 'EgyptAir',
  RAM: 'Royal Air Maroc', SAA: 'South African', KQA: 'Kenya Airways', ELY: 'El Al', LAN: 'LATAM', TAM: 'LATAM Brasil', AVA: 'Avianca',
  AMX: 'Aeroméxico', FDX: 'FedEx', UPS: 'UPS', DHK: 'DHL', BCS: 'European Air Transport (DHL)', GTI: 'Atlas Air', CLX: 'Cargolux',
  RCH: 'US Air Force (Reach)', IRL: 'Irish Air Corps', RRR: 'Royal Air Force', GAF: 'German Air Force', FAF: 'French Air Force',
  NJE: 'NetJets Europe', EJA: 'NetJets', VJT: 'VistaJet', BCY: 'CityJet', STK: 'Stobart', EFW: 'BA Euroflyer', TVS: 'Smartwings',
  CTN: 'Croatia Airlines', AEE: 'Aegean', SXS: 'SunExpress', CND: 'Condor', EDW: 'Edelweiss', AZU: 'Azul', GLO: 'Gol'
};
export const MILITARY = ['RCH', 'IRL', 'RRR', 'GAF', 'FAF', 'IAM', 'CFC', 'NATO', 'ASCOT', 'CNV', 'PAT', 'SAM', 'BAF', 'NAF', 'HKY'];

export const TYPES = {
  B738: 'Boeing 737-800', B38M: 'Boeing 737 MAX 8', B37M: 'Boeing 737 MAX 7', B39M: 'Boeing 737 MAX 9', B3XM: 'Boeing 737 MAX 10',
  B737: 'Boeing 737-700', B734: 'Boeing 737-400', B739: 'Boeing 737-900', B733: 'Boeing 737-300',
  A318: 'Airbus A318', A319: 'Airbus A319', A320: 'Airbus A320', A20N: 'Airbus A320neo', A321: 'Airbus A321', A21N: 'Airbus A321neo', A19N: 'Airbus A319neo',
  A332: 'Airbus A330-200', A333: 'Airbus A330-300', A338: 'Airbus A330-800neo', A339: 'Airbus A330-900neo', A359: 'Airbus A350-900',
  A35K: 'Airbus A350-1000', A388: 'Airbus A380-800', A306: 'Airbus A300-600', A310: 'Airbus A310', A343: 'Airbus A340-300', A346: 'Airbus A340-600',
  B752: 'Boeing 757-200', B753: 'Boeing 757-300', B762: 'Boeing 767-200', B763: 'Boeing 767-300', B764: 'Boeing 767-400',
  B772: 'Boeing 777-200', B77W: 'Boeing 777-300ER', B77L: 'Boeing 777-200LR / 777F', B773: 'Boeing 777-300', B779: 'Boeing 777-9',
  B788: 'Boeing 787-8', B789: 'Boeing 787-9', B78X: 'Boeing 787-10', B744: 'Boeing 747-400', B748: 'Boeing 747-8', B74F: 'Boeing 747 freighter',
  E170: 'Embraer E170', E175: 'Embraer E175', E75L: 'Embraer E175', E190: 'Embraer E190', E195: 'Embraer E195', E290: 'Embraer E190-E2', E295: 'Embraer E195-E2',
  BCS1: 'Airbus A220-100', BCS3: 'Airbus A220-300', CRJ7: 'Bombardier CRJ700', CRJ9: 'Bombardier CRJ900', CRJX: 'Bombardier CRJ1000',
  AT72: 'ATR 72', AT75: 'ATR 72-500', AT76: 'ATR 72-600', AT45: 'ATR 42-500', AT46: 'ATR 42-600', DH8D: 'De Havilland Dash 8-400', DH8C: 'Dash 8-300',
  SF34: 'Saab 340', SB20: 'Saab 2000', C17: 'Boeing C-17 Globemaster III', C130: 'Lockheed C-130 Hercules', C30J: 'Lockheed C-130J',
  A400: 'Airbus A400M', K35R: 'Boeing KC-135', P8: 'Boeing P-8 Poseidon', C295: 'Airbus C295', PC12: 'Pilatus PC-12', C172: 'Cessna 172',
  C152: 'Cessna 152', PA28: 'Piper PA-28', SR22: 'Cirrus SR22', DA40: 'Diamond DA40', C25A: 'Cessna Citation CJ2', C56X: 'Cessna Citation Excel',
  C68A: 'Cessna Citation Latitude', C700: 'Cessna Citation Longitude', CL35: 'Bombardier Challenger 350', CL60: 'Bombardier Challenger 600',
  GLF5: 'Gulfstream G550', GLF6: 'Gulfstream G650', GL7T: 'Bombardier Global 7500', GLEX: 'Bombardier Global Express', F2TH: 'Dassault Falcon 2000',
  FA7X: 'Dassault Falcon 7X', FA8X: 'Dassault Falcon 8X', PC24: 'Pilatus PC-24', E55P: 'Embraer Phenom 300', LJ45: 'Learjet 45',
  EC35: 'Airbus H135', EC45: 'Airbus H145', A139: 'Leonardo AW139', A169: 'Leonardo AW169', S92: 'Sikorsky S-92', R44: 'Robinson R44', AS50: 'Airbus H125',
  A124: 'Antonov An-124 Ruslan', A225: 'Antonov An-225 Mriya', A3ST: 'Airbus Beluga', A337: 'Airbus BelugaXL', IL76: 'Ilyushin Il-76', C5M: 'Lockheed C-5M Galaxy',
  B52: 'Boeing B-52 Stratofortress', E3TF: 'Boeing E-3 Sentry', E3CF: 'Boeing E-3 Sentry', U2: 'Lockheed U-2', MD11: 'McDonnell Douglas MD-11', B742: 'Boeing 747-200',
  DC3: 'Douglas DC-3', SPIT: 'Supermarine Spitfire', P51: 'North American P-51 Mustang', LANC: 'Avro Lancaster', B17: 'Boeing B-17 Flying Fortress', CONC: 'Concorde'
};
export const HEAVY = new Set(['A332', 'A333', 'A338', 'A339', 'A359', 'A35K', 'A388', 'A306', 'A310', 'A343', 'A346', 'B762', 'B763', 'B764', 'B772',
  'B77W', 'B77L', 'B773', 'B779', 'B788', 'B789', 'B78X', 'B744', 'B748', 'B74F', 'C17', 'A400', 'K35R']);
export const HELI = new Set(['EC35', 'EC45', 'A139', 'A169', 'S92', 'R44', 'AS50']);
// Aircraft worth an alert when they come near. Military and "interesting" also come from the feed's dbFlags.
export const RARE = { A388: 'A380 superjumbo', B748: 'Boeing 747-8', B744: 'Boeing 747-400', B742: 'Boeing 747-200', B74F: '747 freighter', A124: 'Antonov An-124',
  A225: 'Antonov An-225', A3ST: 'Airbus Beluga', A337: 'Airbus BelugaXL', IL76: 'Ilyushin Il-76', C5M: 'C-5 Galaxy', B52: 'B-52 bomber', E3TF: 'AWACS radar plane',
  E3CF: 'AWACS radar plane', U2: 'U-2 spy plane', B779: 'Boeing 777X', MD11: 'MD-11 trijet', DC3: 'Vintage DC-3', SPIT: 'Spitfire', P51: 'P-51 Mustang',
  LANC: 'Lancaster bomber', B17: 'B-17 Flying Fortress', C17: 'C-17 Globemaster', A400: 'Airbus A400M', K35R: 'KC-135 tanker' };
export const rareOf = f => RARE[f.type] || (f.mil ? 'Military' : f.odd ? 'Unusual aircraft' : null);
export const CATS = { A1: 'Light', A2: 'Small', A3: 'Large', A4: 'Boeing 757 class', A5: 'Heavy', A6: 'High performance', A7: 'Rotorcraft', B1: 'Glider', B2: 'Balloon', B4: 'Ultralight', B6: 'Drone' };

/** Airports used to lay out runways and simulated traffic. [icao, iata, name, lat, lon, landing heading (true), runway km] */
export const AIRPORTS = [
  ['EIDW', 'DUB', 'Dublin', 53.4213, -6.2701, 278, 2.64], ['EINN', 'SNN', 'Shannon', 52.7020, -8.9248, 238, 3.2], ['EICK', 'ORK', 'Cork', 51.8413, -8.4911, 343, 2.1],
  ['EGLL', 'LHR', 'London Heathrow', 51.4700, -0.4543, 270, 3.9], ['EGKK', 'LGW', 'London Gatwick', 51.1537, -0.1821, 258, 3.3], ['EGSS', 'STN', 'London Stansted', 51.8850, 0.2350, 220, 3.05],
  ['EGCC', 'MAN', 'Manchester', 53.3537, -2.2750, 231, 3.05], ['EGPH', 'EDI', 'Edinburgh', 55.9500, -3.3725, 237, 2.56], ['EGAA', 'BFS', 'Belfast', 54.6575, -6.2158, 247, 2.78],
  ['EHAM', 'AMS', 'Amsterdam', 52.3105, 4.7683, 238, 3.5], ['LFPG', 'CDG', 'Paris CDG', 49.0097, 2.5479, 265, 4.2], ['EDDF', 'FRA', 'Frankfurt', 50.0379, 8.5622, 249, 4.0],
  ['EDDM', 'MUC', 'Munich', 48.3538, 11.7861, 262, 4.0], ['LEMD', 'MAD', 'Madrid', 40.4983, -3.5676, 323, 4.1], ['LIRF', 'FCO', 'Rome Fiumicino', 41.8003, 12.2389, 250, 3.9],
  ['LSZH', 'ZRH', 'Zurich', 47.4582, 8.5555, 275, 3.3], ['EKCH', 'CPH', 'Copenhagen', 55.6180, 12.6508, 222, 3.3], ['LTFM', 'IST', 'Istanbul', 41.2753, 28.7519, 355, 4.1],
  ['KJFK', 'JFK', 'New York JFK', 40.6413, -73.7781, 311, 3.7], ['KEWR', 'EWR', 'Newark', 40.6895, -74.1745, 222, 3.4], ['KBOS', 'BOS', 'Boston', 42.3656, -71.0096, 318, 3.0],
  ['KORD', 'ORD', 'Chicago O\'Hare', 41.9742, -87.9073, 270, 3.9], ['KATL', 'ATL', 'Atlanta', 33.6407, -84.4277, 270, 3.6], ['KLAX', 'LAX', 'Los Angeles', 33.9416, -118.4085, 250, 3.7],
  ['KSFO', 'SFO', 'San Francisco', 37.6213, -122.3790, 298, 3.6], ['KSEA', 'SEA', 'Seattle', 47.4502, -122.3088, 180, 3.6], ['CYYZ', 'YYZ', 'Toronto', 43.6777, -79.6248, 237, 3.4],
  ['OMDB', 'DXB', 'Dubai', 25.2532, 55.3657, 299, 4.0], ['OTHH', 'DOH', 'Doha', 25.2731, 51.6081, 334, 4.8], ['OMAA', 'AUH', 'Abu Dhabi', 24.4330, 54.6511, 313, 4.1],
  ['VABB', 'BOM', 'Mumbai', 19.0896, 72.8656, 268, 3.4], ['VIDP', 'DEL', 'Delhi', 28.5562, 77.1000, 283, 4.4], ['VOBL', 'BLR', 'Bengaluru', 13.1986, 77.7066, 270, 4.0],
  ['VOMM', 'MAA', 'Chennai', 12.9941, 80.1709, 250, 3.7], ['VOHS', 'HYD', 'Hyderabad', 17.2403, 78.4294, 270, 4.3], ['VAPO', 'PNQ', 'Pune', 18.5821, 73.9197, 280, 2.5],
  ['VECC', 'CCU', 'Kolkata', 22.6547, 88.4467, 197, 3.6], ['WSSS', 'SIN', 'Singapore', 1.3644, 103.9915, 200, 4.0], ['VHHH', 'HKG', 'Hong Kong', 22.3080, 113.9185, 253, 3.8],
  ['RJTT', 'HND', 'Tokyo Haneda', 35.5494, 139.7798, 337, 3.0], ['RKSI', 'ICN', 'Seoul Incheon', 37.4602, 126.4407, 334, 3.75], ['YSSY', 'SYD', 'Sydney', -33.9399, 151.1753, 335, 3.96],
  ['NZAA', 'AKL', 'Auckland', -37.0082, 174.7850, 232, 3.6], ['FACT', 'CPT', 'Cape Town', -33.9715, 18.6021, 1, 3.2], ['SBGR', 'GRU', 'São Paulo', -23.4356, -46.4731, 272, 3.7]
];

export const PLACES = [
  { name: 'Dublin, Ireland', lat: 53.3498, lon: -6.2603 },
  { name: 'London Heathrow', lat: 51.4700, lon: -0.4543 },
  { name: 'Amsterdam', lat: 52.3676, lon: 4.9041 },
  { name: 'New York', lat: 40.7128, lon: -74.0060 },
  { name: 'Dubai', lat: 25.2048, lon: 55.2708 },
  { name: 'Mumbai', lat: 19.0760, lon: 72.8777 },
  { name: 'Delhi', lat: 28.6139, lon: 77.2090 },
  { name: 'Singapore', lat: 1.3521, lon: 103.8198 },
  { name: 'Tokyo', lat: 35.6762, lon: 139.6503 },
  { name: 'Sydney', lat: -33.8688, lon: 151.2093 },
  { name: 'Los Angeles', lat: 34.0522, lon: -118.2437 }
];

export const typeName = f => TYPES[f.type] || (f.desc ? f.desc.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()) : (f.type || 'Unknown type'));
export const airlineCode = cs => { const p = (cs || '').slice(0, 3).toUpperCase(); return /^[A-Z]{3}$/.test(p) && /\d/.test((cs || '').slice(3, 5)) ? p : null; };
export const airlineName = cs => AIRLINES[airlineCode(cs)] || null;
export const isEmergency = f => f.squawk === '7700' || f.squawk === '7600' || f.squawk === '7500';

/* ---------------- network ---------------- */
async function getJSON(url, opts = {}, ms = 8000) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(tm); }
}

// Community ADS-B networks serving the readsb "v2" JSON format. Browsers block direct requests to them
// (no CORS headers), so Squawk first tries a same-origin relay (vercel.json / _redirects rewrite these paths),
// then an optional relay URL (e.g. the Cloudflare Worker in /worker), then the networks directly.
// max is the biggest radius (nm) each network answers; only ADSB.lol serves continent-sized areas for the globe view.
const DIRECT = [
  { name: 'ADSB.lol', max: 6000, relay: 'api/adsb', url: (la, lo, nm) => `https://api.adsb.lol/v2/lat/${la}/lon/${lo}/dist/${nm}`, path: (la, lo, nm) => `lat/${la}/lon/${lo}/dist/${nm}` },
  { name: 'airplanes.live', max: 250, relay: 'api/apl', url: (la, lo, nm) => `https://api.airplanes.live/v2/point/${la}/${lo}/${nm}`, path: (la, lo, nm) => `point/${la}/${lo}/${nm}` },
  { name: 'adsb.fi', max: 250, relay: 'api/adsbfi', url: (la, lo, nm) => `https://opendata.adsb.fi/api/v2/lat/${la}/lon/${lo}/dist/${nm}`, path: (la, lo, nm) => `lat/${la}/lon/${lo}/dist/${nm}` }
];
export const feedConfig = { relayUrl: '' };
const dead = new Set();
function sources() {
  const out = [];
  if (location.protocol.startsWith('http')) for (const p of DIRECT) out.push({ key: 'same:' + p.name, name: p.name, max: p.max, make: (a, b, c) => `${p.relay}/${p.path(a, b, c)}` });
  const r = (feedConfig.relayUrl || '').trim();
  if (r) for (const p of DIRECT) out.push({ key: 'relay:' + p.name, name: p.name + ' via relay', max: p.max, make: (a, b, c) => `${r}${r.includes('?') ? '&' : '?'}url=${encodeURIComponent(p.url(a, b, c))}` });
  for (const p of DIRECT) out.push({ key: 'direct:' + p.name, name: p.name, max: p.max, make: p.url });
  return out.filter(s => !dead.has(s.key));
}
let lastGood = null;
export const resetFeedSources = () => { dead.clear(); lastGood = null; };
export async function fetchAircraft(lat, lon, nm) {
  // sources that can serve the whole radius first, then the one that worked last time
  const rank = s => (s.max >= nm ? 0 : 2) + (s.key === lastGood ? 0 : 1);
  const list = sources().sort((a, b) => rank(a) - rank(b));
  let lastErr;
  for (const s of list) {
    try {
      const r = await fetch(s.make(lat.toFixed(4), lon.toFixed(4), Math.min(nm, s.max)), { cache: 'no-store', signal: AbortSignal.timeout ? AbortSignal.timeout(nm > 500 ? 25000 : 8000) : undefined });
      const ct = r.headers.get('content-type') || '';
      if (r.status === 429) throw Object.assign(new Error('rate limited'), { rate: true });
      if (!r.ok || !ct.includes('json')) { if ([401, 403, 404, 405].includes(r.status) || !ct.includes('json')) dead.add(s.key); throw new Error('HTTP ' + r.status); }
      const j = await r.json(); const ac = j.ac || j.aircraft;
      if (!Array.isArray(ac)) throw new Error('bad payload');
      lastGood = s.key; return { list: ac, provider: s.name };
    } catch (e) { lastErr = e; if (e instanceof TypeError && s.key.startsWith('direct:')) dead.add(s.key); }
  }
  throw lastErr || new Error('no provider');
}

// Routes from adsbdb.com (CORS-enabled), one callsign at a time, cached and throttled.
const routeCache = new Map(), routeQueue = []; let routeBusy = false;
export const getRoute = cs => routeCache.get(cs);
export function wantRoutes(callsigns) {
  for (const cs of callsigns) if (cs && /\d/.test(cs) && !routeCache.has(cs) && !routeQueue.includes(cs)) routeQueue.push(cs);
  if (routeQueue.length > 40) routeQueue.splice(0, routeQueue.length - 40);
  pumpRoutes();
}
async function pumpRoutes() {
  if (routeBusy) return; routeBusy = true;
  while (routeQueue.length) {
    const cs = routeQueue.shift(); if (routeCache.has(cs)) continue;
    routeCache.set(cs, null);
    try {
      const j = await getJSON(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`, {}, 7000);
      const fr = j.response && j.response.flightroute;
      if (fr && fr.origin && fr.destination) {
        const ap = a => ({ iata: a.iata_code || a.icao_code, name: a.municipality || a.name, lat: a.latitude, lon: a.longitude });
        routeCache.set(cs, { from: ap(fr.origin), to: ap(fr.destination), airline: fr.airline && fr.airline.name });
      }
    } catch (e) { /* unknown callsign or service unavailable */ }
    await new Promise(r => setTimeout(r, 350));
  }
  routeBusy = false;
}

const photoCache = new Map();
export async function fetchPhoto(hex) {
  if (!hex) return null;
  if (photoCache.has(hex)) return photoCache.get(hex);
  let out = null;
  try {
    const j = await getJSON(`https://api.planespotters.net/pub/photos/hex/${hex}`, {}, 7000);
    const p = j.photos && j.photos[0];
    if (p) out = { src: (p.thumbnail_large || p.thumbnail).src, link: p.link, by: p.photographer };
  } catch (e) { out = null; }
  photoCache.set(hex, out);
  return out;
}

// pressure levels for the contrail forecast, roughly FL180 to FL450
export const LEVELS = [500, 400, 300, 250, 200, 150];
export async function fetchWeather(lat, lon) {
  const lv = LEVELS.map(p => `temperature_${p}hPa,relative_humidity_${p}hPa`).join(',');
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
    + '&current=temperature_2m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,wind_speed_10m,wind_direction_10m,weather_code,is_day'
    + `&hourly=wind_speed_250hPa,wind_direction_250hPa,${lv}&daily=sunrise,sunset&timezone=auto&forecast_days=1&wind_speed_unit=kmh`;
  const j = await getJSON(u, {}, 9000);
  const c = j.current || {};
  let jet = null, levels = null;
  if (j.hourly && j.hourly.time) {
    const hr = (c.time || '').slice(0, 13);
    let i = j.hourly.time.findIndex(t => t.slice(0, 13) === hr); if (i < 0) i = 0;
    jet = { speed: j.hourly.wind_speed_250hPa?.[i], dir: j.hourly.wind_direction_250hPa?.[i] };
    levels = LEVELS.map(p => ({ p, T: j.hourly[`temperature_${p}hPa`]?.[i], rh: j.hourly[`relative_humidity_${p}hPa`]?.[i] })).filter(l => l.T != null && l.rh != null);
  }
  return { ...c, jet, levels, sunrise: j.daily?.sunrise?.[0], sunset: j.daily?.sunset?.[0], tz: j.timezone, utcOffset: j.utc_offset_seconds };
}

export async function geocode(q) {
  const j = await getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } });
  return j.map(r => ({ name: r.display_name.split(',').slice(0, 2).join(','), full: r.display_name, lat: +r.lat, lon: +r.lon }));
}
export async function reverseGeocode(lat, lon) {
  try {
    const j = await getJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${lat}&lon=${lon}`, { headers: { 'Accept-Language': 'en' } });
    const a = j.address || {};
    const place = a.city || a.town || a.village || a.suburb || a.county || j.name;
    return [place, a.country].filter(Boolean).join(', ') || 'Your location';
  } catch (e) { return 'Your location'; }
}

export const WMO = {
  0: 'Clear sky', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle',
  55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow',
  75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail'
};
