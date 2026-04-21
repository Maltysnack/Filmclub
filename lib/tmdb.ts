import { TMDBMovie, TMDBMovieDetail, Film, Region } from "@/types";

const BASE = "https://api.themoviedb.org/3";
const KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY!;
export const TMDB_IMAGE = "https://image.tmdb.org/t/p";

function params(extra: Record<string, string> = {}) {
  return new URLSearchParams({ api_key: KEY, language: "en-US", ...extra });
}

// Fetch multiple pages and return the flat list
async function fetchPages(url: string, pages: number): Promise<TMDBMovie[]> {
  const requests = Array.from({ length: pages }, (_, i) =>
    fetch(`${url}&${params({ page: String(i + 1) })}`).then((r) => r.ok ? r.json() : { results: [] })
  );
  const results = await Promise.all(requests);
  return results.flatMap((d) => d.results ?? []);
}

export async function getPopularFilms(pages = 1): Promise<TMDBMovie[]> {
  return fetchPages(`${BASE}/movie/popular?`, pages);
}

export async function getTrendingFilms(pages = 1): Promise<TMDBMovie[]> {
  // Trending uses a slightly different URL structure
  if (pages === 1) {
    const res = await fetch(`${BASE}/trending/movie/week?${params()}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.results ?? [];
  }
  return fetchPages(`${BASE}/trending/movie/week?`, pages);
}

export async function getTopRatedFilms(pages = 1): Promise<TMDBMovie[]> {
  return fetchPages(`${BASE}/movie/top_rated?`, pages);
}

// Films available on specific streaming services in a given region (TMDB Discover).
// Calls once per provider (avoids pipe-OR URL ambiguity) then deduplicates.
// with_watch_monetization_types=flatrate limits to subscription streaming only.
export async function discoverFilmsByProviders(
  providerIds: number[],
  pagesPerProvider = 1,
  region: Region = "AU"
): Promise<TMDBMovie[]> {
  if (!providerIds.length) return [];

  const perProvider = await Promise.all(
    providerIds.map((id) =>
      fetchPages(
        `${BASE}/discover/movie?watch_region=${region}&with_watch_providers=${id}&sort_by=popularity.desc&`,
        pagesPerProvider
      )
    )
  );

  // Round-robin interleave across providers so no single service dominates.
  // Netflix[0], Stan[0], Binge[0], Netflix[1], Stan[1], Binge[1], …
  // then deduplicate (a film on both Netflix and Stan gets its first-seen slot).
  const seen = new Set<number>();
  const result: TMDBMovie[] = [];
  const maxLen = Math.max(...perProvider.map((p) => p.length));
  for (let i = 0; i < maxLen; i++) {
    for (const providerFilms of perProvider) {
      if (i < providerFilms.length) {
        const m = providerFilms[i];
        if (!seen.has(m.id)) {
          seen.add(m.id);
          result.push(m);
        }
      }
    }
  }
  return result;
}

// Fetch the full list of streaming providers from TMDB for a given region.
// Call this from the browser console to verify/correct provider IDs:
//   import { getProviderList } from "@/lib/tmdb"; getProviderList("AU").then(console.log)
export async function getProviderList(region: Region = "AU"): Promise<{ provider_id: number; provider_name: string; logo_path: string }[]> {
  const res = await fetch(`${BASE}/watch/providers/movie?${params({ watch_region: region })}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results ?? []).sort((a: { provider_name: string }, b: { provider_name: string }) =>
    a.provider_name.localeCompare(b.provider_name)
  );
}

// Legacy AU alias
export async function getAUProviderList() { return getProviderList("AU"); }

export async function searchFilms(query: string): Promise<TMDBMovie[]> {
  if (!query.trim()) return [];
  const res = await fetch(`${BASE}/search/movie?${params({ query, include_adult: "false" })}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.results ?? [];
}

export async function getFilmDetail(tmdbId: number): Promise<TMDBMovieDetail | null> {
  const res = await fetch(`${BASE}/movie/${tmdbId}?${params({ append_to_response: "credits" })}`);
  if (!res.ok) return null;
  return res.json();
}

export function posterUrl(path: string | null, size: "w342" | "w500" | "w780" | "w1280" | "original" = "w500"): string {
  if (!path) return "/placeholder-poster.jpg";
  return `${TMDB_IMAGE}/${size}${path}`;
}

export function tmdbToFilm(movie: TMDBMovieDetail): Omit<Film, "id"> {
  return {
    tmdb_id: movie.id,
    title: movie.title,
    poster_path: movie.poster_path,
    backdrop_path: movie.backdrop_path,
    overview: movie.overview,
    release_year: movie.release_date ? parseInt(movie.release_date.slice(0, 4)) : null,
    runtime: movie.runtime ?? null,
    genres: movie.genres ?? [],
    film_cast: movie.credits?.cast?.slice(0, 10) ?? [],
    rating: movie.vote_average ? parseFloat(movie.vote_average.toFixed(1)) : null,
    imdb_id: movie.imdb_id ?? null,
    imdb_rating: null, // populated separately via OMDb after upsert
    watch_providers_au: [],
    collection_id: movie.belongs_to_collection?.id ?? null,
    collection_name: movie.belongs_to_collection?.name ?? null,
  };
}
