import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Daily background OMDb rating backfill. Processes films that have an imdb_id
// but no imdb_rating, fetching ratings from OMDb and updating the row.
//
// Issue #69 + #74: previously, fetchOmdbRating was called inline from
// upsertFilm during session seeding. That added 200-500ms per uncached film
// and made the lobby loading slow. Now upsertFilm doesn't call OMDb; this
// cron runs daily (after cleanup at 4am UTC, before digest at 8am UTC) to
// fill in ratings asynchronously. New films appear in the deck without a
// rating for at most ~24 hours, then become rated automatically.
//
// OMDb free tier is 1000 req/day; we cap to BATCH_LIMIT to stay well under.

const BATCH_LIMIT = 500;
const REQ_DELAY_MS = 100;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchOmdbRating(imdbId: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${apiKey}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.imdbRating && data.imdbRating !== "N/A" ? data.imdbRating : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const omdbKey = process.env.OMDB_API_KEY;
  if (!omdbKey) {
    return NextResponse.json({ error: "OMDB_API_KEY not configured" }, { status: 500 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: films, error } = await supabase
    .from("films")
    .select("id, title, imdb_id")
    .not("imdb_id", "is", null)
    .is("imdb_rating", null)
    .limit(BATCH_LIMIT);

  if (error) {
    console.error("[backfill-ratings] DB error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!films || films.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, updated: 0 });
  }

  let updated = 0;
  let skipped = 0;

  for (const film of films) {
    const rating = await fetchOmdbRating(film.imdb_id as string, omdbKey);
    if (!rating) {
      skipped++;
      // Still pause to keep within OMDb rate budget
      await sleep(REQ_DELAY_MS);
      continue;
    }

    const { error: updateError } = await supabase
      .from("films")
      .update({ imdb_rating: rating })
      .eq("id", film.id);

    if (updateError) {
      console.error(`[backfill-ratings] update error for ${film.id}:`, updateError.message);
      skipped++;
    } else {
      updated++;
    }

    await sleep(REQ_DELAY_MS);
  }

  console.log(`[backfill-ratings] processed ${films.length} films — ${updated} updated, ${skipped} skipped`);
  return NextResponse.json({ ok: true, processed: films.length, updated, skipped });
}
