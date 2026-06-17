import { NextResponse } from "next/server";
import { searchTracks, spotifyConfigured } from "../../../../lib/spotify.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!spotifyConfigured()) {
    return NextResponse.json(
      { error: "Spotify not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env.local." },
      { status: 503 }
    );
  }
  if (!q) return NextResponse.json({ items: [] });

  try {
    const items = await searchTracks(q);
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 502 });
  }
}
