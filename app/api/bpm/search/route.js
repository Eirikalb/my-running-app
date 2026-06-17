import { NextResponse } from "next/server";
import { search, genres } from "../../../../lib/neon.mjs";

export const dynamic = "force-dynamic";

// GET /api/bpm/search?bpm=170&genre=rap&within=5&artist=&q=&limit=&offset=
// Returns index tracks sorted by cadence closeness to `bpm`, plus the list of
// genres present in the index (for building filter chips).
export async function GET(request) {
  const p = request.nextUrl.searchParams;
  const num = (k) => (p.get(k) != null && p.get(k) !== "" ? Number(p.get(k)) : null);
  try {
    const items = await search({
      bpm: num("bpm"),
      within: num("within"),
      genre: p.get("genre") || null,
      artist: p.get("artist") || null,
      query: p.get("q") || null,
      sort: p.get("sort") || "closeness",
      limit: num("limit") ?? 50,
      offset: num("offset") ?? 0,
    });
    return NextResponse.json({ items, genres: await genres() });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
