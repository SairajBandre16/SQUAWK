# CLAUDE.md

This file gives Claude Code guidance for working in this repository.

## What this is

Squawk is a static, no-build, browser-only 3D plane-spotting app. It shows live ADS-B aircraft around a chosen location over satellite imagery, with a real sun position, live-weather clouds and a "where to look" dial. When no live feed is reachable it falls back to simulated traffic.

- Plain ES modules, no bundler, no `package.json`, no tests, no linter.
- three.js r170 and satellite.js 6 load from jsDelivr through the import map in `index.html` (`three`, `three/addons/`, `satellite.js`).
- Fonts load from Google Fonts. Everything else is local.

## Running

```bash
python serve.py          # http://localhost:8000 (serves the site and relays the ADS-B feeds)
python serve.py 9000     # another port
```

Opening `index.html` from `file://` does not work: ES modules and the feed relay need HTTP. Geolocation needs `https://` or `localhost`.

Debug hooks in the browser console: `window.__squawk` exposes `{ world, S, ingest, step }`. `ingest(list)` accepts readsb v2 aircraft objects and switches the app into live mode. `step(n, dt)` runs n frames by hand. Use it when testing in a background tab, where Chrome pauses `requestAnimationFrame` and heavily throttles timers and image decode.

`serve.py` sends `Cache-Control: no-cache`, so a plain reload picks up edited modules.

## Deployment and the live feed

The ADS-B networks send no CORS headers, so the browser cannot call them directly from another origin. The app tries feed sources in this order (`sources()` in `js/data.js`):

1. Same-origin relay paths `api/adsb/...`, `api/apl/...`, `api/adsbfi/...`. These paths are rewritten by `vercel.json` (Vercel), `_redirects` (Netlify) and `serve.py` (local).
2. An optional relay URL (`?relay=<url>` query param, or the "Live feed" field in the layers popover, saved in localStorage). `worker/cors-relay.js` is a Cloudflare Worker for this. It takes `?url=<target>` and allows only the three ADS-B hosts.
3. The networks directly (these usually fail with CORS).

Sources that return 401/403/404/405, a 2xx that isn't JSON, or throw a network `TypeError` on a direct call, go into a `dead` set and are skipped until `resetFeedSources()` (called on relay save and before every sim retry). A 5xx is retried next poll. A 429 throws an error with `rate: true`, and the poll backs off instead of counting a failure. A `?relay=` URL lasts for the visit only and must be https. Each provider has a `max` radius: ADSB.lol answers up to about 6000 nm, while airplanes.live and adsb.fi stop at 250 nm. Sources that can serve the whole radius are tried first, then the last one that worked. As of Sept 2026, airplanes.live returns 403 to unapproved clients.

When you add or change an ADS-B provider, update all four places together: `DIRECT` in `js/data.js`, `vercel.json`, `_redirects`, `RELAYS` in `serve.py`, and `ALLOW` in `worker/cors-relay.js`.

Other services are called straight from the browser (they allow CORS): adsbdb.com (routes), Planespotters (photos), Open-Meteo (weather), Nominatim (geocoding), Esri (imagery and the borders-and-places overlay), CARTO (map tiles) and NASA GIBS Black Marble (city lights).

## Architecture

```
index.html        UI shell: all DOM for top bar, popovers, panel, flight card, HUD, explore pill. Import map.
css/style.css     Glass UI. Theme tokens on :root; html[data-sky="night"] swaps them.
js/main.js        App controller: state, feed polling, labels, card, tabs/panels, badges, frame loop.
js/world.js       World class: scene, floating origin, sky/sun, home group (pin, rings, runways, clouds), aircraft, trails, globe camera, input.
js/globe.js       Globe class: streaming web-mercator tiles on a sphere (quadtree LOD), names and night-light overlays, ocean, ice caps, atmosphere.
js/data.js        Reference tables (airlines, types, airports, places) and all network calls.
js/sim.js         Sim class: simulated arrivals, departures and overflights around the nearest airport.
js/predict.js     closestApproach(), transits() with the ground centreline, contrailAt() (Schmidt-Appleman) and pressureAt().
js/sats.js        Sats class: CelesTrak elements (cached 6 h in localStorage), SGP4 positions, sunlit test, visible-pass search.
js/models.js      Ten low-poly model families (body + tail fin), modelOf(type, category), LIVERY tail colours by airline.
js/spotter.js     FAMILIES for the collection, levels and XP, daily missions, streak, plainFacts(), silhouettes.
js/geo.js         Local projection (Proj), earth-centred frame helpers, haversine/bearing, relative(), sun position, compass helpers.
```

### Frames, coordinates and units (important)

- **Scene frame.** Units are km in an earth-centred frame: `+y` is the north pole, `+z` is lat 0 / lon 0, `+x` is lat 0 / lon 90E (`unitDir`, `enu`, `toLatLon` in `geo.js`). The earth is a sphere of `EARTH_R = 6371`.
- **Floating origin.** Scene coordinates are ECEF minus `world.O`. `world.frame()` calls `rebase()` when the camera target drifts more than 250 km from O. `rebase()` shifts `O`, the smoothed camera, every `vis.pos` and the home group. Always convert through `world.llToScene(lat, lon, h, out)`. Never cache scene positions across frames without handling a rebase.
- **Home group.** `world.homeGroup` is a local frame at the observer: `+x` east, `+y` up, `-z` north, matching `Proj.toXZ`. The pin, range rings, runways and weather clouds live there and still use `curvDrop()`. Project home-local points with `world.projectHome()`.
- **Flights are lat/lon first.** Every flight has `lat`, `lon`, `alt` (km), `spd` (km/s), `vr` (km/s) and `trk` (degrees true). Live flights have no `x`/`z`. `reckon()` moves them with `step()`. Sim flights keep `x`/`z` in the Sim's `Proj` and write `lat`/`lon` every step.
  - Conversions used in `ingest()`: feet `* 0.0003048`, knots `* 0.000514444`, ft/min `* 0.00000508`.
  - Display helpers in `main.js`: `fmtAlt(km)`, `kt(f)`, `fpm(f)`.
- `relative(f, o)` in `geo.js` gives distance, bearing, elevation and slant range from observer `o` (`{lat0, lon0}`, usually `S.proj`). It is exact on the sphere at any distance. `main.js` wraps it as `rel(f)`.
- Rendered altitude is exaggerated by `world.altScale` (2.2 in orbit and map views, 1.0 in ground view, eased between them). `relative()` uses true altitude.
- **Home vs the rest of the world.** `IN_RANGE = 185` km around home decides what counts: the HUD, board, stats, records, catches, badges and events. Other aircraft are only drawn. A flight is "caught" (`catchFlight`) the first time it comes within range, in `tickRecords()`.

### State and data flow (`js/main.js`)

- `S` is the single app state object: `flights` (a Map by id), `mode` (`boot` | `live` | `sim`), `selId`, `follow`, `tab`, `view`, `weather`, `timeOff`, `events`, `history`, `rec`, `region`, `proj` (home), `sim`.
- `settings` persists to localStorage key `squawk.settings` (place, style, names, clouds, labels, relay). The spotter's log persists to `squawk.log.v2`, but only for live mode. Its `recent` and `seenHex` maps (hex to time, pruned after 12 h) stop the same airframe being caught or "seen" twice across reloads. The first-sighting guide, alerts and "I saw it" only run in live mode.
- Open bugs from the Sept 2026 audit are in `BUGS.md`. What's done and what's next is tracked in `PROGRESS.md`; update it when work lands. Sim-mode catches go to a throwaway `logSim`. All storage goes through the try/catch `store` wrapper.
- `setPlace(p, boot)` moves home: new `Proj`, `world.setHome()`, airports, clear flights, new `Sim`, weather, restart feed. On boot the camera starts in space above home and `world.intro()` flies down once the loader finishes. Later calls fly there.
- **Feed follows the camera.** `region()` picks what to ask for. Looking at home, in ground view, before the loader finishes and whenever the mode isn't `live`, it asks for 100 nm around home every 5 s. `world.focus()`/`viewRadius()` use the `flyTo` target while a flight is under way. Elsewhere it centres on `world.focus()` with a radius from `world.viewRadius()` (100 to 3500 nm) and refreshes every 5, 10 or 30 s. `followView()` runs once a second and polls early when the view has moved or zoomed to a new region. `poll()` is generation-guarded by `feedGen`. On a first failure, or 3 in a row, it switches to `startSim()` and retries every 60 s.
- Live flights: `ingest()` converts readsb v2 JSON to flight objects (id `'h' + hex`, `kind: 'live'`). It drops ground traffic and removes flights not updated for `staleAfter()` (at least 40 s, longer for slow regions).
- Sim flights: `kind` is `arr`, `dep` or `over`. `Sim.step()` moves them and returns `{ spawned, landed, gone }`. Sim flights carry their own `route`; live flights get routes from `D.getRoute(callsign)` (async, queued, cached).
- `frame()` is the requestAnimationFrame loop and calls `tick(dt)`. It steps sim or reckon, calls `world.syncAircraft` and `world.frame`, then updates labels every frame and runs throttled work through the `acc` timers: HUD and explore pill 0.5 s, card 0.3 s, records and `followView` 1 s, history 20 s, board 3 s, stats and log panels 3 s.
- `S.booting` suppresses toasts and events while a batch of flights is added at once. Flights added then are marked `quiet`, so their later catch doesn't toast either.

### Look-ahead, satellites and the hobby layer

- `predictAll()` in `main.js` runs every 2 s over aircraft within about 450 km of home. It sets `f.next` (closest approach), `f.ctr` (contrail state) and `S.pred = { at, over, tr, rare }`, and fires `ping()` alerts once per key (`S.alerted`). Times in `S.pred` are seconds from `S.pred.at`, so subtract the age when displaying.
- Alerts: `ping()` always shows the dark toast and logs an event; the chime, vibration and system notification only happen when `settings.alerts` is on.
- Transit lines are drawn by `world.setTransitLines()` in the home group. The contrail forecast needs the pressure-level fields in `S.weather.levels` (`fetchWeather()` in `data.js`).
- Satellites: `startSats()` loads after the intro; `tickSats()` refreshes positions each second and passes every 30 min; `world.syncSats()` extrapolates between fixes. Satellite coordinates are converted from satellite.js ECF (x lon 0, y lon 90E, z north) to the globe frame (x = ecf.y, y = ecf.z, z = ecf.x).
- Hobby layer: `gain(xp)`, `mission(event)`, `dayRec()` and `sawIt(f)` live in `main.js`; the numbers and definitions are in `spotter.js`. The log (`squawk.log.v2`) now also has `xp`, `seen`, `seenTypes`, `days` and `day`. The first-sighting guide (`coach*`) runs once per browser (`squawk.coach`), and only when a plane is 8° to 75° up within 50 km.

### Rendering (`js/world.js`, `js/globe.js`)

- `World` owns the renderer (logarithmic depth buffer, far plane 90000 km), the EffectComposer with bloom, and camera state in `world.cam`: `lat`, `lon`, `h` (target), `r` (range), `theta` (heading), `phi` (tilt), plus `yaw`, `pitch`, `fov` for ground view. Camera modes are `orbit`, `top` and `ground`. "Globe" is orbit or map zoomed out past about 6000 km; tilt eases to straight down as you zoom out (`effPhi`).
- Camera moves: `flyTo(lat, lon, r, opts)` animates along the great circle, pulling out when the two ends are far apart. `intro()` is the drop from space. `recenter()` flies home. Input depends on zoom (`orbitDrag()`, `ORBIT_R = 700` km): zoomed in, in orbit view, left-drag orbits and tilts and right, shift, ctrl or alt drag pans; zoomed out or in map view it's the other way round. Panning has inertia. The wheel zooms toward the cursor (`groundAt()` ray-sphere hit), double-click zooms in, two fingers pinch, twist and pan.
- **Globe tiles.** `Globe.update()` walks a quadtree from the zoom-1 roots. It culls tiles against the horizon and the frustum, and refines while a tile covers more than `SSE` px. A parent is only replaced once all its visible children are ready, so there are no holes. Loads are capped (`MAX_LOADS`), GPU uploads are capped per frame (`BUILDS_PER_FRAME`), and old tiles are evicted LRU past `MAX_TILES`. Each tile mesh is built relative to its own centre and positioned at `centre - O`.
- Tile shading happens in a shader patch (`patch()` in `globe.js`). It tints by the real sun per fragment (day/night terminator, golden hour), blends the Esri names overlay (zoom 13 and below) and adds Black Marble city lights on the night side. Deeper tiles borrow a corner of an ancestor's overlay image (`bindAux`).
- The ocean sphere sits 30 km and the ice caps 20 km below the surface. Coarse tiles sag between vertices, and a shallower base pokes through as a diamond pattern.
- Sky: the three.js `Sky` box and the star field follow the camera, and `up` is the local vertical. Above about 40 to 260 km the sky fades to space and the atmosphere shells in `globe.js` fade in. Fog thins as you zoom out and is zero in space.
- Aircraft: per model family, one body and one tail `InstancedMesh` (`world.models`), drawn only for aircraft within 3000 km of the camera (or selected). `f.model` and `f.livery` are set by `dress()` in `main.js`. Halo points cover every aircraft (max `MAXP = 9000`), plus nav lights (within 800 km), drop lines and `LineSegments2` trails (nearest `TRAIL_F = 500`, only when `r < 4000`). Per-flight visual state lives in `world.vis`: smoothed scene `pos`, `yaw`, `trail` (unit direction plus altitude, so trails survive a rebase) and `col`.
- Colour encodes altitude through `altColor()` (low amber, mid pink, high blue). Emergencies are red.
- `setSun(date)` computes the sun at home and turns it into one scene-space direction, which is valid for the whole globe. It drives sky, lights, fog colour, globe shading, clouds and bloom. `main.js` then sets `data-sky` to day or night, and the CSS theme follows.
- Picking: `world.onPick(x, y)` is set by `main.js` and does a screen-space nearest search. `world.project()` marks points behind the earth as not visible.

### UI

- All DOM lives in `index.html`. `main.js` looks elements up by id with `$()`.
- Panels (Board, Stats, Weather, Log, Codes) render as HTML strings through `renderPanel()`. Escape all dynamic text with `esc()`.
- The Board is a split-flap display built once in `buildBoard()` and animated per character by `flipTo()`.
- The mobile breakpoint is 760 px, both in CSS and in `main.js`. Below it, the flight card and the tab panel do not show at the same time.

## Conventions

- Dense, compact code style: short names, several statements per line, few comments. Match it.
- No dependencies beyond three.js from the CDN. Do not add a build step unless asked.
- New tile or data sources must send CORS headers (images load with `crossOrigin = 'anonymous'`), or go through the relay.
- Keep user-facing copy plain and friendly. The README and in-app text use British spelling ("colour").
- Network helpers catch their own errors and degrade quietly (a missing photo, route or weather must not break the app).

## Known limits

- With a continent-sized region (3500 nm), ADSB.lol returns 5,000 to 12,000 aircraft and several MB of JSON every 30 s. That is heavy on mobile data. A shared relay IP (Vercel, Netlify, Worker) can also hit ADSB.lol rate limits (429).
- ADSB.lol coverage is thin in some regions (for example, parts of India).
- Weather, clouds, runways, range rings and the contrail forecast exist only around home.
- adsbdb.com routes are keyed by callsign and are sometimes stale; `routeFits()` hides a route the aircraft is nowhere near.
- RainViewer serves radar only up to zoom 7; deeper globe tiles borrow and stretch a zoom-7 image.
