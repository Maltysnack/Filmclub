// Film pool seeding — extracted so the home page can kick off an initial seed
// the moment the user presses Start, hiding latency behind the lobby animation.

import { Session } from "@/types";
import { discoverFilmsByProviders, getTrendingFilms, getTopRatedFilms, getProviderList } from "./tmdb";
import { addFilmToSession } from "./session";
import { getServicesForRegion } from "./streaming";
import { supabase } from "./supabase";

// Regions where English is the primary language — non-English films are capped
// at FOREIGN_LANG_CAP of the pool. All other regions get no language filtering.
export const ENGLISH_PRIMARY_REGIONS = new Set(["AU", "US", "GB", "CA", "NZ", "IE", "ZA"]);
export const FOREIGN_LANG_CAP = 0.15;

// ── Provider pool cache ───────────────────────────────────────────────────────

// Reads pre-fetched film IDs from the provider_pool_cache table, which the
// refresh-pool-cache cron populates every 3 days. Returns null when the cache
// is empty (first deployment, or between cron runs), so callers fall back to
// live TMDB Discover.
async function getPoolFromCache(
  serviceIds: string[],
  region: string
): Promise<{ id: number; original_language: string }[] | null> {
  if (serviceIds.length === 0) return null;

  const { data, error } = await supabase
    .from("provider_pool_cache")
    .select("tmdb_id, original_language")
    .in("provider_id", serviceIds)
    .eq("region", region);

  if (error || !data || data.length === 0) return null;

  // Deduplicate across providers (a film on both Netflix and Stan should
  // appear once). Order is arbitrary, so we shuffle before returning to
  // give every provider equal representation across sessions.
  const seen = new Set<number>();
  const films: { id: number; original_language: string }[] = [];
  for (const row of data) {
    if (!seen.has(row.tmdb_id)) {
      seen.add(row.tmdb_id);
      films.push({ id: row.tmdb_id, original_language: row.original_language ?? "en" });
    }
  }

  // Fisher-Yates shuffle
  for (let i = films.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [films[i], films[j]] = [films[j], films[i]];
  }

  return films.length > 0 ? films : null;
}

export function sessionProviderTmdbIds(s: Session): number[] {
  const services = getServicesForRegion(s.region ?? "AU");
  return (s.streaming_services ?? [])
    .flatMap((sid) => {
      const tmdbId = services.find((svc) => svc.id === sid)?.tmdbId;
      return tmdbId != null ? [tmdbId] : [];
    });
}

// Quick initial seed — 10 films to get the deck populated immediately.
// Called from the home page on submit so seeding starts during the lobby animation.
// session_films upsert is idempotent so re-adding later is safe.
export async function seedHomePool(s: Session): Promise<void> {
  const region = s.region ?? "AU";
  const providerIds = sessionProviderTmdbIds(s);
  const serviceIds = s.streaming_services ?? [];
  console.log("[seed] region:", region, "services:", serviceIds, "→ providerIds:", providerIds);
  if (process.env.NODE_ENV === "development") {
    getProviderList(region).then((list) => {
      const relevant = list.filter((p) =>
        /stan|binge|netflix|prime|disney|apple|paramount|foxtel|hulu|peacock|max|now|britbox|itvx|bbc/i.test(p.provider_name)
      );
      console.log(`[TMDB ${region} providers]`, relevant.map(p => `${p.provider_name} (${p.provider_id})`));
    });
  }

  // Try the pre-built cache first — avoids a live TMDB call at session start
  if (serviceIds.length > 0) {
    const cached = await getPoolFromCache(serviceIds, region);
    if (cached && cached.length > 0) {
      const initial = cached.slice(0, 10);
      console.log("[seed] cache hit —", cached.length, "films available, seeding first", initial.length);
      await Promise.all(initial.map((m) => addFilmToSession(s.id, m.id, null)));
      return;
    }
    console.log("[seed] cache miss — falling back to live TMDB");
  }

  const films = providerIds.length > 0
    ? await discoverFilmsByProviders(providerIds, 1, region)
    : await getTrendingFilms(1);
  console.log("[seed] discover returned", films.length, "films, titles:", films.slice(0, 3).map(f => f.title));
  const seen = new Set<number>();
  const initial = films.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  }).slice(0, 10);
  await Promise.all(initial.map((m) => addFilmToSession(s.id, m.id, null)));
}

// Background expander — runs after the lobby is shown.
// Pool size scales with service count: 160 base + 20 per service.
// Films land in batches via the realtime subscription.
export async function seedMoreHomePool(s: Session): Promise<void> {
  const region = s.region ?? "AU";
  const providerIds = sessionProviderTmdbIds(s);
  const serviceIds = s.streaming_services ?? [];
  const serviceCount = Math.max(1, providerIds.length);
  const targetPool = 160 + (20 * serviceCount);
  console.log(`[pool] services: ${serviceCount} → target pool: ${targetPool} films`);

  let raw: { id: number; original_language: string }[];

  // ── Try cache first ────────────────────────────────────────────────────────
  const cached = serviceIds.length > 0 ? await getPoolFromCache(serviceIds, region) : null;

  if (cached && cached.length > 0) {
    console.log(`[pool] cache hit — ${cached.length} films available`);
    raw = cached;
  } else {
    // ── Fall back to live TMDB Discover ────────────────────────────────────
    if (cached !== null) {
      console.log("[pool] cache miss — falling back to live TMDB");
    }
    let liveRaw: import("@/types").TMDBMovie[];
    if (providerIds.length > 0) {
      const halfPages = Math.ceil(targetPool / (20 * serviceCount * 2));
      const [popularFilms, ratedFilms] = await Promise.all([
        discoverFilmsByProviders(providerIds, halfPages, region, "popularity.desc"),
        discoverFilmsByProviders(providerIds, halfPages, region, "vote_average.desc", 1000),
      ]);
      const mixSeen = new Set<number>();
      liveRaw = [];
      const maxLen = Math.max(popularFilms.length, ratedFilms.length);
      for (let i = 0; i < maxLen; i++) {
        for (const film of [popularFilms[i], ratedFilms[i]]) {
          if (film && !mixSeen.has(film.id)) { mixSeen.add(film.id); liveRaw.push(film); }
        }
      }
    } else {
      const halfPages = Math.ceil(targetPool / 40);
      liveRaw = await Promise.all([getTrendingFilms(halfPages), getTopRatedFilms(halfPages)])
        .then(([a, b]) => [...a, ...b]);
    }
    raw = liveRaw;
  }

  const seen = new Set<number>();
  const deduped = raw.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  }).slice(0, targetPool);

  // ── Language breakdown before filtering ───────────────────────────────────
  const foreignBefore = deduped.filter((m) => m.original_language !== "en");
  const langBreakdown = foreignBefore.reduce((acc, m) => {
    acc[m.original_language] = (acc[m.original_language] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const pctBefore = ((foreignBefore.length / deduped.length) * 100).toFixed(1);
  console.log(`[pool] language breakdown — ${foreignBefore.length}/${deduped.length} non-English (${pctBefore}%):`, langBreakdown);

  // ── Language cap (English-primary regions only) ────────────────────────────
  let filtered = deduped;
  if (ENGLISH_PRIMARY_REGIONS.has(region)) {
    const cap = Math.round(deduped.length * FOREIGN_LANG_CAP);
    let foreignCount = 0;
    filtered = deduped.filter((m) => {
      if (m.original_language === "en") return true;
      if (foreignCount < cap) { foreignCount++; return true; }
      return false;
    });
    const pctAfter = ((foreignCount / filtered.length) * 100).toFixed(1);
    const suppressed = foreignBefore.length - foreignCount;
    console.log(`[pool] language filter applied (${region}) — cap ${(FOREIGN_LANG_CAP * 100).toFixed(0)}% (${cap} films): kept ${foreignCount} non-English, suppressed ${suppressed} → ${foreignCount}/${filtered.length} non-English (${pctAfter}%)`);
  } else {
    console.log(`[pool] language filter skipped — region ${region} is not English-primary`);
  }

  console.log(`[pool] ${cached ? "cache" : "live"}: ${raw.length} raw → ${deduped.length} deduped → ${filtered.length} after language filter, seeding now...`);
  const BATCH = 8;
  for (let i = 0; i < filtered.length; i += BATCH) {
    await Promise.all(filtered.slice(i, i + BATCH).map((m) => addFilmToSession(s.id, m.id, null)));
    // Only delay between batches when falling back to live TMDB — the delay guards
    // against TMDB/OMDb rate limits, which only apply when upsertFilm makes API calls.
    // Cache-path upserts are pure DB writes so no rate limiting is needed.
    if (i + BATCH < filtered.length && !cached) await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`[pool] seeding complete — ${filtered.length} films added to session`);
}
