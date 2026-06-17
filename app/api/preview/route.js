import { NextResponse } from "next/server";
import { getByName } from "../../../lib/neon.mjs";

export const dynamic = "force-dynamic";

// Finds a 30s preview clip for a track via the free iTunes Search API (no key).
// The browser then fetches the returned previewUrl directly (Apple serves it
// with `Access-Control-Allow-Origin: *`) and analyzes it for BPM.
export async function GET(request) {
  const title = request.nextUrl.searchParams.get("title")?.trim();
  const artist = request.nextUrl.searchParams.get("artist")?.trim();
  if (!title) return NextResponse.json({ error: "Missing title" }, { status: 400 });

  const term = [artist, title].filter(Boolean).join(" ");
  const url = `https://itunes.apple.com/search?entity=song&limit=5&term=${encodeURIComponent(term)}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: `iTunes error ${res.status}` }, { status: 502 });
    const data = await res.json();
    const hit = (data.results || []).find((r) => r.previewUrl);
    if (!hit) return NextResponse.json({ error: "No preview found for this track", previewUrl: null });

    // If we've already analyzed this track, hand back the cached BPM so the
    // client can skip downloading + decoding the preview entirely.
    const cached = await getByName(hit.artistName, hit.trackName);
    return NextResponse.json({
      previewUrl: hit.previewUrl,
      matched: { title: hit.trackName, artist: hit.artistName },
      itunesId: hit.trackId,
      durationMs: hit.trackTimeMillis,
      art: hit.artworkUrl100 || hit.artworkUrl60 || null,
      cachedBpm: cached?.bpm ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 502 });
  }
}
