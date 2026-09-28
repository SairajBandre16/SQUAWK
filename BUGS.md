# Known bugs and glitches

This is the backlog from a full audit on 27 Sept 2026. Six reviewers each looked at Squawk as a different kind of user: a newcomer on a phone, someone on a flaky network, a globe explorer, a daily hobby spotter, someone using the look-ahead features in unusual places, and a security and scale review.

The most urgent issues were fixed straight away (see "Fixed" at the end). Everything else is listed here, most severe first. Code is referred to by function name, because line numbers drift.

## High

- **Transit "hit" misses real dead-centre crossings** (`transits()` in `predict.js`). Sampling every 3 s moves a jet 2 to 14° across the sky between samples, so only about 7 in 30 centreline crossings are flagged. The card can then say "Move 0 m west". Use `move.d < width` for `hit`, or refine around the best sample.
- **The moon position is off by up to 2.5°** (`moonPosition` in `geo.js`). It uses the short SunCalc series with no evection or variation terms, which is several disc widths. Every moon-transit alert is unreliable until it uses a fuller series (Meeus ch. 47).
- **The transit centreline is tens of km off with a low sun** (`transits()`). The ground line is flat-earth but the look angles use a curved earth: about 42 km out at 3° sun elevation and 7 km at 6°. There is no refraction either.
- **iOS zooms the page when place search opens.** The input font is 15px, and iOS zooms any input under 16px. The canvas's `touch-action:none` makes the zoom hard to undo. Set inputs to 16px.
- **Screen readers are flooded.** `aria-live` is set on `#panel` and `#card`, which are rewritten every 0.3 to 3 s.
- **A slow link in globe view can still fall back to sim.** A 3500 nm request that times out 3 times starts the sim. The sim retry now asks for home, so it recovers, but once live again, zooming out can repeat the cycle. The timeout should shrink the region instead of counting as a failure.

## Medium

### Feed and network
- A hung network costs 8 s per source, tried one after another, so an outage takes about a minute to detect. `restartFeed()` doesn't abort the in-flight fetch, so the orphaned download keeps using data.
- Satellite loading has no timeout (`Sats.load`). A hung request leaves `loading` true for good, and a failed fetch ignores the stale cache.
- `Sats.predict` has no generation guard, so a quick place change can show passes for the old place.
- Orbital elements are never refreshed within a session (`startSats` returns once `ready`).
- `serve.py` still binds to all network interfaces, so the relay is open to the LAN. Consider `127.0.0.1` by default with a `--lan` flag.
- The relays (Worker, Vercel, Netlify) are open proxies with no Origin check or rate limit. The Worker has no try/catch, so an upstream failure returns a 500 without CORS headers.
- The relays pass the upstream `Content-Type` through and don't send `nosniff`.
- There is no CSP, `frame-ancestors`/X-Frame-Options or Referrer-Policy, and no integrity hashes on the CDN imports.

### Rendering and camera
- Per-frame work is heavy at 12k aircraft. Each frame spreads the flights Map into a new array, runs `reckon` on everything, builds a new `Set` in `syncAircraft` and parses a colour string for each plane.
- Ground-view labels scan and sort every aircraft each frame (`updateLabels`, `lim = Infinity`).
- Trails store one JS object per point: hundreds of thousands of objects churned each second in wide regions.
- `MAXP = 9000` cuts aircraft by Map insertion order. Newly arrived (often nearby) planes are hidden, and a selected flight past the cap silently stops being followed.
- After a floating-origin shift, aircraft and satellites are drawn in the wrong place for one frame. The buffers are filled before `rebase()` runs in `world.frame()`.
- Stars are drawn over the globe from space. The star sphere has an 8000 km radius and is transparent with depth test on, so it is nearer than the earth above 8000 km.
- Lighting, fog, stars and exposure follow home's sun, not the sun where you're looking.
- `setTransitLines()` disposes and rebuilds its materials every 2 s, which forces a shader recompile.
- Runways and range rings drift off the imagery (flat `Proj` vs sphere): about 2.8 km off at 150 km, and 6.6 km at 200 km at 60°N.
- Lifting one finger after a three-finger touch makes the view jump. After a pinch, the remaining finger can't pan.

### Look-ahead
- Vertical rate is extrapolated linearly for up to 15 minutes. Arrivals are predicted at 0 altitude and dropped from "Overhead soon"; climbers are predicted above FL500.
- Contrail humidity may be converted to ice twice if Open-Meteo serves ECMWF data (RH over ice below −23°C).
- Closest approach ignores meridian convergence: about 15 km wrong at Svalbard, and meaningless at the poles.

### Hobby layer and UI
- The first-sighting guide comes back on every page load after "Later", and takes over the camera 14 s after boot.
- Expanded sheet: only a drag down removes `.tall`, and its ✕ sits under the layers button.
- A double-click fires `select()` twice. Two photo fetches can leave another flight's photo on the card, and a double-click on empty ground deselects the current flight.
- The Next tab is rebuilt every second and Log every 3 s, so taps are lost and keyboard focus drops to `<body>`.
- The card and panel overlap between 761 and about 1110 px. The time bar overlaps the HUD tiles on 1280 and 1366 px laptops.
- The panel and card cover the recentre button, the "Overhead in" pill and the zoom "+" button on desktop.
- The LOOK UP toast can't be dismissed, and stays up for good at homes near an airport.
- On landscape phones the card is almost all photo.
- Popovers use `100vh`; iOS needs `dvh`.

## Low

### Data and feed
- Failed route and photo lookups are cached as `null` and never retried (`getRoute`, `fetchPhoto`).
- Bad relay URLs that pass the https check but don't work fail silently, with no message in the UI.
- `serve.py` labels every `HTTPError` body as JSON, and its 10 s upstream timeout is shorter than the browser's 25 s for big regions.
- Open-Meteo values go into `innerHTML` unescaped (Weather tab: cloud layers, `windSVG`, sunrise and sunset). This is only a risk if Open-Meteo is compromised.
- The Planespotters `p.link` goes into `href` without a scheme check.
- An unknown `settings.style`, or a corrupted `settings.place` or `log.types`, throws at boot. Validate stored settings.
- `mag_heading` is used as true track when `track` is missing.

### Hobby layer
- The Night owl and Golden hour badges can be unlocked by dragging the time slider (`S.timeOff`).
- The Mayday badge counts aircraft up to 740 km away, outside the 185 km rule.
- Old logs get no back-credit XP for badges and types they already have.
- The relay form's `restartFeed()` sets `mode='boot'` without clearing flights, so catches in that window go to the sim log.
- A hex code with no callsign can be logged as an airline (for example `AEA1F2` becomes Air Europa).
- The contrail mission is only checked at catch time, before `f.ctr` may be set.
- The Chopper badge uses the short `D.HELI` list, so an R22 or EC30 without category A7 earns nothing.
- Two tabs: the other tab's log is now reloaded when it saves, but a save within the same 1.5 s can still lose one tab's latest change.

### Look-ahead and sim
- Sun position error is about 0.14° on average (no precession). Sun azimuth interpolation near the zenith is off by up to 0.67°.
- Satellite pass alerts can fire twice (the key moves with the 20 s grid), and they keep firing after satellites are turned off.
- Satellites jump up to about 2000 km ahead after the tab comes back (`syncSats` extrapolation).
- Missing pressure levels give a confidently wrong "clean skies" message.
- Moon transits ignore the phase (a new moon or an invisible daytime moon still pings).
- Sim geometry breaks near the poles (`toLL` has no clamp or wrap).
- Sim airline mix: South America and Africa get the EU pool (`regionOf`).

### Camera and globe
- Follow mode leaves `c.h` about 25 km up after unfollowing. Zooming while following does nothing, then jumps.
- Flying over a pole spins the view 180°. You can't drag across a pole.
- Flying to an exact antipode takes an erratic path.
- Toggling radar quickly leaks an interval.
- A failed overlay tile is never retried. Stalled tile loads hold `MAX_LOADS` slots.
- `devicePixelRatio` is set only once.
- `setAirports` leaks one material per place change. Unused culled `Tile` objects count toward `MAX_TILES`.
- `backdrop-filter` on up to 150 moving labels, and a forced reflow per Board character.
- `routeCache`, `photoCache` and `coach.skip` never shrink.

### UI and accessibility
- Toasts stack on the same spot on mobile. The "Overhead in" pill overlaps ⌖ on 360 to 375 px phones.
- Both layouts can show at once after resizing below 760 px, or at exactly 760 px (CSS uses `≤ 760`, JS uses `< 760`).
- Tabs have no accessible name between 761 and 1100 px. Next rows don't respond to Enter or Space. The feed-status `aria-label` hides the live/sim text. `#toast` has no `role`. There is no focus return on Escape. The time slider has no `aria-valuetext`.
- "+XP" floats from 0,0 on phones (the level chip is hidden there).
- Contrast is low: the level chip at 0% (about 1.7:1), `--ink-3` on glass in the day theme, and `.board-foot`.
- The `pop` animation jumps on `.recenter` and `.next-pill` (the keyframe starts at `translate(-50%)`).
- Geolocation: plain http on the LAN gets advice the user can't follow, a late result overrides a place picked in the meantime, and the button stays on "Finding you…" if the prompt is ignored.
- Phones: the Board LOOK column needs horizontal scrolling, the place button is tiny, and `.hud-bc` blocks globe gestures.
- `.photo` also matches `body.photo` in photo mode (no visible effect yet).
- After a place change the old ping stays up to 9 s, old search results stay, and the guide still shows in photo mode.

## Fixed (28 Sept 2026)

- Sky camera tags sat off the real planes. Tags now use a live GPS fix while the camera is open, each aircraft's GNSS altitude, the ground height at home, and positions moved on by their age (the feed's `now` plus `seen_pos`). Angles are worked out every frame. On iOS a rough compass asks for a figure of eight.
- System notifications now fire. With alerts on, a worker's timer (`js/tick.js`) keeps the feed (home only, every 10 s), dead reckoning and `predictAll()` going in a hidden tab. Notifications go through a service worker (`sw.js`), which Android needs. Tapping one opens the flight.
- A hidden tab with alerts off no longer polls the feed. It polls again as soon as you come back.
- The chime is switched on by the first tap after a reload.
- `S.alerted` is cleared on a place change, and the same plane can alert again after 2 h.

## Fixed (27 Sept 2026)

- Stray `cl` before `<!doctype html>` (quirks mode).
- One non-JSON or 5xx reply no longer marks a feed source dead for good. Only 401/403/404/405, or a 2xx page that isn't JSON, does. Every sim retry resets the dead set.
- Boot, sim retries and ground view ask for 100 nm around home, not the camera's 3500 nm view. The feed doesn't widen until the intro has finished, and follows a `flyTo` target rather than its start.
- A 429 is never counted as a failure, even while booting. It is kept when a later source fails differently, and the back-off is at least twice the normal refresh.
- The sim note no longer blames CORS for every outage.
- `?relay=` lasts for the visit only and must be https (http only while Squawk itself runs on http). The relay form rejects bad URLs.
- `ingest()` validates numbers and strings and caps list size and string length, so bad feed data can't put NaN into the camera or throw mid-batch.
- GPU buffers upload only the part in use (`addUpdateRange`), not the whole 9000-aircraft array every frame.
- Catches and "I saw it" are remembered per airframe for 12 h in the log (`recent`, `seenHex`), so reloads and pan-away-and-back no longer farm XP.
- The log is written on `pagehide` and when the tab is hidden. Saves no longer keep getting postponed. A save from another tab is picked up.
- The first-sighting guide, LOOK UP toast, alerts and "I saw it" only run on live traffic.
- The level chip always shows the real log. Sim traffic gives no level, badge or mission toasts.
- Longitude filters in `predictAll()` and `tickHistory()` wrap across the date line.
- Aircraft families: C17 is a military transport, A337 is the Beluga, and R44/R66, MI8 and CH47 are helicopters.
- An old place's weather failure no longer wipes the new place's clouds.
- The coach no longer says "now in your log" when its plane vanished first.
- `serve.py` serves its own folder wherever it is started from, hides dotfiles such as `.git`, turns off directory listings, and no longer raises on malformed request lines.
- `index.html` shows a message when the browser has no import maps, or when the app hasn't started after 25 s.
