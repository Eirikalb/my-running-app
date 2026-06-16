import { NextResponse } from "next/server";

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
    return NextResponse.json({
      previewUrl: hit.previewUrl,
      matched: { title: hit.trackName, artist: hit.artistName },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 502 });
  }
}
