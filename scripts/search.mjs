// Ergonomic CLI over the BPM index. Examples:
//   node scripts/search.mjs 170                       # closest to 170 spm
//   node scripts/search.mjs --bpm 170 --genre rap --within 5
//   node scripts/search.mjs --bpm 165 --artist Metallica --limit 30
//   node scripts/search.mjs --query closet            # text search
import { search, genres } from "../lib/bpm-search.mjs";

const argv = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const num = (v) => (v == null ? null : Number(v));

// A bare first arg that's a number is treated as the target BPM.
const bare = argv[0] && !argv[0].startsWith("--") ? Number(argv[0]) : null;

const opts = {
  bpm: bare ?? num(flag("bpm")),
  within: num(flag("within")),
  genre: flag("genre"),
  artist: flag("artist"),
  query: flag("query") || flag("q"),
  limit: num(flag("limit")) || 25,
};

const rows = search(opts);
if (!rows.length) {
  console.log("no matches.", genres().length ? "" : "(index is empty — run npm run crawl)");
} else {
  for (const r of rows) {
    const close =
      r.delta != null ? `${r.ratio} Δ${r.delta} ${r.level}`.padEnd(14) : "".padEnd(14);
    console.log(`${String(r.bpm ?? "—").padStart(3)} bpm  ${close}  ${r.artist} – ${r.title}`);
  }
  console.log(`\n${rows.length} result(s)${opts.bpm ? ` near ${opts.bpm} spm` : ""}.`);
}
