// Ergonomic querying of the BPM index, sorted by cadence closeness.
//
// "Closeness" is cadence-aware, matching the app's matchOf: a track can fit a
// stride at its own tempo (1×) or double-time (2×) — an 85-BPM track fits a
// 170 spm stride. We rank by the smaller of |target − bpm| and |target − 2·bpm|.
//
// Self-contained (only depends on the index) so it runs in plain Node scripts
// and in Next.js route handlers alike. The ranking is computed in SQL so it
// stays fast as the index grows to hundreds of thousands of rows.

import { db } from "./bpm-index.mjs";

// Cadence-aware distance for a single track. Mirrors lib/runplan.js matchOf.
export function bpmDistance(trackBpm, target) {
  if (trackBpm == null || target == null) {
    return { delta: Infinity, ratio: null, effBpm: null, level: "none" };
  }
  const d1 = Math.abs(target - trackBpm);
  const d2 = Math.abs(target - trackBpm * 2);
  const double = d2 < d1;
  const delta = double ? d2 : d1;
  return {
    delta,
    ratio: double ? "2×" : "1×",
    effBpm: double ? trackBpm * 2 : trackBpm,
    level: levelOf(delta),
  };
}

export function levelOf(delta) {
  if (delta == null || !isFinite(delta)) return "none";
  return delta <= 3 ? "good" : delta <= 8 ? "warn" : "bad";
}

// SQL fragment for the cadence-aware delta + which tempo (1×/2×) won.
// Columns are qualified (tracks.*) so they're unambiguous when joined to the FTS table.
const DELTA_SQL = "MIN(ABS(? - tracks.bpm), ABS(? - 2 * tracks.bpm))";
const RATIO_SQL = "CASE WHEN ABS(? - 2 * tracks.bpm) < ABS(? - tracks.bpm) THEN '2×' ELSE '1×' END";

// Turn a free-text query into an FTS5 MATCH expression: each word becomes a
// prefix term ("lose your" -> 'lose* your*'), punctuation stripped for safety.
function toMatch(query) {
  const terms = (query || "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return terms.length ? terms.map((t) => `${t}*`).join(" ") : null;
}

/**
 * Search the index.
 *
 * @param {object} opts
 * @param {number} [opts.bpm]      Target cadence (spm/BPM). If given, results are
 *                                 sorted nearest-first by cadence closeness.
 * @param {number} [opts.within]   Only return tracks within this many BPM of the
 *                                 target (after 1×/2× folding).
 * @param {string} [opts.genre]    Exact genre filter ("rock" | "rap").
 * @param {string} [opts.artist]   Substring match on artist.
 * @param {string} [opts.query]    Substring match on title OR artist.
 * @param {boolean}[opts.hasBpm]   Require a known BPM (default true).
 * @param {number} [opts.limit]    Default 50.
 * @param {number} [opts.offset]   Default 0.
 * @returns {Array} rows, each with added { delta, ratio, level } when bpm given.
 */
export function search({
  bpm = null,
  within = null,
  genre = null,
  artist = null,
  query = null,
  hasBpm = true,
  sort = "closeness", // "closeness" | "popularity"
  limit = 50,
  offset = 0,
} = {}) {
  // Full-text query over name / artist / album, via the FTS5 index.
  const match = toMatch(query);
  const from = match
    ? "tracks JOIN tracks_fts ON tracks_fts.rowid = tracks.id"
    : "tracks";

  const where = [];
  const whereParams = [];
  if (match) {
    where.push("tracks_fts MATCH ?");
    whereParams.push(match);
  }
  if (hasBpm || bpm != null) where.push("tracks.bpm IS NOT NULL");
  if (genre) {
    where.push("tracks.genre = ?");
    whereParams.push(genre);
  }
  if (artist) {
    where.push("tracks.artist LIKE ?");
    whereParams.push(`%${artist}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // No target BPM → popularity, else text relevance (when searching), else alphabetical.
  if (bpm == null) {
    const order = sort === "popularity"
      ? "ORDER BY (tracks.popularity IS NULL), tracks.popularity DESC"
      : match ? "ORDER BY bm25(tracks_fts)" : "ORDER BY tracks.artist, tracks.title";
    const rows = db()
      .prepare(`SELECT tracks.* FROM ${from} ${whereSql} ${order} LIMIT ? OFFSET ?`)
      .all(...whereParams, limit, offset);
    return rows;
  }

  // Target given → rank by cadence closeness, entirely in SQL.
  const inner = `
    SELECT tracks.*, ${DELTA_SQL} AS delta, ${RATIO_SQL} AS ratio
    FROM ${from} ${whereSql}`;
  const innerParams = [bpm, bpm, bpm, bpm, ...whereParams];

  const havingSql = within != null ? "WHERE delta <= ?" : "";
  // Popularity sort surfaces the most popular tracks that match the cadence
  // (closeness as tiebreak); otherwise nearest-cadence first.
  const orderClause = sort === "popularity"
    ? "ORDER BY (popularity IS NULL), popularity DESC, delta ASC"
    : "ORDER BY delta ASC, artist, title";
  const sql = `
    SELECT * FROM (${inner}) ${havingSql}
    ${orderClause}
    LIMIT ? OFFSET ?`;
  const params = [...innerParams];
  if (within != null) params.push(within);
  params.push(limit, offset);

  const rows = db().prepare(sql).all(...params);
  return rows.map((r) => ({ ...r, level: levelOf(r.delta) }));
}

// Convenience: the N tracks whose tempo is closest to a target cadence.
export function closest(bpm, n = 20, opts = {}) {
  return search({ ...opts, bpm, limit: n });
}

// Distinct genres / artists present in the index (for building filter UIs).
export function genres() {
  return db()
    .prepare(
      "SELECT genre, COUNT(*) n FROM tracks WHERE genre IS NOT NULL GROUP BY genre ORDER BY n DESC"
    )
    .all();
}

export function artists(genre = null) {
  const sql = genre
    ? "SELECT artist, COUNT(*) n FROM tracks WHERE genre = ? GROUP BY artist ORDER BY n DESC"
    : "SELECT artist, COUNT(*) n FROM tracks GROUP BY artist ORDER BY n DESC";
  return db()
    .prepare(sql)
    .all(...(genre ? [genre] : []));
}
