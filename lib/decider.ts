import type { Film, Mark, Swipe } from "./types";

export const roundSeconds = (films: number) => (films >= 4 ? 20 : films === 3 ? 15 : 10);

// Most-liked first, with at least enough films that everyone can cross one.
export function shortlist(pool: Film[], swipes: Swipe[], people: number): number[] {
  const likes = new Map<number, number>();
  for (const s of swipes) if (s.liked) likes.set(s.film_id, (likes.get(s.film_id) ?? 0) + 1);
  const size = people + 2;
  const liked = [...likes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id]) => id);
  const ranked = liked.slice(0, size);
  if (ranked.length >= 2) return ranked;
  const rest = pool.map((f) => f.id).filter((id) => !ranked.includes(id));
  return [...ranked, ...rest].slice(0, size);
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
