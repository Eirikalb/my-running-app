import { NextResponse } from "next/server";
import { getByName, upsertTrack } from "../../../lib/neon.mjs";

export const dynamic = "force-dynamic";

// GET /api/bpm?title=&artist=  -> { bpm } from the index, if known.
export async function GET(request) {
  const title = request.nextUrl.searchParams.get("title")?.trim();
  const artist = request.nextUrl.searchParams.get("artist")?.trim();
  if (!title) return NextResponse.json({ error: "Missing title" }, { status: 400 });
  const row = await getByName(artist, title);
  return NextResponse.json({ bpm: row?.bpm ?? null, cached: Boolean(row) });
}

// POST /api/bpm  -> persist a BPM the app detected live (cache-on-detect).
export async function POST(request) {
  try {
    const t = await request.json();
    if (!t?.title || t?.bpm == null) {
      return NextResponse.json({ error: "Need title and bpm" }, { status: 400 });
    }
    await upsertTrack({ ...t, source: "live-detect" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 400 });
  }
}
