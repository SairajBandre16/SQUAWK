# Progress

Where Squawk stands and what comes next. Update this file whenever a chunk of work lands. The full list of known bugs is in [BUGS.md](BUGS.md).

_Last updated: 28 Sept 2026_

## Current state

- **Live site:** Vercel deploys `main` to production and every other branch to a preview URL.
- **Branches:** `main` and `globe` both contain everything below, and work continues on `globe`.
- **Deploy:** the latest production merge is `f52a0d3` (28 Sept 2026): sky camera alignment, background notifications, home following your location, and a location prompt every visit. Accounts use the Firebase project `squawk-2f8c2`.
- **Waiting on:** testing on real phones (iPhone and Android). Everything was only tested in desktop Chrome with fake sensor readings. Fix anything the owner finds on `globe` first.

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

### Location, compass and sky camera (27 Sept 2026)
- [x] First visit asks for your location (after a time-zone guess instead of always Dublin); returning visitors with location allowed follow where they are
- [x] The card's sky dial is now a compass: on phones it turns with you and says "Turn right 40°, look 26° up"
- [x] Sky camera: point the phone at the sky to name the planes, tap to track, drag to fix the compass
- [ ] Test on real phones: compass direction and iOS permission, camera field of view (tags line up with real planes), landscape, the welcome card, and moving home by location on return visits

### Accounts (27 Sept 2026)
- [x] Sign in with Google or email and password (Firebase). Each spotter's level, streak, badges, missions and collection live in their own account and follow them across devices
- [x] New accounts start with an empty log (the signed-out browser log is no longer merged in); two devices spotting at once are merged, not overwritten
- [x] Profile panel (tap your picture): level, catches, streak and best run, favourites, 12-week activity grid, latest badges, plane avatars or your own photo, display name, sign out, and "Start my log again"
- [x] Without a Firebase project configured, the app runs as before with no account button
- [x] Firebase project set up (Google and Email/Password on, `squawk-iota.vercel.app` authorised, Firestore created)
- [x] Updated `firestore.rules` published (allows the `profile` field)
- [x] Live on production (`e436162`, merged into `main` as `6ac5da4`); the owner tested sign-in, the profile and the log reset on the live site
- [ ] Test on phones: the Google popup on iOS Safari, and photo upload from the camera roll

### Sky camera accuracy and notifications (28 Sept 2026)
- [x] Sky camera tags line up better: a live GPS fix while it's open, GNSS altitude, ground height, and positions moved on by their age
- [x] Alerts reach you in a background tab: a worker keeps the feed and look-ahead running, and notifications go through a service worker (Android)
- [x] Hidden tabs with alerts off stop polling the feed
- [x] Home follows your current location: every visit starts where you are, and home moves with you as you go (a picked place holds until the next visit)
- [x] Every visit asks the browser for your location; the browser stays silent once you've allowed it. Without a location the welcome card explains why and offers a search
- [ ] Test on phones: tags against real planes (with and without location allowed), a LOOK UP notification with the screen off on Android, and tapping it
- [ ] iOS only shows web notifications for sites added to the home screen, which needs a web app manifest

### Personal features to consider next
- [ ] Home place and display settings follow the account across devices
- [ ] Watchlist: star airlines, types, tails or callsigns and get alerted when one comes near
- [ ] Sighting journal: each "I saw it" saved with time, place, a photo and a note, shown on a personal map
- [ ] Saved places (home, work, holiday), each with its own stats
- [ ] Personal records and a shareable monthly recap card
- [ ] Friends and a local leaderboard (needs public profiles)

## Next up

The first three are the high-priority items from [BUGS.md](BUGS.md):

- [x] Transit hit detection now zooms in around the coarse sample instead of missing crossings between 3 s steps (30 Sept 2026)
- [ ] **Transits.** Use a better moon formula, and fix the curved-earth centreline for a low sun.
- [ ] **Phone polish.** Stop iOS zooming into the search input (set the font to 16px), use `dvh` for popovers, and stop toasts and pills overlapping.
- [ ] **Accessibility.** Remove `aria-live` from the panel and card (it floods screen readers), make Next rows work with the keyboard, and give tabs names.
- [ ] **Globe view on slow connections.** A timeout should shrink the region instead of dropping into simulated traffic.
- [ ] **Mobile data diet.** Abort the old request when the feed restarts. (Hidden tabs now rest unless alerts are on.)
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
