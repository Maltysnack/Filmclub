import { TMDBMovie, TMDBMovieDetail, Film } from "@/types";

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

// Films available on specific streaming services in AU (TMDB Discover).
// Calls once per provider (avoids pipe-OR URL ambiguity) then deduplicates.
// with_watch_monetization_types=flatrate limits to subscription streaming only.
export async function discoverFilmsByProviders(
  providerIds: number[],
  pagesPerProvider = 1
): Promise<TMDBMovie[]> {
  if (!providerIds.length) return [];

  const perProvider = await Promise.all(
    providerIds.map((id) =>
      fetchPages(
        `${BASE}/discover/movie?watch_region=AU&with_watch_providers=${id}&with_watch_monetization_types=flatrate&sort_by=popularity.desc&`,
        pagesPerProvider
      )
    )
  );

  // Deduplicate across providers, keeping insertion order
  const seen = new Set<number>();
  return perProvider.flat().filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

// Fetch the full list of AU streaming providers from TMDB.
// Call this from the browser console to verify/correct provider IDs:
//   import { getAUProviderList } from "@/lib/tmdb"; getAUProviderList().then(console.log)
export async function getAUProviderList(): Promise<{ provider_id: number; provider_name: string; logo_path: string }[]> {
  const res = await fetch(`${BASE}/watch/providers/movie?${params({ watch_region: "AU" })}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results ?? []).sort((a: { provider_name: string }, b: { provider_name: string }) =>
    a.provider_name.localeCompare(b.provider_name)
  );
}

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

export function posterUrl(path: string | null, size: "w342" | "w500" | "w780" | "original" = "w500"): string {
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
    watch_providers_au: [],
  };
}
