// Quick look at how full the BPM index is. Run: node scripts/stats.mjs
import { stats } from "../lib/bpm-index.mjs";

const s = stats();
console.log(`\nBPM index: ${s.total} tracks total, ${s.withBpm} with BPM (${
  s.total ? Math.round((100 * s.withBpm) / s.total) : 0
}%)\n`);

console.log("by source:");
for (const r of s.bySource) console.log(`  ${r.source ?? "?"}: ${r.n}`);

console.log("\ntop artists:");
for (const a of s.topArtists) {
  console.log(`  ${String(a.n).padStart(4)}  ${a.withBpm} bpm  ${a.artist}`);
}
console.log();
