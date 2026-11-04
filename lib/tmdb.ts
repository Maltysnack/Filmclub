import "server-only";
import { familyKey } from "./family";
import { REGION, SERVICES } from "./services";
import type { Film } from "./types";

const API = "https://api.themoviedb.org/3";
const POOL_CACHE = 6 * 60 * 60;
const MIN_VOTES = 100;
const FOREIGN_CAP = 0.15;
const FAMILY_CAP = 2;

interface Discovered {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  release_date?: string;
  genre_ids: number[];
  original_language: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
}

async function tmdb<T>(path: string, params: Record<string, string | number>, revalidate = POOL_CACHE): Promise<T> {
  const query = new URLSearchParams({ api_key: process.env.TMDB_API_KEY!, ...params } as Record<string, string>);
  const res = await fetch(`${API}${path}?${query}`, { next: { revalidate } });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

async function discover(provider: number, sort: string, page: number): Promise<Discovered[]> {
  const extra = sort === "vote_average.desc" ? { "vote_count.gte": 1000 } : { "vote_count.gte": MIN_VOTES };
  const { results } = await tmdb<{ results: Discovered[] }>("/discover/movie", {
    watch_region: REGION,
    with_watch_providers: provider,
    with_watch_monetization_types: "flatrate",
    sort_by: sort,
    include_adult: "false",
    page,
    ...extra,
  });
  return results;
}

function toFilm(m: Discovered, services: string[]): Film {
  return {
    id: m.id,
    title: m.title,
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
    overview: m.overview,
    poster: m.poster_path!,
    genres: m.genre_ids,
    language: m.original_language,
    rating: m.vote_average,
    popularity: m.popularity,
    family: familyKey(m.title) || `film${m.id}`,
    services,
  };
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Keeps each franchise to its best films, so one service cannot deal nine Spider-Mans.
export function capFamilies(films: Film[], cap = FAMILY_CAP): Film[] {
  const counts = new Map<string, number>();
  return [...films].sort((a, b) => b.rating - a.rating).filter((f) => {
    const seen = counts.get(f.family) ?? 0;
    counts.set(f.family, seen + 1);
    return seen < cap;
  });
}

export function capForeign(films: Film[], cap = FOREIGN_CAP): Film[] {
  const allowed = Math.floor(films.filter((f) => f.language === "en").length * cap / (1 - cap));
  let foreign = 0;
  return films.filter((f) => f.language === "en" || foreign++ < allowed);
}

export async function buildPool(serviceIds: string[], people: number, exclude: number[], game = 0): Promise<Film[]> {
  const target = Math.min(40 * (people + 2), 400);
  const providers = SERVICES.filter((s) => serviceIds.includes(s.id));
  const pages = Math.min(Math.ceil(target / (20 * providers.length)) + 1, 8);
  const requests = providers.flatMap((service) =>
    ["popularity.desc", "vote_average.desc"].flatMap((sort) =>
      // Each replay reads further down the lists, so a group gets fresh films.
      Array.from({ length: pages }, (_, i) => discover(service.tmdbId, sort, game * pages + i + 1).then((films) => ({ service, films }))),
    ),
  );

  const found = new Map<number, Film>();
  for (const { service, films } of await Promise.all(requests)) {
    for (const m of films) {
      if (!m.poster_path || exclude.includes(m.id)) continue;
      const known = found.get(m.id);
      if (known) {
        if (!known.services.includes(service.id)) known.services.push(service.id);
      } else {
        found.set(m.id, toFilm(m, [service.id]));
      }
    }
  }
  return shuffle(capForeign(capFamilies([...found.values()]))).slice(0, target);
}

export async function homePosters(): Promise<string[]> {
  try {
    const { results } = await tmdb<{ results: Discovered[] }>("/trending/movie/week", {}, 24 * 60 * 60);
    return results.flatMap((m) => m.poster_path ?? []);
  } catch {
    return [];
  }
}

export async function filmDetail(id: number) {
  const detail = await tmdb<{ imdb_id: string | null; runtime: number | null; credits?: { cast: { name: string }[] } }>(
    `/movie/${id}`,
    { append_to_response: "credits" },
    7 * 24 * 60 * 60,
  );
  let imdb: string | null = null;
  if (detail.imdb_id && process.env.OMDB_API_KEY) {
    const query = new URLSearchParams({ apikey: process.env.OMDB_API_KEY, i: detail.imdb_id });
    const res = await fetch(`https://www.omdbapi.com/?${query}`, { next: { revalidate: 7 * 24 * 60 * 60 } });
    const json = res.ok ? await res.json() : null;
    if (json?.imdbRating && json.imdbRating !== "N/A") imdb = json.imdbRating;
  }
  return {
    imdb,
    imdbId: detail.imdb_id,
    runtime: detail.runtime,
    cast: (detail.credits?.cast ?? []).slice(0, 4).map((c) => c.name),
  };
}
