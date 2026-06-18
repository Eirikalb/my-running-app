import { NextResponse } from "next/server";
import { resolveUri, spotifyConfigured } from "../../../../lib/spotify.mjs";

export const dynamic = "force-dynamic";

// POST /api/spotify/resolve  body: { tracks: [{ title, artist, spotifyId? }] }
// -> { uris: [...], matched, total }. Resolves each playlist track to a
// spotify:track URI (using a provided id when present, else searching).
export async function POST(request) {
  if (!spotifyConfigured()) {
    return NextResponse.json({ error: "Spotify not configured on the server." }, { status: 503 });
  }
  try {
    const { tracks } = await request.json();
    const all = Array.isArray(tracks) ? tracks : [];
    const total = all.length;
    const list = all.slice(0, 200); // cap on outbound Spotify calls per request
    const uris = [];
    const unmatched = [];
    for (const t of list) {
      if (t?.spotifyId) { uris.push(`spotify:track:${t.spotifyId}`); continue; }
      try {
        const u = await resolveUri(t?.title, t?.artist);
        if (u) uris.push(u);
        else unmatched.push({ title: t?.title, artist: t?.artist });
      } catch {
        unmatched.push({ title: t?.title, artist: t?.artist });
      }
    }
    return NextResponse.json({ uris, matched: uris.length, total, unmatched, truncated: total > 200 });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 400 });
  }
}
