// Offline BPM crawler (the spike).
//
// Walks seed artists on the free iTunes Search API, downloads each 30s preview,
// detects BPM with the same DSP the app uses, and stores it in the local index.
// Designed to be a GOOD CITIZEN, not a scraper:
//   - iTunes Search/lookup calls are throttled to stay under Apple's ~20/min.
//   - preview audio (static CDN) downloads at a gentler separate pace.
//   - a real User-Agent with contact info is sent.
//   - it's resumable + idempotent: tracks already in the index are skipped, and
//     BPM never changes, so a re-run only fills gaps. Run it as often as you like.
//
// Usage:
//   node scripts/crawl.mjs                 # full-catalog artists + rock + rap
//   node scripts/crawl.mjs --only "Gojira" # just one artist
//   node scripts/crawl.mjs --full-only     # only the full-catalog artists
//   node scripts/crawl.mjs --list-only     # only the rock/rap top-songs lists
//   node scripts/crawl.mjs --refresh       # re-crawl artists already marked done
//   node scripts/crawl.mjs --no-enrich     # skip inline Deezer popularity lookups
//
// Resumable: skips tracks already indexed, and skips re-walking artists whose
// previous pass fully completed (checkpoint stored per artist in the meta table).
// Env: CRAWL_API_MS (default 4000), CRAWL_AUDIO_MS (default 1000),
//      CRAWL_MAX_LIST (top songs per list artist, default 50)

import { FULL_CATALOG, ROCK_BANDS, POP_ARTISTS, RAP_ARTISTS, EDM_ARTISTS, METAL_ARTISTS, GENRE_OF } from "./seeds.mjs";
import { detectBpmFromArrayBuffer } from "../lib/bpm-node.mjs";
import { getByName, upsertTrack, stats, normKey, isCrawled, markCrawled } from "../lib/bpm-index.mjs";
import { trackPopularity } from "../lib/deezer.mjs";

const API_MS = Number(process.env.CRAWL_API_MS || 4000); // ~15 search calls/min
const AUDIO_MS = Number(process.env.CRAWL_AUDIO_MS || 1000); // CDN audio, gentler
const DEEZER_MS = Number(process.env.CRAWL_DEEZER_MS || 300); // popularity lookups
const MAX_LIST = Number(process.env.CRAWL_MAX_LIST || 50);
const ENRICH = !process.argv.includes("--no-enrich"); // popularity while crawling
const UA =
  "PacePlaylist/0.1 (running-playlist BPM indexer; contact: eirik.albrektsen@gmail.com)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- throttled fetch helpers -------------------------------------------------
let lastApi = 0;
async function apiGet(url) {
  const wait = API_MS - (Date.now() - lastApi);
  if (wait > 0) await sleep(wait);
  lastApi = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (res.status === 429 || res.status === 403) {
    console.warn(`  ! ${res.status} from iTunes — backing off 60s`);
    await sleep(60000);
    return apiGet(url);
  }
  if (!res.ok) throw new Error(`iTunes ${res.status} for ${url}`);
  return res.json();
}

let lastAudio = 0;
async function audioGet(url) {
  const wait = AUDIO_MS - (Date.now() - lastAudio);
  if (wait > 0) await sleep(wait);
  lastAudio = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`preview ${res.status}`);
  return res.arrayBuffer();
}

// Throttled Deezer popularity lookup (its own pace; trackPopularity handles
// 429/quota backoff internally). Returns 0-100 or null.
let lastDeezer = 0;
async function popularityOf(title, artist) {
  const wait = DEEZER_MS - (Date.now() - lastDeezer);
  if (wait > 0) await sleep(wait);
  lastDeezer = Date.now();
  try {
    const m = await trackPopularity(title, artist);
    return m?.popularity ?? null;
  } catch {
    return null;
  }
}

const ITUNES = "https://itunes.apple.com";

async function findArtistId(name) {
  const url = `${ITUNES}/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=5`;
  const d = await apiGet(url);
  // Prefer an exact (case-insensitive) name match, else the first result.
  const exact = (d.results || []).find(
    (r) => (r.artistName || "").toLowerCase() === name.toLowerCase()
  );
  return (exact || (d.results || [])[0])?.artistId ?? null;
}

// Songs where the artist is the primary, via a name search.
async function songsBySearch(name, limit) {
  const url = `${ITUNES}/search?term=${encodeURIComponent(
    name
  )}&entity=song&attribute=artistTerm&limit=${limit}`;
  const d = await apiGet(url);
  return (d.results || []).filter((r) => r.kind === "song");
}

// An artist's top songs by artist ID (accurate — avoids the title-collision
// problem where e.g. searching "Pendulum" returns songs *named* Pendulum).
async function songsByArtistId(artistId, limit) {
  const url = `${ITUNES}/lookup?id=${artistId}&entity=song&limit=${limit + 1}`;
  return (await apiGet(url)).results.filter((r) => r.kind === "song");
}

// Every album for an artist, then every song on each album (full catalog).
async function songsByAlbumWalk(artistId) {
  const albumsUrl = `${ITUNES}/lookup?id=${artistId}&entity=album&limit=200`;
  const albums = (await apiGet(albumsUrl)).results.filter(
    (r) => r.wrapperType === "collection"
  );
  console.log(`    ${albums.length} albums`);
  const songs = [];
  for (const al of albums) {
    const songsUrl = `${ITUNES}/lookup?id=${al.collectionId}&entity=song&limit=200`;
    const res = (await apiGet(songsUrl)).results.filter((r) => r.kind === "song");
    songs.push(...res);
  }
  return songs;
}

// ---- per-track processing ----------------------------------------------------
async function processTrack(t, genre) {
  const title = t.trackName;
  const artist = t.artistName;
  if (!title || !artist) return "skip";
  if (getByName(artist, title)) return "have"; // resumable: already indexed

  let bpm = null;
  if (t.previewUrl) {
    try {
      const ab = await audioGet(t.previewUrl);
      bpm = await detectBpmFromArrayBuffer(ab);
    } catch (e) {
      console.warn(`    ~ detect failed for ${artist} – ${title}: ${e.message}`);
    }
  }
  const popularity = ENRICH ? await popularityOf(title, artist) : null;
  upsertTrack({
    itunesId: t.trackId,
    title,
    artist,
    collection: t.collectionName,
    genre,
    bpm,
    durationMs: t.trackTimeMillis,
    previewUrl: t.previewUrl,
    art: t.artworkUrl100 || t.artworkUrl60,
    releaseDate: t.releaseDate || null,
    popularity,
    source: "itunes-crawl",
  });
  return bpm ? "bpm" : "nobpm";
}

function dedupe(tracks) {
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    const k = normKey(t.artistName, t.trackName);
    if (k === " | " || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

// Returns true only if enumeration fully succeeded (so the caller can mark the
// artist done). A failed/partial enumeration returns false so a later run retries.
async function crawlArtist(name, { full }) {
  const genre = GENRE_OF[name] || (full ? "rock" : "rock");
  console.log(`\n▶ ${name}  (${full ? "full catalog" : "top songs"})`);
  let tracks = [];
  let ok = true;
  try {
    if (full) {
      const id = await findArtistId(name);
      if (id) tracks.push(...(await songsByAlbumWalk(id)));
      tracks.push(...(await songsBySearch(name, 200))); // catch singles/features
    } else {
      // Resolve the artist ID first, then pull their songs — accurate even for
      // common-word names. Fall back to a name search if no artist match.
      const id = await findArtistId(name);
      if (id) tracks.push(...(await songsByArtistId(id, MAX_LIST)));
      else tracks.push(...(await songsBySearch(name, MAX_LIST)));
    }
  } catch (e) {
    console.warn(`  ! enumerate failed for ${name}: ${e.message}`);
    ok = false;
  }
  tracks = dedupe(tracks);
  console.log(`  ${tracks.length} unique tracks`);

  const tally = { bpm: 0, nobpm: 0, have: 0, skip: 0 };
  for (const t of tracks) {
    const r = await processTrack(t, genre);
    tally[r]++;
    if (r === "bpm") console.log(`    ✓ ${t.artistName} – ${t.trackName}`);
  }
  console.log(
    `  ${name}: +${tally.bpm} bpm, ${tally.nobpm} no-bpm, ${tally.have} already had`
  );
  return ok;
}

// ---- main --------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

  let plan;
  if (only) {
    const full = FULL_CATALOG.includes(only);
    plan = [{ name: only, full }];
  } else if (args.includes("--full-only")) {
    plan = FULL_CATALOG.map((name) => ({ name, full: true }));
  } else if (args.includes("--list-only")) {
    plan = [...ROCK_BANDS, ...POP_ARTISTS, ...RAP_ARTISTS, ...EDM_ARTISTS, ...METAL_ARTISTS].map((name) => ({ name, full: false }));
  } else {
    plan = [
      ...FULL_CATALOG.map((name) => ({ name, full: true })),
      ...ROCK_BANDS.map((name) => ({ name, full: false })),
      ...POP_ARTISTS.map((name) => ({ name, full: false })),
      ...RAP_ARTISTS.map((name) => ({ name, full: false })),
      ...EDM_ARTISTS.map((name) => ({ name, full: false })),
      ...METAL_ARTISTS.map((name) => ({ name, full: false })),
    ];
  }

  // Dedupe by name (an artist may appear in more than one list); keep the first
  // occurrence so a full-catalog artist isn't also re-crawled as a list artist.
  const seenNames = new Set();
  plan = plan.filter((a) => (seenNames.has(a.name) ? false : seenNames.add(a.name)));

  const refresh = args.includes("--refresh"); // re-crawl even already-done artists

  console.log(
    `Crawling ${plan.length} artist(s). API ${API_MS}ms / audio ${AUDIO_MS}ms between calls.` +
      (ENRICH ? ` Enriching popularity (Deezer) inline.` : ` Popularity enrichment OFF.`)
  );
  for (const a of plan) {
    const key = (a.full ? "full:" : "list:") + a.name;
    if (!refresh && isCrawled(key)) {
      console.log(`\n▶ ${a.name} — already crawled, skipping (use --refresh to recrawl)`);
      continue;
    }
    const ok = await crawlArtist(a.name, a);
    if (ok) markCrawled(key); // checkpoint so a restart skips this artist's re-walk
  }

  const s = stats();
  console.log(
    `\n== index now: ${s.total} tracks, ${s.withBpm} with BPM ==`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
