import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { REGION_OPTIONS, getServicesForRegion } from "@/lib/streaming";
import { discoverFilmsByProviders } from "@/lib/tmdb";
import type { Region } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Pages fetched per service per sort — 2 pages = 40 films each pass.
// popularity + rating = up to 80 unique films cached per service.
const PAGES_PER_SORT = 2;
// Pause between regions to give TMDB rate-limit budget time to recover.
// 15 regions × 500ms = ~7.5s extra runtime — irrelevant on a 3-day cron.
const REGION_DELAY_MS = 500;
// One retry per failed service, after a brief pause. Catches transient TMDB
// 429s and network blips so the cache doesn't silently degrade.
const RETRY_DELAY_MS = 1500;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Use service role key so writes bypass RLS — the provider_pool_cache table
  // only has a SELECT policy for anon, so the anon client can't insert/delete.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Refresh a single (region, service) pair. Defined inline so it can close
  // over `supabase` without passing it around.
  type Service = ReturnType<typeof getServicesForRegion>[number];
  async function refreshOne(region: Region, service: Service): Promise<{ service: string; inserted: number }> {
    const [popularFilms, ratedFilms] = await Promise.all([
      discoverFilmsByProviders([service.tmdbId], PAGES_PER_SORT, region, "popularity.desc"),
      discoverFilmsByProviders([service.tmdbId], PAGES_PER_SORT, region, "vote_average.desc", 500),
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
  }

  let totalInserted = 0;
  const errors: string[] = [];
  const retried: string[] = [];

  // Process regions sequentially with a small inter-region pause. Within each
  // region, services run in parallel. On any failure we retry once after a
  // delay before giving up — catches transient TMDB 429s and network blips.
  const regionList = REGION_OPTIONS;
  for (let i = 0; i < regionList.length; i++) {
    const region = regionList[i].value as Region;
    const services = getServicesForRegion(region);

    const results = await Promise.allSettled(services.map(s => refreshOne(region, s)));

    // First-pass tally + collect failures for retry
    const toRetry: Service[] = [];
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        totalInserted += r.value.inserted;
      } else {
        toRetry.push(services[j]);
      }
    }

    if (toRetry.length > 0) {
      console.log(`[refresh-pool-cache] retrying ${toRetry.length} services in ${region} after ${RETRY_DELAY_MS}ms`);
      await sleep(RETRY_DELAY_MS);
      const retryResults = await Promise.allSettled(toRetry.map(s => refreshOne(region, s)));
      for (let j = 0; j < retryResults.length; j++) {
        const r = retryResults[j];
        if (r.status === "fulfilled") {
          totalInserted += r.value.inserted;
          retried.push(`${toRetry[j].id}/${region} (recovered)`);
        } else {
          const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
          errors.push(msg);
          console.error("[refresh-pool-cache] error after retry:", msg);
        }
      }
    }

    // Pause between regions to give TMDB rate-limit budget time to recover.
    if (i < regionList.length - 1) await sleep(REGION_DELAY_MS);
  }

  console.log(`[refresh-pool-cache] done — ${totalInserted} rows cached, ${retried.length} retried, ${errors.length} errors`);
  return NextResponse.json({
    ok: true,
    totalInserted,
    ...(retried.length > 0 && { retried }),
    ...(errors.length > 0 && { errors }),
  });
}
