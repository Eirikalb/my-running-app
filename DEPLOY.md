# Deploying PacePlaylist + the BPM index to Vercel

## ✅ STATUS: implemented on Neon Postgres

The deployed app now reads/writes **Neon** (serverless Postgres). The local crawler still
writes SQLite (fast, offline); `npm run push:neon` publishes it to Neon. To go live:

1. **Env vars** (Vercel project settings → Environment Variables, and locally in `.env.local`):
   - `DATABASE_URL` — your Neon connection string (already set locally).
   - `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` — for the "Search Spotify" tab.
2. **Publish data:** `npm run push:neon` (done once already — 14k tracks live). Re-run after
   each crawl/enrichment to refresh prod.
3. **Deploy:** push to GitHub + import in Vercel, or `vercel --prod`. Node is pinned to `>=22`
   (`package.json` engines); the API routes use the pure-JS `@neondatabase/serverless` driver,
   so no native build and they run fine on Vercel's Node runtime.

What lives where:
- **App (deployed):** `lib/neon.mjs` — async Postgres query layer (FTS via `tsvector`+GIN,
  closeness via `LEAST(ABS…)`). The 3 API routes import only this (no `node:sqlite` in the
  bundle).
- **Local only (never deployed):** the crawler/enrichment write `data/bpm-index.sqlite` via
  `lib/bpm-index.mjs` (`node:sqlite`); `scripts/push-to-neon.mjs` syncs SQLite → Neon.
- Local `npm run search` still queries SQLite; the web app queries Neon.

Everything below is the original scoping/rationale.

---


> Goal: share the app publicly, cheaply. The app itself (Next.js) deploys to Vercel
> trivially. The only real work is the **BPM index database**, which today is a local
> SQLite file written by the crawler and read synchronously via `node:sqlite`.

## The facts that drive the decision
- **The DB is tiny: ~9 MB** (13.5k tracks, incl. the FTS5 index). Not the "couple hundred
  MB" we first imagined — so size is a non-issue either way.
- The app reads the index on nearly every request (`/api/bpm/search`, `/api/preview`
  cache lookup) and **writes** it in exactly one place: `/api/bpm` cache-on-detect.
- The crawler/enrichment run **offline on your machine** — they never deploy. They just
  produce the .sqlite file (or push rows to a hosted DB).

## Why "just deploy it" doesn't work as-is
1. **Serverless filesystem is read-only** (except `/tmp`, which is ephemeral and
   per-instance). So cache-on-detect can't write to a bundled file, and WAL mode (which
   needs to write `-wal`/`-shm` siblings) fails on a read-only dir.
2. **`node:sqlite` is not reliable on Vercel.** It's unflagged only on Node 24+; Vercel's
   runtime tops out at Node 22.x, where it needs `--experimental-sqlite` (you can't pass
   node flags to Vercel functions). So the deployed read path needs a different driver.
3. **`data/` is gitignored** — nothing ships the DB to prod yet.

---

## Recommended path: Turso (hosted libSQL) — $0, keeps writes + FTS5

[Turso](https://turso.tech) is SQLite-as-a-service (libSQL fork). It fits this app almost
perfectly:
- **SQLite-compatible, including FTS5** → our schema + queries port with minimal change.
- **Pure-JS client** (`@libsql/client`) → no native build, works on any Vercel Node runtime.
- **Supports writes** → cache-on-detect keeps working in production.
- **Free tier** is generous (multi-GB storage, billions of row-reads/month) — a hobby app
  won't get close. Cost: **$0**.

### Work involved (the honest part)
The `@libsql/client` API is **async**, but our `lib/bpm-index.mjs` / `lib/bpm-search.mjs`
are synchronous (`node:sqlite`'s `.get()/.all()/.run()`). So:
1. Add a thin DB layer that returns a libSQL client in prod (`createClient({ url, authToken })`
   from env) and keeps `node:sqlite` for the **local crawler** (Node 25, offline).
2. Make `search()`, `getByName()`, `upsertTrack()` **async**, and `await` them in the 3 API
   routes. (Contained change — the React UI already calls these over `fetch`, so the client
   doesn't change at all.)
3. Keep the FTS5 schema/triggers identical (libSQL supports them).

### Deploy steps
1. `turso db create paceplaylist` → get the DB URL + an auth token.
2. Push the local data once:
   `sqlite3 data/bpm-index.sqlite .dump | turso db shell paceplaylist` (or `turso db shell
   paceplaylist < dump.sql`). Re-run after big crawls to refresh prod.
3. On Vercel, set env vars: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, plus
   `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`.
4. `vercel --prod` (or connect the GitHub repo). Done.

---

## Alternative: ship the DB read-only inside the deployment — $0, no external service

If you'd rather not host the DB anywhere, bundle the 9 MB file and read it in-process.
Trade-off: **the index becomes read-only in prod** (cache-on-detect is disabled there;
the catalogue is pre-built anyway, so this mostly just stops the index growing from live
usage).

- **Driver:** use `better-sqlite3` (synchronous, like `node:sqlite`, and ships SQLite **with
  FTS5**). Vercel installs its prebuilt binary for the function's Node version, so no compile.
  (Keep `node:sqlite` for the local crawler, since Node 25 can't build `better-sqlite3` —
  this is exactly why we chose `node:sqlite` originally.)
- **Bundling the file:** un-gitignore a *published* copy (e.g. `public/` won't work for a
  function — instead use `next.config.mjs` → `outputFileTracingIncludes` to pull
  `data/bpm-index.sqlite` into the route bundle), and open it **read-only** (`new Database(path,
  { readonly: true })`). First checkpoint it to a single clean file (below) so there's no WAL.
- **Refresh cadence:** every catalogue update means committing a new .sqlite and redeploying.
  Fine for occasional updates, annoying if you crawl often.

This is simplest operationally (one artifact, no accounts) but loses prod writes and couples
data updates to deploys. **Turso is the better fit if you want the index to keep growing.**

---

## Pre-deploy housekeeping (either path)
- **Collapse the WAL into one clean file before shipping/dumping:**
  `node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/bpm-index.sqlite');d.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;')"`
  (gets rid of the 5 MB `-wal` and compacts the file).
- **Pin Node** in `package.json` (`"engines": { "node": "22.x" }`) so local Node 25 vs Vercel
  don't surprise you.
- **Force routes to the Node runtime** (not Edge — neither driver runs on Edge). They're
  already dynamic; add `export const runtime = "nodejs"` to be explicit.
- **Cache the read APIs:** add `Cache-Control: s-maxage=…` to `/api/bpm/search` so Vercel's
  CDN serves repeat catalogue queries without hitting a function/DB.

## Risks / good-citizen notes for a public deploy
- **Spotify** stays in dev mode (client-credentials, server-side, token cached). Fine for the
  "Search Spotify" tab; under heavy traffic it could hit Spotify's rate limit, but the app now
  serves most queries from the index, so exposure is low. Don't expose the client secret
  (it's server-only — keep it that way).
- **iTunes `/api/preview`** calls Apple from Vercel's IPs. Under load this could look like
  scraping; mitigate by caching responses (`s-maxage`) and only calling it for tracks not
  already in the index (the index already carries `preview_url` for crawled tracks).
- **Vercel Hobby is free but non-commercial.** If you ever monetize, that's Pro ($20/mo).
  Bandwidth/function limits on Hobby are comfortable for a sharing-with-friends launch.
- **Abuse surface:** rate-limit `/api/bpm` (the only writer) if you keep cache-on-detect in
  prod, and keep the server-side host allowlist on `/api/preview` (iTunes only) so it can't be
  used as an open fetch proxy.

## Why not just use Neon Postgres?

Neon is a great serverless Postgres (it's what Vercel Postgres is built on) and it would
work. The catch is purely that **this codebase is SQLite/FTS5 from top to bottom**, so Neon
is a migration, not a config change — while Turso is the *same engine* we already run locally.

What Postgres would force us to rewrite:
- **Full-text search.** Our search uses SQLite **FTS5** — an external-content virtual table
  + sync triggers, `tracks_fts MATCH 'lose* your*'`, and `bm25()` ranking. Postgres has no
  FTS5; you'd rebuild it as a `tsvector` column + GIN index + `to_tsquery`/`ts_rank` (or
  `pg_trgm` for substring). Different schema, different query, re-test matching.
- **The closeness SQL.** We rank with `MIN(ABS(?-bpm), ABS(?-2*bpm))`. In SQLite `MIN` is a
  scalar; in Postgres `MIN` is an aggregate — you'd switch to `LEAST(...)`. Small, but it's
  exactly the kind of dialect papercut that adds up.
- **The crawler's write model.** Today it writes a **local file** offline (fast, no network,
  trivially resumable). Against Neon every `upsertTrack` is a network round-trip to the cloud
  — you'd want to batch inserts and you lose the convenient local-file workflow (or run a
  local Postgres for dev). Turso keeps the local `file:` model and pushes to the cloud copy.
- **`ON CONFLICT(norm) DO UPDATE`** ports cleanly (both support upsert), so that part's fine.

Net: Neon ≈ rewrite the FTS layer + SQL dialect fixes + a new crawler write path. Turso ≈
swap the driver and make a few functions `async`, keeping the schema, FTS5, and the local
crawler as-is.

**When Neon is the better call instead:** if you plan to grow this into a real relational
app (user accounts, saved playlists, auth, multi-table joins), want the Postgres ecosystem /
broad familiarity, value Neon's stability/longevity, or want the tightest first-party Vercel
integration. For a single read-mostly table with full-text + a tempo sort, SQLite is the
right-sized tool and Turso is the lower-friction host.

## Bottom line
- Cheapest *and* keeps the app fully working (writes + search + growth): **Turso free tier +
  Vercel Hobby = $0**, ~a half-day of async refactor.
- Cheapest with zero external services: **bundle the 9 MB DB read-only via `better-sqlite3`**,
  accept a read-only prod index and redeploy-to-update.
