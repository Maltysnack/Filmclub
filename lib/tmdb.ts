import { TMDBMovie, TMDBMovieDetail, Film } from "@/types";

const BASE = "https://api.themoviedb.org/3";
const KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY!;
export const TMDB_IMAGE = "https://image.tmdb.org/t/p";

function params(extra: Record<string, string> = {}) {
  return new URLSearchParams({ api_key: KEY, language: "en-US", ...extra });
}

export async function getPopularFilms(page = 1): Promise<TMDBMovie[]> {
  const res = await fetch(`${BASE}/movie/popular?${params({ page: String(page) })}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.results ?? [];
}

export async function getTrendingFilms(): Promise<TMDBMovie[]> {
  const res = await fetch(`${BASE}/trending/movie/week?${params()}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.results ?? [];
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

export function posterUrl(path: string | null, size: "w342" | "w500" | "original" = "w500"): string {
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
    cast: movie.credits?.cast?.slice(0, 10) ?? [],
    rating: movie.vote_average ? parseFloat(movie.vote_average.toFixed(1)) : null,
  };
}
