// Run once: node scripts/backfill-imdb-ratings.mjs
// Finds all films in the DB with an imdb_id but no imdb_rating and fills them in via OMDB.
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and OMDB_API_KEY in .env.local

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local manually
const envPath = resolve(process.cwd(), ".env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf-8")
    .split("\n")
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const OMDB_KEY = env.OMDB_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !OMDB_KEY) {
  console.error("Missing env vars — need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OMDB_API_KEY");
  process.exit(1);
}

async function fetchRating(imdbId) {
  const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_KEY}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.imdbRating && data.imdbRating !== "N/A" ? data.imdbRating : null;
}

async function main() {
  // Fetch all films with imdb_id but no imdb_rating
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/films?select=id,title,imdb_id&imdb_id=not.is.null&imdb_rating=is.null&limit=1000`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const films = await res.json();
  console.log(`Found ${films.length} films to backfill`);

  let updated = 0;
  let skipped = 0;

  for (const film of films) {
    const rating = await fetchRating(film.imdb_id);
    if (!rating) { skipped++; continue; }

    await fetch(`${SUPABASE_URL}/rest/v1/films?id=eq.${film.id}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ imdb_rating: rating }),
    });

    console.log(`  ✓ ${film.title} → ${rating}`);
    updated++;

    // OMDB free tier: 1000 requests/day — small delay to be safe
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\nDone — ${updated} updated, ${skipped} skipped (no rating available)`);
}

main().catch(console.error);
