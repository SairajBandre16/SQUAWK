# SQUAWK

**The sky above you, live in 3D.** Squawk is a plane-spotting app that shows every aircraft around you, in real time, over satellite imagery. The sun sits where it really is right now, and the clouds follow the live weather. Tap any aircraft and Squawk tells you exactly where to look to see it with your own eyes.

![Squawk](assets/screenshot.jpg)

## Features

- **Live aircraft** from community ADS-B networks (ADSB.lol, airplanes.live and adsb.fi), up to about 185 km around you, refreshed every 5 seconds.
- **Use your current location**, search any city or airport, or jump to a busy sky: Heathrow, Dubai, Mumbai, New York and more.
- **A real-world scene.** Satellite ground imagery with earth curvature. The sun's position is calculated for your location and time. Cloud cover, wind and haze come from live weather.
- **Three camera views.** *Orbit* is the 3D overview. *Map* is top-down. *Ground view* puts you on the ground looking up at true angles, so the scene matches what you see outside.
- **Time scrubber** to preview the sky at golden hour, sunset or night.
- **Flight cards** with a photo of the actual aircraft (Planespotters.net), the route, altitude, speed, squawk code and a "where to look" sky dial.
- **Tabs:**
  - **Board:** a split-flap departures board of the nearest aircraft, plus a feed of landings, heavies, emergencies and overhead passes.
  - **Stats:** an altitude histogram, top airlines, aircraft sizes, a traffic trend and session records.
  - **Weather:** a spotting-conditions score, cloud layers, surface wind and jet stream, and sunrise, sunset and golden hour.
  - **Log:** a collection of the aircraft types you've caught, plus 15 badges to unlock (Superjumbo, Queen of the Skies, Mayday…).
  - **Codes:** what the transponder squawk codes mean.
- If no live feed is reachable, Squawk falls back to realistic **simulated traffic** around the nearest major airport.

## Run it locally

It's a static site with no build step. Serve the folder over HTTP:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Three.js r170 loads from jsDelivr through an import map. Geolocation needs `https://` or `localhost`.

## Project layout

```
index.html        UI shell and import map
css/style.css     glass UI that follows day and night
js/main.js        app state, live feed, labels, tabs, badges
js/world.js       three.js scene: sky, satellite tiles, clouds, aircraft, trails, camera
js/data.js        airlines, aircraft types, airports and network sources
js/sim.js         simulated traffic fallback
js/geo.js         projection, earth curvature, sun position
```

## Data and credits

Aircraft positions come from [ADSB.lol](https://adsb.lol), [airplanes.live](https://airplanes.live) and [adsb.fi](https://adsb.fi), and routes from ADSB.lol. Photos come from [Planespotters.net](https://www.planespotters.net), weather from [Open-Meteo](https://open-meteo.com), and geocoding from [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org). Imagery is © Esri, Maxar and Earthstar Geographics. Map tiles are © OpenStreetMap contributors and © CARTO. The 3D rendering uses [three.js](https://threejs.org).

Squawk is for spotting fun, not for navigation.
