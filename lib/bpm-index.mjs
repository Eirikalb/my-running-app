// The BPM index: a local SQLite store that grows two ways —
//   1. the offline crawler (scripts/crawl.mjs) trickling in popular catalog, and
//   2. cache-on-detect, when the live app analyzes a preview it persists it here.
// Uses Node's built-in node:sqlite (no native dep) so it runs in plain scripts
// and in Next.js route handlers alike.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DB_PATH =
  process.env.BPM_DB_PATH || path.join(process.cwd(), "data", "bpm-index.sqlite");

let _db = null;

export function db() {
  if (_db) return _db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new DatabaseSync(DB_PATH);
  // WAL lets the crawler write while the app reads, and busy_timeout makes a
  // second writer wait instead of throwing "database is locked".
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA busy_timeout = 8000");
  _db.exec("PRAGMA synchronous = NORMAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      norm        TEXT NOT NULL UNIQUE,   -- "artist | title", lowercased — dedup key
      itunes_id   INTEGER,
      title       TEXT NOT NULL,
      artist      TEXT NOT NULL,
      collection  TEXT,                   -- album
      genre       TEXT,
      bpm         INTEGER,                -- null if undetectable
      duration_ms INTEGER,
      preview_url TEXT,
      art_url     TEXT,
      popularity  INTEGER,                -- Spotify popularity 0-100 (enriched, nullable)
      spotify_id  TEXT,                   -- enriched via Spotify match (nullable)
      release_date TEXT,                  -- from iTunes (captured on crawl)
      source      TEXT,                   -- 'itunes-crawl' | 'live-detect'
      detected_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tracks_bpm    ON tracks(bpm);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
    CREATE INDEX IF NOT EXISTS idx_tracks_genre  ON tracks(genre);

    -- Full-text search over name / artist / album (external-content FTS5,
    -- so it indexes those columns without duplicating the data).
    CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
      title, artist, collection, content='tracks', content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS tracks_ai AFTER INSERT ON tracks BEGIN
      INSERT INTO tracks_fts(rowid, title, artist, collection)
        VALUES (new.id, new.title, new.artist, new.collection);
    END;
    CREATE TRIGGER IF NOT EXISTS tracks_ad AFTER DELETE ON tracks BEGIN
      INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, collection)
        VALUES ('delete', old.id, old.title, old.artist, old.collection);
    END;
    CREATE TRIGGER IF NOT EXISTS tracks_au AFTER UPDATE ON tracks BEGIN
      INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, collection)
        VALUES ('delete', old.id, old.title, old.artist, old.collection);
      INSERT INTO tracks_fts(rowid, title, artist, collection)
        VALUES (new.id, new.title, new.artist, new.collection);
    END;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  // Migrate older DBs that predate the ranking columns.
  for (const [col, decl] of [["popularity", "INTEGER"], ["spotify_id", "TEXT"], ["release_date", "TEXT"]]) {
    const has = _db.prepare("PRAGMA table_info(tracks)").all().some((c) => c.name === col);
    if (!has) _db.exec(`ALTER TABLE tracks ADD COLUMN ${col} ${decl}`);
  }
  // Build the FTS index once for rows that predate it; the triggers keep it in
  // sync thereafter. We can't compare row counts here — external-content FTS5
  // reports the content table's count even when its index is empty — so we use
  // a one-time marker instead.
  const built = _db.prepare("SELECT value FROM meta WHERE key = 'fts_built'").get();
  if (!built) {
    _db.exec("INSERT INTO tracks_fts(tracks_fts) VALUES('rebuild')");
    _db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('fts_built', '1')").run();
  }
  return _db;
}

export function normKey(artist, title) {
  return `${artist || ""} | ${title || ""}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function getByName(artist, title) {
  return db()
    .prepare("SELECT * FROM tracks WHERE norm = ?")
    .get(normKey(artist, title));
}

// Insert or update. Won't clobber a known bpm with null (so a failed re-detect
// doesn't erase a good value); always refreshes metadata like preview_url.
export function upsertTrack(t) {
  const norm = normKey(t.artist, t.title);
  return db()
    .prepare(
      `INSERT INTO tracks
         (norm, itunes_id, title, artist, collection, genre, bpm, duration_ms, preview_url, art_url, popularity, spotify_id, release_date, source, detected_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(norm) DO UPDATE SET
         itunes_id    = COALESCE(excluded.itunes_id, tracks.itunes_id),
         collection   = COALESCE(excluded.collection, tracks.collection),
         genre        = COALESCE(excluded.genre, tracks.genre),
         bpm          = COALESCE(excluded.bpm, tracks.bpm),
         duration_ms  = COALESCE(excluded.duration_ms, tracks.duration_ms),
         preview_url  = COALESCE(excluded.preview_url, tracks.preview_url),
         art_url      = COALESCE(excluded.art_url, tracks.art_url),
         popularity   = COALESCE(excluded.popularity, tracks.popularity),
         spotify_id   = COALESCE(excluded.spotify_id, tracks.spotify_id),
         release_date = COALESCE(excluded.release_date, tracks.release_date),
         source       = COALESCE(tracks.source, excluded.source),
         detected_at  = COALESCE(excluded.detected_at, tracks.detected_at)`
    )
    .run(
      norm,
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
      t.source ?? "itunes-crawl",
      t.detectedAt ?? new Date().toISOString()
    );
}

// Per-artist crawl checkpoints, so a restart skips fully-crawled artists
// instead of re-walking their whole catalogue. Stored in the meta table.
export function isCrawled(key) {
  return Boolean(db().prepare("SELECT 1 FROM meta WHERE key = ?").get("crawl:" + key));
}
export function markCrawled(key) {
  db()
    .prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)")
    .run("crawl:" + key, new Date().toISOString());
}

export function stats() {
  const d = db();
  const total = d.prepare("SELECT COUNT(*) n FROM tracks").get().n;
  const withBpm = d.prepare("SELECT COUNT(*) n FROM tracks WHERE bpm IS NOT NULL").get().n;
  const bySource = d.prepare("SELECT source, COUNT(*) n FROM tracks GROUP BY source").all();
  const topArtists = d
    .prepare(
      "SELECT artist, COUNT(*) n, SUM(bpm IS NOT NULL) withBpm FROM tracks GROUP BY artist ORDER BY n DESC LIMIT 25"
    )
    .all();
  return { total, withBpm, bySource, topArtists };
}
