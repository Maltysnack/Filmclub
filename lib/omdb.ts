// Fetches the IMDb rating for a film via OMDb.
// Works in both server and client contexts:
//   - Server: calls OMDb directly with OMDB_API_KEY
//   - Client: calls our /api/omdb proxy (key stays server-side)

export async function fetchOmdbRating(imdbId: string): Promise<string | null> {
  if (!imdbId) return null;
  try {
    if (typeof window === "undefined") {
      // Server-side — call OMDb directly
      const key = process.env.OMDB_API_KEY;
      if (!key) return null;
      const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${key}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.imdbRating && data.imdbRating !== "N/A" ? data.imdbRating : null;
    } else {
      // Client-side — use our proxy route so the key stays server-side
      const res = await fetch(`/api/omdb?imdb_id=${imdbId}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.rating ?? null;
    }
  } catch {
    return null;
  }
}
