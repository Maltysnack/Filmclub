// Australian streaming services — provider IDs verified against
// TMDB /watch/providers/movie?watch_region=AU (2025-03)
// tmdbLogoPath: known-good static fallback. null = use abbrev text until
// the API-fetched logoPath is stored by fetchWatchProvidersAU.
export const AU_SERVICES = [
  { id: "netflix",   name: "Netflix",      abbrev: "N",   tmdbId: 8,   color: "#E50914", tmdbLogoPath: "/t2yyOv40HZeVlLjYsCsPHnWLk4W.jpg" },
  { id: "stan",      name: "Stan",         abbrev: "S",   tmdbId: 21,  color: "#0069C1", tmdbLogoPath: null },
  { id: "disney",    name: "Disney+",      abbrev: "D+",  tmdbId: 337, color: "#113CCF", tmdbLogoPath: "/7rwgEs15tFwyR9NPQ5tjkWB43Hh.jpg" },
  { id: "prime",     name: "Prime Video",  abbrev: "P",   tmdbId: 119, color: "#00A8E1", tmdbLogoPath: "/dQeAar5H991VYporEjUspolDarG.jpg" },
  { id: "apple",     name: "Apple TV+",    abbrev: "A",   tmdbId: 350, color: "#888888", tmdbLogoPath: "/6uhKBfmtzFqOcLousHwZuzcrScK.jpg" },
  { id: "binge",     name: "Binge",        abbrev: "B",   tmdbId: 385, color: "#FF5C35", tmdbLogoPath: null },
  { id: "paramount", name: "Paramount+",   abbrev: "P+",  tmdbId: 531, color: "#0064FF", tmdbLogoPath: "/xbhHHa1YgtpwhC8lb1NQ3ACVcLd.jpg" },
  { id: "foxtel",    name: "Foxtel Now",   abbrev: "F",   tmdbId: 134, color: "#444444", tmdbLogoPath: null },
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
): Promise<{ serviceId: string; name: string; logoPath: string | null }[]> {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/movie/${tmdbId}/watch/providers?api_key=${apiKey}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    const au = data.results?.AU;
    if (!au) return [];

    // Combine flatrate (subscription) providers only
    const flatrate: { provider_id: number; provider_name: string; logo_path?: string }[] =
      au.flatrate ?? [];

    return flatrate
      .map((p) => {
        const service = getServiceByTmdbId(p.provider_id);
        return service
          ? { serviceId: service.id, name: service.name, logoPath: p.logo_path ?? null, tmdbProviderId: p.provider_id }
          : null;
      })
      .filter(Boolean) as { serviceId: string; name: string; logoPath: string | null; tmdbProviderId: number }[];
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
