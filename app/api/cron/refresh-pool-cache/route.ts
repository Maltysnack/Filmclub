import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { REGION_OPTIONS, getServicesForRegion } from "@/lib/streaming";
import { discoverFilmsByProviders } from "@/lib/tmdb";
import type { Region } from "@/types";

// Pages fetched per service per sort — 2 pages = 40 films each pass.
// popularity + rating = up to 80 unique films cached per service.
const PAGES_PER_SORT = 2;

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let totalInserted = 0;
  const errors: string[] = [];

  // Process regions sequentially to avoid overwhelming the TMDB API,
  // but fan out all services within a region concurrently.
  for (const { value: region } of REGION_OPTIONS) {
    const services = getServicesForRegion(region as Region);

    const results = await Promise.allSettled(
      services.map(async (service) => {
        // Fetch popularity + top-rated pages concurrently for this service
        const [popularFilms, ratedFilms] = await Promise.all([
          discoverFilmsByProviders([service.tmdbId], PAGES_PER_SORT, region as Region, "popularity.desc"),
          discoverFilmsByProviders([service.tmdbId], PAGES_PER_SORT, region as Region, "vote_average.desc", 500),
        ]);

        // Merge and deduplicate — popularity results listed first
        const seen = new Set<number>();
        const films: { id: number; original_language: string }[] = [];
        for (const f of [...popularFilms, ...ratedFilms]) {
          if (!seen.has(f.id)) {
            seen.add(f.id);
            films.push({ id: f.id, original_language: f.original_language ?? "en" });
          }
        }

        if (films.length === 0) return { service: service.id, inserted: 0 };

        // Swap out the old cache rows atomically: delete then insert.
        // The gap where rows are missing is sub-millisecond; pool.ts falls
        // back to live TMDB if the cache comes up empty.
        await supabase
          .from("provider_pool_cache")
          .delete()
          .eq("provider_id", service.id)
          .eq("region", region);

        const rows = films.map((f) => ({
          provider_id: service.id,
          region,
          tmdb_id: f.id,
          original_language: f.original_language,
        }));

        const { error } = await supabase
          .from("provider_pool_cache")
          .insert(rows);

        if (error) throw new Error(`${service.id}/${region}: ${error.message}`);
        return { service: service.id, inserted: films.length };
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        totalInserted += r.value.inserted;
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        errors.push(msg);
        console.error("[refresh-pool-cache] error:", msg);
      }
    }
  }

  console.log(`[refresh-pool-cache] done — ${totalInserted} rows cached, ${errors.length} errors`);
  return NextResponse.json({
    ok: true,
    totalInserted,
    ...(errors.length > 0 && { errors }),
  });
}
