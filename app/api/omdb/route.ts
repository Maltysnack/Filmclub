import { NextRequest, NextResponse } from "next/server";

// Server-side proxy for OMDb so the API key is never exposed to the client.
// Usage: GET /api/omdb?imdb_id=tt0111161
export async function GET(req: NextRequest) {
  const imdbId = req.nextUrl.searchParams.get("imdb_id");
  if (!imdbId) return NextResponse.json({ error: "missing imdb_id" }, { status: 400 });

  const key = process.env.OMDB_API_KEY;
  if (!key) return NextResponse.json({ error: "OMDB_API_KEY not configured" }, { status: 500 });

  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${key}`);
    if (!res.ok) return NextResponse.json({ rating: null });
    const data = await res.json();
    const rating = data.imdbRating && data.imdbRating !== "N/A" ? data.imdbRating : null;
    return NextResponse.json({ rating });
  } catch {
    return NextResponse.json({ rating: null });
  }
}
