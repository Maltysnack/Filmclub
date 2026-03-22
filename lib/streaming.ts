// Australian streaming services — TMDB flatrate provider IDs for region=AU
// Verified: Netflix=8, Prime=9, Disney+=337, Apple TV+=350, Stan=119, Paramount+=531
// Binge (Foxtel) appears as provider_id 38 in TMDB AU region data
// tmdbLogoPath: the static TMDB logo path for this service (used as fallback
// when a cached film's watch_providers_au entry has no logoPath)
export const AU_SERVICES = [
  { id: "netflix",   name: "Netflix",      abbrev: "N",   tmdbId: 8,   color: "#E50914", tmdbLogoPath: "/t2yyOv40HZeVlLjYsCsPHnWLk4W.jpg" },
  { id: "stan",      name: "Stan",         abbrev: "S",   tmdbId: 119, color: "#0069C1", tmdbLogoPath: "/3hI22hp7YDZXyrmhWxgLGPCotbz.jpg" },
  { id: "disney",    name: "Disney+",      abbrev: "D+",  tmdbId: 337, color: "#113CCF", tmdbLogoPath: "/7rwgEs15tFwyR9NPQ5tjkWB43Hh.jpg" },
  { id: "prime",     name: "Prime",        abbrev: "P",   tmdbId: 9,   color: "#00A8E1", tmdbLogoPath: "/dQeAar5H991VYporEjUspolDarG.jpg" },
  { id: "apple",     name: "Apple TV+",    abbrev: "♦",   tmdbId: 350, color: "#888888", tmdbLogoPath: "/6uhKBfmtzFqOcLousHwZuzcrScK.jpg" },
  { id: "binge",     name: "Binge",        abbrev: "B",   tmdbId: 38,  color: "#FF5C35", tmdbLogoPath: "/l1c5kNNQrLNRtR2U2Fjq0SoVMBY.jpg" },
  { id: "paramount", name: "Paramount+",   abbrev: "P+",  tmdbId: 531, color: "#0064FF", tmdbLogoPath: "/xbhHHa1YgtpwhC8lb1NQ3ACVcLd.jpg" },
  { id: "foxtel",    name: "Foxtel",       abbrev: "F",   tmdbId: 272, color: "#444444", tmdbLogoPath: null },
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
          ? { serviceId: service.id, name: service.name, logoPath: p.logo_path ?? null }
          : null;
      })
      .filter(Boolean) as { serviceId: string; name: string; logoPath: string | null }[];
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
