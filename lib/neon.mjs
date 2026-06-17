// Neon (serverless Postgres) query layer for the DEPLOYED app. The local crawler
// keeps writing SQLite (lib/bpm-index.mjs); scripts/push-to-neon.mjs publishes
// that into Postgres. This module is self-contained (no node:sqlite import) so the
// Vercel bundle never pulls in the local SQLite path.
//
// SQL builders are pure ({ text, params }) so they can be unit-tested against a
// local Postgres (PGlite) without a live Neon connection.

import { neon } from "@neondatabase/serverless";

let _sql = null;
export function getSql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set (Neon connection string).");
  _sql = neon(url);
  return _sql;
}

// Run a parameterized query and always return a plain rows array.
async function run(text, params = []) {
  const res = await getSql().query(text, params);
  return Array.isArray(res) ? res : res?.rows ?? [];
}

export const COLS =
  "id, norm, itunes_id, title, artist, collection, genre, bpm, duration_ms, preview_url, art_url, popularity, spotify_id, release_date, source, detected_at";

export function normKey(artist, title) {
  return `${artist || ""} | ${title || ""}`.toLowerCase().replace(/\s+/g, " ").trim();
}

export function levelOf(delta) {
  if (delta == null || !isFinite(delta)) return "none";
  return delta <= 3 ? "good" : delta <= 8 ? "warn" : "bad";
}

// Free text -> Postgres tsquery: prefix terms joined with AND ("lose your" -> "lose:* & your:*").
export function toTsQuery(query) {
  const terms = (query || "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return terms.length ? terms.map((t) => `${t}:*`).join(" & ") : null;
}

// Schema as discrete statements (Neon's HTTP driver runs one statement per call).
export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS tracks (
     id           BIGSERIAL PRIMARY KEY,
     norm         TEXT UNIQUE NOT NULL,
     itunes_id    BIGINT,
     title        TEXT NOT NULL,
     artist       TEXT NOT NULL,
     collection   TEXT,
     genre        TEXT,
     bpm          INTEGER,
     duration_ms  INTEGER,
     preview_url  TEXT,
     art_url      TEXT,
     popularity   INTEGER,
     spotify_id   TEXT,
     release_date TEXT,
     source       TEXT,
     detected_at  TEXT,
     fts tsvector GENERATED ALWAYS AS (
       to_tsvector('simple',
         coalesce(title,'') || ' ' || coalesce(artist,'') || ' ' || coalesce(collection,''))
     ) STORED
   )`,
  `CREATE INDEX IF NOT EXISTS idx_tracks_bpm   ON tracks(bpm)`,
  `CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre)`,
  `CREATE INDEX IF NOT EXISTS idx_tracks_fts   ON tracks USING GIN(fts)`,
];

export async function ensureSchema() {
  for (const stmt of SCHEMA_STATEMENTS) await run(stmt);
}

// ---- search (mirrors lib/bpm-search.mjs, Postgres dialect) -------------------
export function buildSearch({
  bpm = null,
  within = null,
  genre = null,
  artist = null,
  query = null,
  hasBpm = true,
  sort = "closeness",
  limit = 50,
  offset = 0,
} = {}) {
  const params = [];
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };

  const ts = toTsQuery(query);
  const where = [];
  if (ts) where.push(`fts @@ to_tsquery('simple', ${p(ts)})`);
  if (hasBpm || bpm != null) where.push("bpm IS NOT NULL");
  if (genre) where.push(`genre = ${p(genre)}`);
  if (artist) where.push(`artist ILIKE ${p(`%${artist}%`)}`);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // No target BPM -> popularity, else text relevance (when searching), else alphabetical.
  if (bpm == null) {
    const order =
      sort === "popularity"
        ? "ORDER BY popularity DESC NULLS LAST"
        : ts
        ? `ORDER BY ts_rank(fts, to_tsquery('simple', ${p(ts)})) DESC`
        : "ORDER BY artist, title";
    const text = `SELECT ${COLS} FROM tracks ${whereSql} ${order} LIMIT ${p(limit)} OFFSET ${p(offset)}`;
    return { text, params };
  }

  // Target given -> rank by cadence closeness (1×/2× fold), entirely in SQL.
  const b = p(bpm); // reused below — Postgres allows referencing $n multiple times
  const deltaExpr = `LEAST(ABS(${b} - bpm), ABS(${b} - 2 * bpm))`;
  const ratioExpr = `CASE WHEN ABS(${b} - 2 * bpm) < ABS(${b} - bpm) THEN '2×' ELSE '1×' END`;
  const inner = `SELECT ${COLS}, ${deltaExpr} AS delta, ${ratioExpr} AS ratio FROM tracks ${whereSql}`;
  const havingSql = within != null ? `WHERE delta <= ${p(within)}` : "";
  const order =
    sort === "popularity"
      ? "ORDER BY popularity DESC NULLS LAST, delta ASC"
      : "ORDER BY delta ASC, artist, title";
  const text = `SELECT * FROM (${inner}) sub ${havingSql} ${order} LIMIT ${p(limit)} OFFSET ${p(offset)}`;
  return { text, params };
}

export async function search(opts = {}) {
  const { text, params } = buildSearch(opts);
  const rows = await run(text, params);
  return opts.bpm != null
    ? rows.map((r) => ({ ...r, delta: Number(r.delta), level: levelOf(Number(r.delta)) }))
    : rows;
}

export async function getByName(artist, title) {
  const rows = await run(`SELECT ${COLS} FROM tracks WHERE norm = $1`, [normKey(artist, title)]);
  return rows[0] || null;
}

export async function genres() {
  return run(
    "SELECT genre, COUNT(*)::int AS n FROM tracks WHERE genre IS NOT NULL GROUP BY genre ORDER BY n DESC"
  );
}

// ---- upsert (cache-on-detect + push) -----------------------------------------
const UPSERT_COLS = [
  "norm", "itunes_id", "title", "artist", "collection", "genre", "bpm",
  "duration_ms", "preview_url", "art_url", "popularity", "spotify_id",
  "release_date", "source", "detected_at",
];

export function buildUpsert(t) {
  const vals = [
    normKey(t.artist, t.title),
    t.itunesId ?? null,
    t.title,
    t.artist,
    t.collection ?? null,
    t.genre ?? null,
    t.bpm ?? null,
    t.durationMs ?? null,
    t.previewUrl ?? null,
    t.art ?? null,
    t.popularity ?? null,
    t.spotifyId ?? null,
    t.releaseDate ?? null,
    t.source ?? "live-detect",
    t.detectedAt ?? new Date().toISOString(),
  ];
  const ph = UPSERT_COLS.map((_, i) => `$${i + 1}`).join(", ");
  const upd = UPSERT_COLS.filter((c) => c !== "norm" && c !== "source")
    .map((c) => `${c} = COALESCE(EXCLUDED.${c}, tracks.${c})`)
    .join(", ");
  const text = `INSERT INTO tracks (${UPSERT_COLS.join(", ")}) VALUES (${ph})
    ON CONFLICT (norm) DO UPDATE SET ${upd}, source = COALESCE(tracks.source, EXCLUDED.source)`;
  return { text, params: vals };
}

export async function upsertTrack(t) {
  const { text, params } = buildUpsert({ ...t, source: t.source ?? "live-detect" });
  await run(text, params);
}
