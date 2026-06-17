// Publish the local SQLite index to Neon (Postgres). Run after crawls/enrichment.
// Reads the local DB, ensures the Postgres schema, and batch-upserts every row.
// Idempotent (ON CONFLICT (norm) DO UPDATE) so re-running just refreshes prod.
//
// Run: npm run push:neon          (needs DATABASE_URL in .env.local)
import { db } from "../lib/bpm-index.mjs";
import { getSql, ensureSchema } from "../lib/neon.mjs";

const COLS = [
  "norm", "itunes_id", "title", "artist", "collection", "genre", "bpm",
  "duration_ms", "preview_url", "art_url", "popularity", "spotify_id",
  "release_date", "source", "detected_at",
];
const BATCH = 500;

const sql = getSql(); // throws if DATABASE_URL is missing
console.log("Ensuring Neon schema…");
await ensureSchema();

const rows = db().prepare(`SELECT ${COLS.join(", ")} FROM tracks`).all();
console.log(`Pushing ${rows.length} rows to Neon (batches of ${BATCH})…`);

const upd = COLS.filter((c) => c !== "norm" && c !== "source")
  .map((c) => `${c} = COALESCE(EXCLUDED.${c}, tracks.${c})`)
  .join(", ");

for (let i = 0; i < rows.length; i += BATCH) {
  const slice = rows.slice(i, i + BATCH);
  const params = [];
  const tuples = slice.map((r) => {
    const base = params.length;
    params.push(r.norm, r.itunes_id, r.title, r.artist, r.collection, r.genre, r.bpm,
      r.duration_ms, r.preview_url, r.art_url, r.popularity, r.spotify_id,
      r.release_date, r.source, r.detected_at);
    return `(${COLS.map((_, j) => `$${base + j + 1}`).join(", ")})`;
  });
  const text = `INSERT INTO tracks (${COLS.join(", ")}) VALUES ${tuples.join(", ")}
    ON CONFLICT (norm) DO UPDATE SET ${upd}, source = COALESCE(tracks.source, EXCLUDED.source)`;
  await sql.query(text, params);
  console.log(`  ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
}

const res = await sql.query("SELECT COUNT(*)::int AS n FROM tracks");
const n = (Array.isArray(res) ? res : res.rows)[0].n;
console.log(`Done. Neon now holds ${n} tracks.`);
