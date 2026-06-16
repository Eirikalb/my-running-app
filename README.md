# PacePlaylist

Upload a GPX, set your goal pace, and lay a BPM-matched playlist over your route.
Each song paints the stretch of road it plays during, colored by track, so you can
see exactly where each song lands on the run.

## Features

- **GPX upload + map** — drag in a `.gpx`, see the route on an OpenStreetMap (Leaflet) map with start/finish markers, distance, elevation gain, and point count.
- **Goal pace** — set min/km; the app computes finish time and the time-offset of every point on the route.
- **Perfect BPM** — set your target cadence; songs are matched against it, counting half/double tempo (an 85 BPM track ≈ 170 spm).
- **Spotify search** — search tracks (name, artist, duration, artwork) via the Spotify Web API.
- **Auto BPM (no API key)** — when you add a song, the app finds its 30s preview via the free iTunes Search API, decodes it in your browser with the Web Audio API, and detects the tempo with a lowpass + peak-interval algorithm. You can override any BPM by hand.
- **Playlist over GPX** — build your playlist in order; each song is mapped to the segment of the route that plays during it and drawn in its own color. Reorder, remove, and see coverage vs. run length.
- **Audio player** — optionally drop in an audio file to play while planning.

No database. All state lives in the browser; the only server pieces are two thin API routes that hide your API keys.

## Setup

1. Install deps:
   ```bash
   npm install
   ```
2. Copy env and fill in keys:
   ```bash
   cp .env.local.example .env.local
   ```
   - **Spotify**: create a free app at <https://developer.spotify.com/dashboard>. No user login is used (Client Credentials flow), but Spotify's form requires a Redirect URI — enter `http://127.0.0.1:3000/callback` to satisfy it. Copy the Client ID and Client Secret. Note: apps in "development mode" cap search `limit` at 10, which is why search returns 10 results.
   - **BPM**: no key needed. Tempo is detected from iTunes previews in the browser.
3. Run:
   ```bash
   npm run dev
   ```
   Open <http://localhost:3000>.

The app degrades gracefully: without Spotify keys, search shows a clear error; without a GetSongBPM key, auto-BPM is skipped and you can enter BPM manually.

## Stack

Next.js (App Router) · React · Leaflet / react-leaflet · OpenStreetMap tiles. Plain JS, no build config beyond Next defaults.
