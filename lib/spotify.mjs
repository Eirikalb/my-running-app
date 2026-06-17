// Server-side Spotify helper using the Client Credentials flow.
// No user login — just app credentials. Token is cached in module memory.

let cached = { token: null, expiresAt: 0 };

const isReal = (v) => Boolean(v) && !v.startsWith("your_");

export function spotifyConfigured() {
  return isReal(process.env.SPOTIFY_CLIENT_ID) && isReal(process.env.SPOTIFY_CLIENT_SECRET);
}

async function getToken() {
  const now = Date.now();
  if (cached.token && now < cached.expiresAt - 5000) return cached.token;

  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Spotify auth failed (${res.status}): ${txt}`);
  }
  const data = await res.json();
  cached = { token: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return cached.token;
}

// NOTE: this dev-mode / client-credentials Spotify app no longer returns a
// `popularity` field on track objects (it was stripped alongside preview_url /
// audio-features), so popularity ranking is sourced from Deezer instead — see
// lib/deezer.mjs and scripts/enrich-popularity.mjs.

// limit is capped at 10: Spotify apps in development mode reject limit > 10.
export async function searchTracks(query, limit = 10) {
  const token = await getToken();
  const url = `https://api.spotify.com/v1/search?type=track&limit=${limit}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Spotify search failed (${res.status}): ${txt}`);
  }
  const data = await res.json();
  const items = (data.tracks?.items || []).map((t) => ({
    id: t.id,
    name: t.name,
    artist: (t.artists || []).map((a) => a.name).join(", "),
    durationMs: t.duration_ms,
    art: t.album?.images?.slice(-1)[0]?.url || null,
    previewUrl: t.preview_url || null,
  }));
  return items;
}
