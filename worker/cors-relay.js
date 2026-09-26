// Cloudflare Worker: a tiny CORS relay for the ADS-B networks Squawk reads.
// Deploy it (free) and paste its URL into Squawk's layers menu, or open Squawk with ?relay=<worker-url>.
// Only the three flight-data hosts below are allowed, so it can't be used as an open proxy.
const ALLOW = new Set(['api.adsb.lol', 'api.airplanes.live', 'opendata.adsb.fi']);
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' };

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS });
    let target;
    try { target = new URL(new URL(request.url).searchParams.get('url')); }
    catch { return new Response('Add ?url=<flight data URL>', { status: 400, headers: CORS }); }
    if (target.protocol !== 'https:' || !ALLOW.has(target.hostname)) return new Response('Host not allowed', { status: 403, headers: CORS });
    const upstream = await fetch(target.toString(), { headers: { 'User-Agent': 'squawk-relay (+https://github.com/SairajBandre16/SQUAWK)' } });
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    headers.set('Cache-Control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers });
  }
};
