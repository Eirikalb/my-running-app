// Deezer's public API needs no key and returns a `rank` popularity score per
// track (roughly 0–1,000,000; higher = more popular). We use it to rank the
// index, since this Spotify app (dev mode / client-credentials) no longer
// exposes a popularity field. Rank is normalized to 0–100 for the index.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function trackPopularity(title, artist) {
  const clean =
    title.replace(/\([^)]*\)/g, " ").replace(/\s-\s.*$/, " ").replace(/\s+/g, " ").trim() || title;
  const url = `https://api.deezer.com/search?limit=5&q=${encodeURIComponent(`${clean} ${artist}`)}`;

  const res = await fetch(url);
  if (res.status === 429) {
    await sleep(2000);
    return trackPopularity(title, artist);
  }
  if (!res.ok) throw new Error(`Deezer ${res.status}`);
  const data = await res.json();
  // Deezer signals quota errors as HTTP 200 with an { error } body.
  if (data.error) {
    if (data.error.code === 4) { await sleep(2000); return trackPopularity(title, artist); }
    throw new Error(`Deezer: ${data.error.message || data.error.type}`);
  }

  const items = data.data || [];
  if (!items.length) return null;
  const aWant = artist.toLowerCase();
  const hit = items.find((t) => (t.artist?.name || "").toLowerCase() === aWant) || items[0];
  if (hit?.rank == null) return null;
  return { popularity: Math.min(100, Math.round(hit.rank / 10000)), rank: hit.rank, deezerId: hit.id };
}
