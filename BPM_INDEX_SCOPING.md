# PacePlaylist — BPM Index Scoping

> Goal: stop discovering songs one-at-a-time and instead ship a **pre-built index of
> popular songs with known BPM**, so a runner can instantly find tracks that match a
> target cadence. Target size: a few hundred MB, bundled or served from our own backend.

This document scopes the work, picks a recommended architecture, and lays out the
rate-limit / legal / security ("phishing") / good-citizen risks you asked about.

---

## 1. The one constraint that decides everything

Today BPM has **a single source**: the browser downloads a 30s iTunes preview and
`lib/bpm-detect.js` analyzes it with Web Audio (peak-interval histogram). That's it.

- **Spotify `audio-features` (tempo) is dead for us.** It was deprecated for new /
  development-mode apps on **2024-11-27**, same cutoff that removed `preview_url`.
  Our app is in dev mode, so we cannot read tempo from Spotify at all.
- **Spotify search is capped at `limit=10`** in dev mode (see `lib/spotify.js`).
- So "build an index of 10k songs/genre with BPM" is **not a Spotify task**. The real
  question is: *where do the BPM numbers come from at scale, legally, without abusing
  anyone's API?*

Everything below follows from that.

---

## 2. Data-source options (the actual decision)

We need two things: **(a) a ranked list of popular songs per genre**, and
**(b) a BPM for each**. They can come from different sources.

### (b) BPM data — ranked best-fit for "bulk index"

| Source | How you get it | Rate / bulk | License / ToS | Coverage | Verdict |
|---|---|---|---|---|---|
| **AcousticBrainz dumps** | Download static DB dumps (low-level + high-level), join offline. Contains `bpm` + rhythm features. | **Bulk file download. No live API hammering.** | CC0 (low-level) / CC BY-SA (high-level). Redistributable **with attribution**. | Millions of recordings, but **frozen — project ended 2022**, so ~no 2022+ releases. | ★ **Best fit for "a couple hundred MB index."** This *is* the database you described. |
| **GetSongBPM API** | Per-track lookups via registered API key. | Free, but **mandatory backlink** to getsongbpm.com or account is suspended; per-key rate limits. | Free tier needs attribution; **not bulk-redistributable** — treat as live lookups, not a redistributable dump. | Large, more current than AcousticBrainz. | Good **fallback / fill-the-gaps** for songs AcousticBrainz misses. We dropped it before, but for backfill it's reasonable. |
| **Self-detect from iTunes previews (server-side)** | Re-run our peak-histogram on previews, but in Node. | iTunes Search API limit ≈ **20 req/min**. 300k songs ≈ **250+ hours** + abusive. | Apple ToS = personal/non-commercial, no bulk scraping. | Whatever iTunes has. | ✗ **Do not bulk-harvest this way.** Keep it only as the *on-demand* path for cache misses (what we already do). |
| **Spotify `audio-features`** | — | — | Deprecated for our app. | — | ✗ Dead end. |

### (a) Popular-songs-per-genre list

| Source | How | Rate / ToS | Verdict |
|---|---|---|---|
| **Last.fm `tag.getTopTracks`** | Genre tag → ranked top tracks, paginated (~1000/tag). Returns MBIDs sometimes. | Free API key; be polite (~5 req/s ceiling, we'll go slower). Allowed. | ★ Cleanest "popular per genre" source, and MBIDs let us join AcousticBrainz. |
| **ListenBrainz popularity dumps** | Bulk listen/popularity stats, MBID-keyed. | Bulk download, CC0. | ★ Pairs perfectly with AcousticBrainz (same MBID space), fully offline. |
| **Spotify search / playlists** | Harvest catalog + popularity. | **Violates Spotify ToS** (no building a competing/standalone catalog DB) and limit=10. | ✗ Not for index-building. Keep Spotify only for live in-app search + linking out. |

**Recommended combination:** popularity + BPM both from the **MusicBrainz / ListenBrainz /
AcousticBrainz family** (one MBID join, all CC-licensed, all bulk, zero live scraping),
with **GetSongBPM + on-demand iTunes detection** filling gaps for newer songs.

### 2b. iTunes-first variant (chosen direction)

You want iTunes previews as the primary BPM source — and as a *method* it's ideal:
free, CORS-open, our `lib/bpm-detect.js` already works on it, **always current**, and a
single `itunes.apple.com/search` call returns *both* the candidate songs **and** their
preview URLs (so it covers list **and** BPM in one source). The catch is never quality —
it's **harvest scale + good-citizenship**, and that's fully solvable:

- **It's a rate-limit problem, not a feasibility problem.** iTunes Search allows
  ~**20 calls/min**. A one-shot blast of 300k songs ≈ 250+ hours and reads as scraping
  abuse → risks an IP block. So we *don't* blast — we **build the index gradually and
  cache forever**:
  1. **Cache-on-detect:** every BPM the app already detects gets **persisted to the
     index** instead of thrown away. The index grows for free from real usage.
  2. **Slow background trickle:** an offline crawler at **~12–15 req/min** (well under the
     ceiling, with jitter + backoff) walks the popular-songs lists over days/weeks. At
     15/min that's ~21k/day — the whole "10k × top genres" fills in within days, politely.
  3. **Detect once, store forever.** A song's BPM never changes, so the index is
     append-only; we never re-fetch a preview we've already analyzed.
- **Where the *song list* comes from** (iTunes search needs a query): use iTunes genre
  IDs (`genreId` + `entity=song`) for top songs per genre, or seed from Last.fm top-tracks
  and resolve each to its iTunes preview. Either way one iTunes call yields list+preview.
- **Server-side vs client-side detection.** Today detection runs in the browser (Web
  Audio). For an *offline* crawler there's no browser, so either (a) run the crawler in a
  headless browser, or (b) port the analyzer to Node with `node-web-audio-api` /
  `essentia.js` / `aubio`. (a) is least code; (b) is leanest at scale.
- **Apple ToS reality:** the Search API is meant for app/store-linking use, personal/
  non-commercial, no bulk scraping or redistribution of *Apple's* data. Storing **our own
  derived BPM numbers** keyed by track is the defensible line; mirroring Apple's catalog
  or preview audio is not. Trickle + cache (not bulk mirror) keeps us on the right side.

So: **iTunes-first is the plan** — the index becomes a slowly-growing, permanently-cached
BPM store fed by (1) live detections and (2) a polite background trickle, rather than a
one-time mass download.

---

## 3. Recommended architecture

**Build the index offline; serve it as static data + a tiny query API.**

```
  ┌─ OFFLINE (a script you run occasionally, not in the request path) ──────────┐
  │ 1. Pull genre→top-tracks from Last.fm / ListenBrainz   → tracks.jsonl       │
  │ 2. Join to AcousticBrainz dump by MBID                 → +bpm, +key         │
  │ 3. Backfill missing BPM via GetSongBPM (rate-limited)  → +bpm               │
  │ 4. Normalize, dedupe, fold tempo to runnable range     → index.sqlite       │
  │ 5. Emit per-BPM-bucket JSON shards for the client      → /data/bpm/*.json   │
  └────────────────────────────────────────────────────────────────────────────┘
                                   │  (committed artifact or object storage)
  ┌─ RUNTIME ─────────────────────────────────────────────────────────────────┐
  │ Browser asks "give me genre=rock, BPM 165–175" → load the matching shard.   │
  │ Spotify is used ONLY to resolve a chosen track to a playable URI / link.    │
  └────────────────────────────────────────────────────────────────────────────┘
```

Why this shape:
- The expensive/abusable work (harvesting) happens **once, offline, rate-limited** —
  never per user request, so we can't be turned into an accidental scraper-proxy.
- The runtime is just static file reads → trivially cacheable, no per-request API keys,
  no rate limits to hit.
- Spotify stays inside its allowed use (search + linking), never as a data warehouse.

### Index schema (per track)
```
mbid, title, artist, genre[], bpm, bpm_confidence, key?, duration_ms,
popularity_rank, source ("acousticbrainz" | "getsongbpm" | "itunes"),
spotify_id?, itunes_id?, art_url?
```

### Size math (your "couple hundred MB" instinct is right)
- ~30 broad genres × 10k = **~300k rows**. Even 100 genres × 10k = 1M rows.
- ~250–350 bytes/row JSON → **75–110 MB** at 300k; ~**300 MB** at 1M. SQLite or gzipped
  shards cut that 3–5×. **A few hundred MB is the correct order of magnitude.**
- Storage options: (a) commit gzipped shards to the repo (simplest, but bloats git),
  (b) put `index.sqlite` / shards in object storage + CDN (recommended at this size),
  (c) ship a SQLite file and query with `sql.js`/`better-sqlite3`.

### Matching note
Store **raw BPM**; the app already folds half/double tempo (`matchOf` in
`lib/runplan.js`) so an 85-BPM track matches a 170-spm cadence. Index keeps raw values;
query layer applies the same fold.

---

## 4. Risks (the part you explicitly asked for)

### 4.1 API rate limits — and not being a bad citizen
- **Never bulk-harvest in the request path.** All harvesting is an offline script with a
  fixed concurrency of 1–2 and explicit sleeps.
- **Honor each source's ceiling:** MusicBrainz 1 req/s; Last.fm a few req/s; iTunes
  ~20 req/min; GetSongBPM per-key. Add jitter + exponential backoff on 429/503.
- **Prefer bulk dumps over APIs** wherever a dump exists (AcousticBrainz, ListenBrainz,
  MusicBrainz) — a single download beats 300k requests and is what those projects *want*
  you to do.
- **Set a real `User-Agent`** with app name + contact (MusicBrainz *requires* this and
  will block generic UAs). Cache aggressively; re-run the harvest weekly/monthly, not
  continuously.
- **Resumable + idempotent harvest** (checkpoint to disk) so a failure doesn't restart
  300k requests.

### 4.2 Legal / licensing (the quiet risk)
- **Spotify ToS forbids** building a standalone/competing catalog or storing their
  catalog + audio features in your own DB beyond limited caching. → **Do not seed the
  index from Spotify.** Use Spotify only for live search and linking out. This is *why*
  the architecture above sources data from MusicBrainz/AcousticBrainz instead.
- **AcousticBrainz/MusicBrainz/ListenBrainz are CC-licensed and redistributable** — but
  **attribution is required** (and CC BY-SA on AB high-level data is share-alike). Add an
  attributions/credits section to the app.
- **Apple/iTunes**: personal-use, no bulk scraping or redistribution of their data.

### 4.3 Security / "phishing" & abuse surface
Building an index doesn't add phishing risk by itself, but it grows the backend, so:
- **Keep all third-party keys server-side** (`.env.local`, already the case). Never ship
  Spotify/Last.fm/GetSongBPM keys to the browser.
- **Rate-limit *our own* endpoints.** Once we have a query API, someone could hammer it,
  or worse, use any "fetch a preview / detect BPM for arbitrary URL" endpoint as an
  **open proxy / SSRF** to make Apple/others see *us* as the abuser. Mitigations:
  allowlist hostnames the server will fetch (iTunes only), validate inputs, cap response
  size, add per-IP rate limits.
- **If we ever add Spotify user login (OAuth)** to escape dev-mode limits: validate the
  `redirect_uri` exactly, use `state` (CSRF), never log tokens, store them httpOnly. This
  is the main place real phishing/redirect risk would enter — worth its own review then.
- **Supply-chain:** any new audio/DB deps (e.g. `essentia.js`, `better-sqlite3`) get
  pinned and reviewed.

### 4.4 Data-quality risks
- AcousticBrainz BPM is auto-estimated (like ours) — **store a confidence/source field**
  and let users override (the app already supports manual BPM override).
- **Coverage gap:** AcousticBrainz is frozen at 2022, so newer hits need GetSongBPM /
  on-demand detection. Make "not in index → detect live" a graceful fallback, not an error.
- Genre tags are messy (Last.fm tags ≠ clean taxonomy). Decide a canonical genre list and
  map tags into it.

---

## 5. Suggested phasing (so you can validate before committing to scale)

1. **Spike (½–1 day):** Download one AcousticBrainz high-level dump, pull Last.fm top
   tracks for 3 genres, do the MBID join offline. Measure **join hit-rate** (how many
   popular tracks actually have AB BPM). *This number makes or breaks the whole plan* —
   if hit-rate is low, you lean more on GetSongBPM/live detection.
2. **Pipeline (2–3 days):** Generalize the harvest to N genres, add GetSongBPM backfill,
   produce `index.sqlite` + gzipped per-bucket shards, make it resumable.
3. **Serve + query (1–2 days):** Add a read-only query endpoint or static-shard loader;
   wire the app's "Find songs" to query the index first, fall back to live search/detect.
4. **Polish:** attribution UI, confidence display, rate-limit our endpoints, weekly
   refresh job.

---

## 6. Open decisions for you
- **How many genres / how many per genre really?** 30×10k (~100MB) vs 100×10k (~300MB).
- **Coverage vs freshness:** OK with AB's 2022 ceiling + live fallback, or do we need
  GetSongBPM as a primary (more current, but attribution + per-track lookups)?
- **Storage:** commit gzipped shards to git, or object storage + CDN? (At a few hundred
  MB I'd lean CDN/object storage, not git.)
- **Spotify's role:** confirm we keep it to live search + linking only (recommended for
  ToS), and whether you ever want to do the OAuth upgrade to lift the limit=10 cap.

---

### Sources
- AcousticBrainz downloads & shutdown: https://acousticbrainz.org/download ·
  https://blog.metabrainz.org/2022/02/16/acousticbrainz-making-a-hard-decision-to-end-the-project/
- GetSongBPM API (free + mandatory backlink): https://getsongbpm.com/api
- (Spotify Nov 2024 deprecation of audio-features/preview_url for dev apps — already
  encoded in this app's design notes.)
