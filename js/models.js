// Low-poly aircraft models, one per family, built from primitives. Nose points to -z, up is +y, length is about 1.
// Each model has a body and a separate tail fin, so the fin can wear the airline's colour.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const shear = (g, k) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + Math.abs(p.getX(i)) * k); return g; };
const fuselage = (r, len, ry = 1) => [
  new THREE.CylinderGeometry(r * 0.8, r, len, 14).rotateX(Math.PI / 2).scale(1, ry, 1),
  new THREE.ConeGeometry(r, len * 0.17, 14).rotateX(-Math.PI / 2).scale(1, ry, 1).translate(0, 0, -len * 0.585),
  new THREE.ConeGeometry(r * 0.8, len * 0.12, 14).rotateX(Math.PI / 2).scale(1, ry, 1).translate(0, r * 0.2, len * 0.56)
];
const wing = (span, chord, sweep, y, z) => shear(new THREE.BoxGeometry(span, 0.018, chord), sweep).translate(0, y, z);
const engines = (xs, r, len, y, z) => xs.map(x => new THREE.CylinderGeometry(r, r * 0.88, len, 10).rotateX(Math.PI / 2).translate(x, y, z));
const props = (xs, r, y, z) => xs.map(x => new THREE.CylinderGeometry(r, r, 0.006, 16).rotateX(Math.PI / 2).translate(x, y, z));
const fin = (h, chord, z, y0) => { const g = new THREE.BoxGeometry(0.014, h, chord).translate(0, y0 + h / 2, z), p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + (p.getY(i) - y0) * 0.7); return g; };
const done = parts => { const g = mergeGeometries(parts.map(x => x.toNonIndexed())); g.computeVertexNormals(); return g; };

const SPEC = {
  // twin-engine narrowbody: A320, 737, E-jets
  narrow: { size: 0.85, build: () => ({ body: [...fuselage(0.05, 1), wing(1.02, 0.17, 0.32, -0.015, -0.02), shear(new THREE.BoxGeometry(0.36, 0.014, 0.085), 0.35).translate(0, 0.02, 0.43), ...engines([0.23, -0.23], 0.034, 0.15, -0.055, -0.06)], tail: fin(0.19, 0.13, 0.46, 0.01) }) },
  // twin-engine widebody: A330, A350, 777, 787
  wide: { size: 1.1, build: () => ({ body: [...fuselage(0.065, 1), wing(1.12, 0.19, 0.36, -0.025, -0.02), shear(new THREE.BoxGeometry(0.4, 0.015, 0.09), 0.38).translate(0, 0.025, 0.43), ...engines([0.25, -0.25], 0.05, 0.18, -0.075, -0.07)], tail: fin(0.22, 0.14, 0.46, 0.02) }) },
  // four engines, low wing: A340, KC-135
  quad: { size: 1.1, build: () => ({ body: [...fuselage(0.062, 1), wing(1.12, 0.19, 0.36, -0.025, -0.02), shear(new THREE.BoxGeometry(0.4, 0.015, 0.09), 0.38).translate(0, 0.025, 0.43), ...engines([0.19, -0.19, 0.36, -0.36], 0.036, 0.15, -0.065, -0.05)], tail: fin(0.21, 0.14, 0.46, 0.02) }) },
  // 747: four engines and the hump
  jumbo: { size: 1.2, build: () => ({ body: [...fuselage(0.068, 1), new THREE.CapsuleGeometry(0.05, 0.22, 6, 12).rotateX(Math.PI / 2).scale(1, 0.9, 1).translate(0, 0.05, -0.3), wing(1.1, 0.2, 0.4, -0.03, -0.01), shear(new THREE.BoxGeometry(0.42, 0.015, 0.09), 0.4).translate(0, 0.025, 0.43), ...engines([0.2, -0.2, 0.37, -0.37], 0.04, 0.15, -0.075, -0.05)], tail: fin(0.24, 0.15, 0.45, 0.02) }) },
  // A380: tall double-deck body, four engines
  a380: { size: 1.25, build: () => ({ body: [...fuselage(0.07, 1, 1.28), wing(1.2, 0.24, 0.34, -0.04, 0), shear(new THREE.BoxGeometry(0.44, 0.016, 0.1), 0.4).translate(0, 0.03, 0.43), ...engines([0.21, -0.21, 0.38, -0.38], 0.043, 0.16, -0.085, -0.03)], tail: fin(0.25, 0.17, 0.45, 0.04) }) },
  // turboprop with a high wing and T-tail: ATR, Dash 8
  prop: { size: 0.6, build: () => ({ body: [...fuselage(0.048, 1), wing(1.12, 0.11, 0.02, 0.045, -0.06), ...engines([0.2, -0.2], 0.028, 0.16, 0.035, -0.12), ...props([0.2, -0.2], 0.1, 0.035, -0.205), new THREE.BoxGeometry(0.36, 0.013, 0.07).translate(0, 0.21, 0.58)], tail: fin(0.2, 0.12, 0.45, 0.01) }) },
  // rear engines and T-tail: CRJ and business jets
  rear: { size: 0.55, build: () => ({ body: [...fuselage(0.045, 1), wing(0.9, 0.15, 0.3, -0.02, 0.02), ...engines([0.085, -0.085], 0.03, 0.14, 0.035, 0.3), new THREE.BoxGeometry(0.34, 0.012, 0.08).translate(0, 0.2, 0.58)], tail: fin(0.19, 0.13, 0.46, 0.02) }) },
  // light single: Cessna, Piper
  light: { size: 0.35, build: () => ({ body: [...fuselage(0.055, 0.85), wing(1.1, 0.13, 0, 0.055, -0.1), ...props([0], 0.13, 0, -0.5), new THREE.BoxGeometry(0.34, 0.012, 0.09).translate(0, 0.02, 0.36)], tail: fin(0.15, 0.13, 0.36, 0.02) }) },
  // four props or engines on a high wing: C-130, A400M, C-17, An-124
  lifter: { size: 1.1, build: () => ({ body: [...fuselage(0.07, 1), wing(1.1, 0.17, 0.12, 0.06, -0.02), ...engines([0.2, -0.2, 0.36, -0.36], 0.03, 0.14, 0.04, -0.08), new THREE.BoxGeometry(0.4, 0.014, 0.09).translate(0, 0.25, 0.6)], tail: fin(0.24, 0.16, 0.44, 0.02) }) },
  // helicopter: pod, boom and rotor
  heli: { size: 0.4, build: () => ({ body: [new THREE.SphereGeometry(0.1, 14, 10).scale(0.9, 0.9, 1.5), new THREE.CylinderGeometry(0.02, 0.03, 0.5, 8).rotateX(Math.PI / 2).translate(0, 0.02, 0.35), new THREE.BoxGeometry(0.9, 0.006, 0.035).translate(0, 0.12, 0), new THREE.BoxGeometry(0.035, 0.006, 0.9).translate(0, 0.12, 0), new THREE.CylinderGeometry(0.012, 0.012, 0.05, 6).translate(0, 0.095, 0)], tail: fin(0.1, 0.07, 0.58, 0) }) }
};
export const MODELS = Object.keys(SPEC);
export const modelSize = k => SPEC[k].size;
export function modelGeometry(k) { const m = SPEC[k].build(); return { body: done(m.body), tail: done([m.tail]) }; }

const T = s => new Set(s.split(' '));
const SETS = {
  a380: T('A388 A389'), jumbo: T('B741 B742 B743 B744 B748 B74F B74S B74R BLCF'), quad: T('A342 A343 A345 A346 K35R E3TF E3CF B703 DC8'),
  wide: T('A306 A30B A310 A332 A333 A337 A338 A339 A359 A35K A3ST B762 B763 B764 B772 B773 B77L B77W B778 B779 B788 B789 B78X MD11 DC10 L101 IL96'),
  lifter: T('C17 C130 C30J A400 IL76 A124 A225 C5M C295 CN35 P3 P8 AN12 KC39'),
  prop: T('AT43 AT44 AT45 AT46 AT72 AT75 AT76 DH8A DH8B DH8C DH8D SF34 SB20 E120 J41 D328 F50 B350 BE20 BE9L L410 DHC6 JS32'),
  rear: T('CRJ1 CRJ2 CRJ7 CRJ9 CRJX F100 F70 MD80 MD81 MD82 MD83 MD87 MD88 MD90 B712 C25A C25B C25C C510 C525 C550 C560 C56X C650 C680 C68A C700 C750 CL30 CL35 CL60 GLF4 GLF5 GLF6 GL5T GL7T GLEX F2TH F900 FA7X FA8X FA50 PC24 E50P E55P LJ35 LJ45 LJ60 LJ75 H25B HA4T PRM1 E545 E550 G280'),
  light: T('C150 C152 C162 C172 C177 C180 C182 C206 C208 C210 PA18 PA22 PA24 PA28 PA32 PA34 PA44 PA46 P28A P28B P32R SR20 SR22 DA20 DA40 DA42 DA62 PC12 TBM7 TBM8 TBM9 M20P BE33 BE35 BE36 BE58 AA5 RV7 RV8 RV10 G115 TB20 P68 DR40 SPIT P51 DC3'),
  heli: T('EC20 EC25 EC30 EC35 EC45 EC55 EC75 H160 A109 A119 A139 A169 A189 AS32 AS50 AS55 AS65 S61 S76 S92 R22 R44 R66 B06 B407 B412 B429 B505 NH90 UH60 H60 EH10 MI8 LYNX CH47 H47')
};
/** Which model to draw for a flight, from its ICAO type or else its ADS-B emitter category. */
export function modelOf(type, cat) {
  for (const k in SETS) if (SETS[k].has(type)) return k;
  return cat === 'A7' ? 'heli' : cat === 'A1' ? 'light' : cat === 'A2' ? 'rear' : cat === 'A5' ? 'wide' : 'narrow';
}

// Tail colours, loosely after each airline's livery.
export const LIVERY = {
  RYR: '#073590', RUK: '#073590', MAY: '#073590', EIN: '#00843D', BAW: '#1C3F94', SHT: '#1C3F94', CFE: '#1C3F94', EFW: '#1C3F94', EZY: '#FF6600', EJU: '#FF6600', EZS: '#FF6600',
  KLM: '#00A1DE', DLH: '#05164D', AFR: '#002157', UAL: '#0033A0', DAL: '#C8102E', AAL: '#B6202E', SWA: '#304CB2', JBU: '#0033A0', ASA: '#01426A', NKS: '#FFE600', FFT: '#2E7D32',
  HAL: '#6D2077', UAE: '#D71921', QTR: '#5C0632', ETD: '#BD8B13', FDB: '#F37021', SVA: '#0F5F3A', ACA: '#1A1A1A', WJA: '#00A1AB', VIR: '#E10A0A', ICE: '#1A2957', SAS: '#1C2B5A',
  FIN: '#0B1560', THY: '#C70A0C', PGT: '#FFB81C', LOG: '#1B2A48', ABR: '#0C4DA2', VLG: '#FFCC00', IBE: '#D7192D', AEA: '#0E4A8C', WZZ: '#C6007E', WUK: '#C6007E', EXS: '#E4032E',
  TOM: '#6ACBFF', TAP: '#E32121', SWR: '#E2001A', AUA: '#E2001A', EWG: '#8C1F5A', BEL: '#0A2C5A', LOT: '#11397E', NAX: '#D81939', NSZ: '#D81939', ITY: '#1E4FA0', AIC: '#E31E24',
  AXB: '#E87722', IGO: '#1A1A7E', AKJ: '#FF5C39', SEJ: '#E21F26', VTI: '#5A2A57', SIA: '#1D4886', CPA: '#006564', ANA: '#13448F', JAL: '#E60012', KAL: '#6EB5E6', AAR: '#C8A15C',
  CCA: '#E30613', CES: '#1A3E8C', CSN: '#0072BC', THA: '#5B2C83', MAS: '#0033A0', AXM: '#E31837', QFA: '#E0001B', VOZ: '#C8102E', JST: '#FF5A00', ANZ: '#111111', ETH: '#2E8B3E',
  MSR: '#1B3A6B', RAM: '#C8102E', SAA: '#0B3D91', KQA: '#C8102E', ELY: '#0B2F6B', LAN: '#1B0088', TAM: '#1B0088', AVA: '#DA291C', AMX: '#0B2343', FDX: '#4D148C', UPS: '#351C15',
  DHK: '#FFCC00', BCS: '#FFCC00', GTI: '#1B365D', CLX: '#00A0DD', RCH: '#5B6770', CTN: '#0A3A7A', AEE: '#0B2A5B', SXS: '#F6A800', CND: '#FFD700', EDW: '#C8102E', AZU: '#0033A0', GLO: '#FF6B00'
};
