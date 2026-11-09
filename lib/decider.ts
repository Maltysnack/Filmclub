import type { Film, Mark, Swipe } from "./types";

export const MAX_SHORTLIST = 8;

export const roundSeconds = (films: number) => (films >= 5 ? 30 : films === 4 ? 20 : films === 3 ? 15 : 10);

// Every liked film, up to the cap. Films everyone liked come first, then the most liked,
// then films someone also turned down. Ties go to the better rated film.
export function shortlist(pool: Film[], swipes: Swipe[], people: number): number[] {
  const likes = new Map<number, number>();
  const rejected = new Set<number>();
  for (const s of swipes) {
    if (s.liked) likes.set(s.film_id, (likes.get(s.film_id) ?? 0) + 1);
    else rejected.add(s.film_id);
  }
  const rating = new Map(pool.map((f) => [f.id, f.rating]));
  const tier = (id: number) => (likes.get(id)! >= people ? 0 : rejected.has(id) ? 2 : 1);
  return [...likes.keys()]
    .sort((a, b) => tier(a) - tier(b) || likes.get(b)! - likes.get(a)! || (rating.get(b) ?? 0) - (rating.get(a) ?? 0) || a - b)
    .slice(0, MAX_SHORTLIST);
}

export type Outcome = { winner: number } | { tied: number[] } | { next: number[] };

// Crossed films go. Ticked survivors continue. Two films is a final. No progress is a stalemate.
export function resolveRound(filmIds: number[], marks: Pick<Mark, "cross_id" | "tick_id">[]): Outcome {
  if (filmIds.length === 1) return { winner: filmIds[0] };
  const inRound = new Set(filmIds);
  const ticks = new Map<number, number>();
  for (const m of marks) if (inRound.has(m.tick_id)) ticks.set(m.tick_id, (ticks.get(m.tick_id) ?? 0) + 1);

  if (filmIds.length === 2) {
    const [a, b] = filmIds;
    const [ca, cb] = [ticks.get(a) ?? 0, ticks.get(b) ?? 0];
    return ca === cb ? { tied: filmIds } : { winner: ca > cb ? a : b };
  }

  const crossed = new Set(marks.map((m) => m.cross_id));
  const survivors = filmIds.filter((id) => !crossed.has(id));
  if (survivors.length === 0) return { tied: filmIds };
  if (survivors.length === 1) return { winner: survivors[0] };
  const ticked = survivors.filter((id) => ticks.has(id));
  const next = ticked.length ? ticked : survivors;
  if (next.length === 1) return { winner: next[0] };
  if (next.length === filmIds.length) return { tied: filmIds };
  return { next };
}
