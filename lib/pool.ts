// Film pool seeding — extracted so the home page can kick off an initial seed
// the moment the user presses Start, hiding latency behind the lobby animation.

import { Session } from "@/types";
import { discoverFilmsByProviders, getTrendingFilms, getTopRatedFilms, getProviderList } from "./tmdb";
import { addFilmToSession } from "./session";
import { getServicesForRegion } from "./streaming";

// Regions where English is the primary language — non-English films are capped
// at FOREIGN_LANG_CAP of the pool. All other regions get no language filtering.
export const ENGLISH_PRIMARY_REGIONS = new Set(["AU", "US", "GB", "CA", "NZ", "IE", "ZA"]);
export const FOREIGN_LANG_CAP = 0.15;

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
  console.log("[seed] region:", region, "services:", s.streaming_services, "→ providerIds:", providerIds);
  if (process.env.NODE_ENV === "development") {
    getProviderList(region).then((list) => {
      const relevant = list.filter((p) =>
        /stan|binge|netflix|prime|disney|apple|paramount|foxtel|hulu|peacock|max|now|britbox|itvx|bbc/i.test(p.provider_name)
      );
      console.log(`[TMDB ${region} providers]`, relevant.map(p => `${p.provider_name} (${p.provider_id})`));
    });
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
  const serviceCount = Math.max(1, providerIds.length);
  const targetPool = 160 + (20 * serviceCount);
  console.log(`[pool] services: ${serviceCount} → target pool: ${targetPool} films`);

  let raw: import("@/types").TMDBMovie[];
  if (providerIds.length > 0) {
    const halfPages = Math.ceil(targetPool / (20 * serviceCount * 2));
    const [popularFilms, ratedFilms] = await Promise.all([
      discoverFilmsByProviders(providerIds, halfPages, region, "popularity.desc"),
      discoverFilmsByProviders(providerIds, halfPages, region, "vote_average.desc", 1000),
    ]);
    const mixSeen = new Set<number>();
    raw = [];
    const maxLen = Math.max(popularFilms.length, ratedFilms.length);
    for (let i = 0; i < maxLen; i++) {
      for (const film of [popularFilms[i], ratedFilms[i]]) {
        if (film && !mixSeen.has(film.id)) { mixSeen.add(film.id); raw.push(film); }
      }
    }
  } else {
    const halfPages = Math.ceil(targetPool / 40);
    raw = await Promise.all([getTrendingFilms(halfPages), getTopRatedFilms(halfPages)])
      .then(([a, b]) => [...a, ...b]);
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

  console.log(`[pool] fetched ${raw.length} raw → ${deduped.length} deduped → ${filtered.length} after language filter, seeding now...`);
  const BATCH = 8;
  for (let i = 0; i < filtered.length; i += BATCH) {
    await Promise.all(filtered.slice(i, i + BATCH).map((m) => addFilmToSession(s.id, m.id, null)));
    if (i + BATCH < filtered.length) await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`[pool] seeding complete — ${filtered.length} films added to session`);
}
