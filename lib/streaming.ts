// Australian streaming services — TMDB flatrate provider IDs for region=AU
// Verified: Netflix=8, Prime=9, Disney+=337, Apple TV+=350, Stan=119, Paramount+=531
// Binge (Foxtel) appears as provider_id 38 in TMDB AU region data
export const AU_SERVICES = [
  { id: "netflix",   name: "Netflix",      abbrev: "N",   tmdbId: 8,   color: "#E50914" },
  { id: "stan",      name: "Stan",         abbrev: "S",   tmdbId: 119, color: "#0069C1" },
  { id: "disney",    name: "Disney+",      abbrev: "D+",  tmdbId: 337, color: "#113CCF" },
  { id: "prime",     name: "Prime",        abbrev: "P",   tmdbId: 9,   color: "#00A8E1" },
  { id: "apple",     name: "Apple TV+",    abbrev: "♦",   tmdbId: 350, color: "#888888" },
  { id: "binge",     name: "Binge",        abbrev: "B",   tmdbId: 38,  color: "#FF5C35" },
  { id: "paramount", name: "Paramount+",   abbrev: "P+",  tmdbId: 531, color: "#0064FF" },
  { id: "foxtel",    name: "Foxtel",       abbrev: "F",   tmdbId: 272, color: "#444444" },
] as const;

export type ServiceId = (typeof AU_SERVICES)[number]["id"];

export function getService(id: string) {
  return AU_SERVICES.find((s) => s.id === id) ?? null;
}

export function getServiceByTmdbId(tmdbId: number) {
  return AU_SERVICES.find((s) => s.tmdbId === tmdbId) ?? null;
}

// Fetch watch providers for a film in AU from TMDB
export async function fetchWatchProvidersAU(
  tmdbId: number,
  apiKey: string
): Promise<{ serviceId: string; name: string }[]> {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/movie/${tmdbId}/watch/providers?api_key=${apiKey}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    const au = data.results?.AU;
    if (!au) return [];

    // Combine flatrate (subscription) providers only
    const flatrate: { provider_id: number; provider_name: string }[] =
      au.flatrate ?? [];

    return flatrate
      .map((p) => {
        const service = getServiceByTmdbId(p.provider_id);
        return service
          ? { serviceId: service.id, name: service.name }
          : null;
      })
      .filter(Boolean) as { serviceId: string; name: string }[];
  } catch {
    return [];
  }
}

// TMDB genre list (static — changes rarely)
export const TMDB_GENRES = [
  { id: 28,    name: "Action" },
  { id: 12,    name: "Adventure" },
  { id: 16,    name: "Animation" },
  { id: 35,    name: "Comedy" },
  { id: 80,    name: "Crime" },
  { id: 99,    name: "Documentary" },
  { id: 18,    name: "Drama" },
  { id: 10751, name: "Family" },
  { id: 14,    name: "Fantasy" },
  { id: 36,    name: "History" },
  { id: 27,    name: "Horror" },
  { id: 10402, name: "Music" },
  { id: 9648,  name: "Mystery" },
  { id: 10749, name: "Romance" },
  { id: 878,   name: "Sci-Fi" },
  { id: 53,    name: "Thriller" },
  { id: 10752, name: "War" },
  { id: 37,    name: "Western" },
] as const;
