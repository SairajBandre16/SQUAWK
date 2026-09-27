# Progress

Where Squawk stands and what comes next. Update this file whenever a chunk of work lands. The full list of known bugs is in [BUGS.md](BUGS.md).

_Last updated: 27 Sept 2026_

## Current state

- **Live site:** Vercel deploys `main` to production and every other branch to a preview URL.
- **Branches:** `main` and `globe` both contain everything below, and work continues on `globe`.
- **Deploy:** as of commit `3eb1348` on `main`, the production deployment built successfully.

## Done

### Core app
- [x] Live 3D plane-spotting over satellite imagery, with the real sun position and weather-driven clouds (`4f1882d`)
- [x] Feed relay for Vercel, Netlify, a Cloudflare Worker and the local `serve.py`, plus routes from adsbdb and a board layout fix (`9e0de29`)
- [x] Haze thins as you zoom out, so distant aircraft stay visible (`23885b5`)
- [x] Smaller aircraft in ground view, and README screenshots (`6df4ae8`)

### Globe
- [x] Worldwide 3D globe with streaming tiles, a live feed that follows the camera, and recentre (`618bae3`)
- [x] Left-drag orbits when zoomed in, plus a small recentre button (`ffaaf4a`)
- [x] A cap on how fast a flicked pan keeps gliding (`79ed61b`)
- [x] Recentre button moved above the HUD tiles so it clears the time bar (`c566aee`)

### Look-ahead
- [x] Overhead countdown, sun and moon transits, contrail forecast, satellites and rare-aircraft alerts (`89ab99f`)
- [x] "Next overhead pass" pill above the view switcher (`697f125`)

### Look and feel
- [x] Aircraft families with airline tail colours, a richer flight card, photo mode and rain radar (`abd112b`)

### Hobby layer
- [x] First-sighting guide, "I saw it", XP and levels, daily missions, streaks and a collection of 24 families (`22b6bd9`)
- [x] Slower levelling, and docs for the new features (`c7c0815`)

### Audit (27 Sept 2026)
- [x] Six reviews from different user viewpoints found about 109 issues
- [x] Fixed the urgent ones (`7fa6df8`, merged into `main` as `3eb1348`):
  - [x] the feed recovers from passing errors instead of getting stuck on simulated traffic
  - [x] boot asks for 100 nm around home instead of 3500 nm
  - [x] `?relay=` links are safe
  - [x] incoming feed data is validated
  - [x] GPU uploads are about 7 MB lighter per frame
  - [x] reloading no longer farms XP
  - [x] the log is saved when the tab closes
  - [x] alerts and the guide only run on live traffic
  - [x] date-line fix, aircraft family fixes, and a hardened `serve.py`
- [x] The rest is recorded in [BUGS.md](BUGS.md)

## Next up

The first four are the high-priority items from [BUGS.md](BUGS.md):

- [ ] **Notifications.** Alerts never reach a hidden tab. Run predictions from a timer while the tab is hidden, and use a service worker for Android.
- [ ] **Transits.** Detect dead-centre crossings reliably, use a better moon formula, and fix the curved-earth centreline for a low sun.
- [ ] **Phone polish.** Stop iOS zooming into the search input (set the font to 16px), use `dvh` for popovers, and stop toasts and pills overlapping.
- [ ] **Accessibility.** Remove `aria-live` from the panel and card (it floods screen readers), make Next rows work with the keyboard, and give tabs names.
- [ ] **Globe view on slow connections.** A timeout should shrink the region instead of dropping into simulated traffic.
- [ ] **Mobile data diet.** Pause or slow polling in hidden tabs, and abort the old request when the feed restarts.
- [ ] **Performance at 12k aircraft.** Cut per-frame allocations, stop sorting all ground-view labels, and handle the `MAXP` cap.

## Later

- [ ] Better coverage where ADSB.lol is thin (for example, parts of India)
- [ ] Protect the relays (Origin check, rate limit) and add security headers (CSP, `frame-ancestors`)
- [ ] Guide "Later" should stick across reloads instead of taking over the camera every visit
- [ ] The Low items in [BUGS.md](BUGS.md)

## Working rules

- Only the repo owner appears as author on commits and pull requests. No co-author or AI credit lines.
- Commit each group of fixes separately so each one can be reviewed.
- Test in the browser through `python serve.py` before pushing. Debug hooks are on `window.__squawk`.
