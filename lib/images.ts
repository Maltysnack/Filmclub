export const posterUrl = (path: string, size: "w342" | "w780" | "original" = "w780") =>
  `https://image.tmdb.org/t/p/${size}${path}`;

export function imdbLink(id: string) {
  return `https://www.imdb.com/title/${id}/`;
}

export function letterboxdLink(tmdbId: number) {
  return `https://letterboxd.com/tmdb/${tmdbId}/`;
}
