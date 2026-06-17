// Enrich indexed tracks with a popularity score (0–100), so the catalogue can
// be ranked by popularity. iTunes has no popularity metric and this Spotify app
// (dev mode) no longer exposes one either, so we use Deezer's public `rank`
// (no API key needed). Resumable: only fills rows that don't have it yet.
//
// Run: npm run enrich:popularity            (all un-enriched tracks)
//      npm run enrich:popularity -- --limit 200
//      npm run enrich:popularity -- --refresh
// Env: DEEZER_MS (ms between calls, default 250 — Deezer allows ~50 req / 5s).

import { db } from "../lib/bpm-index.mjs";
import { trackPopularity } from "../lib/deezer.mjs";

const MS = Number(process.env.DEEZER_MS || 250);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const li = args.indexOf("--limit");
const limit = li >= 0 ? Number(args[li + 1]) : null;
const refresh = args.includes("--refresh");

const d = db();
const rows = d
  .prepare(
    `SELECT id, title, artist FROM tracks
     WHERE ${refresh ? "1=1" : "popularity IS NULL"}
     ORDER BY id ${limit ? `LIMIT ${limit}` : ""}`
  )
  .all();

console.log(`Enriching ${rows.length} track(s) with Deezer popularity (${MS}ms between calls)…`);
const upd = d.prepare("UPDATE tracks SET popularity = ? WHERE id = ?");

let matched = 0, missed = 0;
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  try {
    const meta = await trackPopularity(r.title, r.artist);
    if (meta && meta.popularity != null) { upd.run(meta.popularity, r.id); matched++; }
    else missed++;
  } catch (e) {
    console.warn(`  ! ${r.artist} – ${r.title}: ${e.message}`);
  }
  if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${rows.length}  (${matched} matched, ${missed} no match)`);
  await sleep(MS);
}
console.log(`\nDone: ${matched} enriched, ${missed} unmatched, of ${rows.length}.`);
