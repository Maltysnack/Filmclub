// The deck is a calculation over facts, never a list edited in place.
//
// Facts arrive from this device and from everyone else in any order, and each is
// idempotent, so the same facts always give the same state. The front cards are
// frozen: a remote event can change what comes after them but never the cards a
// person can see. Tune the deck by changing DECK_RULES or adding to `score`.
import type { Film, Swipe } from "./types";

export const DECK_RULES = {
  frozen: 4, // cards committed to the screen and preload
  sliceSize: 40, // each person's own opening films
  likeBoost: 1000, // a film someone else liked jumps the queue
  perExtraLike: 100,
  genreStep: 12, // score change per point of genre taste
  genreBlock: -3, // all of a film's genres at or below this hides it
  dripEvery: 20, // every N swipes, surface one film from outside your slice
};
export type DeckRules = typeof DECK_RULES;

export interface DeckState {
  me: string;
  rules: DeckRules;
  films: Map<number, Film>;
  rank: Map<number, number>; // lower is sooner for this person
  reserve: Set<number>; // outside this person's slice
  frozen: number[];
  swiped: Map<number, boolean>; // mine
  likes: Map<number, Set<string>>; // film to everyone who liked it
  rejected: Set<number>; // someone said no, so it cannot be unanimous
  genreScore: Map<number, number>;
  blockedFamilies: Set<string>;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function createDeck(pool: Film[], me: string, slot: number, rules: DeckRules = DECK_RULES): DeckState {
  const count = Math.max(1, Math.floor(pool.length / rules.sliceSize));
  const start = (slot % count) * rules.sliceSize;
  const slice = new Set(pool.slice(start, start + rules.sliceSize).map((f) => f.id));
  const order = [...pool].sort((a, b) => hash(me + a.id) - hash(me + b.id));
  const state: DeckState = {
    me,
    rules,
    films: new Map(pool.map((f) => [f.id, f])),
    rank: new Map(order.map((f, i) => [f.id, i])),
    reserve: new Set(pool.filter((f) => !slice.has(f.id)).map((f) => f.id)),
    frozen: [],
    swiped: new Map(),
    likes: new Map(),
    rejected: new Set(),
    genreScore: new Map(),
    blockedFamilies: new Set(),
  };
  return topUp(state);
}

function othersLiked(s: DeckState, id: number): number {
  const likers = s.likes.get(id);
  return likers ? likers.size - (likers.has(s.me) ? 1 : 0) : 0;
}

function visible(s: DeckState, film: Film, relax = false): boolean {
  if (s.swiped.has(film.id) || s.rejected.has(film.id)) return false;
  if (relax || othersLiked(s, film.id) > 0) return true; // the group outranks personal taste
  if (s.blockedFamilies.has(film.family)) return false;
  return !(film.genres.length > 0 && film.genres.every((g) => (s.genreScore.get(g) ?? 0) <= s.rules.genreBlock));
}

function score(s: DeckState, film: Film): number {
  const r = s.rules;
  const liked = othersLiked(s, film.id);
  const taste = film.genres.reduce((sum, g) => sum + (s.genreScore.get(g) ?? 0), 0);
  return (liked ? r.likeBoost + liked * r.perExtraLike : 0)
    + taste * r.genreStep
    - (s.reserve.has(film.id) ? s.films.size : 0)
    - (s.rank.get(film.id) ?? 0);
}

function pick(s: DeckState, taken: Set<number>, fromReserve: boolean, relax = false): number | undefined {
  let best: number | undefined;
  let bestScore = -Infinity;
  for (const film of s.films.values()) {
    if (taken.has(film.id) || !visible(s, film, relax)) continue;
    if (fromReserve && !s.reserve.has(film.id)) continue;
    const value = score(s, film);
    if (value > bestScore) [best, bestScore] = [film.id, value];
  }
  return best;
}

// Only ever appends, which is what keeps cards on screen from moving.
function topUp(s: DeckState): DeckState {
  const frozen = [...s.frozen];
  const taken = new Set(frozen);
  const swipes = s.swiped.size;
  // Out of cards with nothing liked yet: show what taste filters hid, so there is something to like.
  const noLikes = ![...s.swiped.values()].some(Boolean);
  while (frozen.length < s.rules.frozen) {
    const dueDrip = swipes + frozen.length > 0 && (swipes + frozen.length) % s.rules.dripEvery === 0;
    const next = (dueDrip ? pick(s, taken, true) : undefined) ?? pick(s, taken, false) ?? (noLikes ? pick(s, taken, false, true) : undefined);
    if (next === undefined) break;
    frozen.push(next);
    taken.add(next);
  }
  s.frozen = frozen;
  return s;
}

function clone(s: DeckState): DeckState {
  return {
    ...s,
    frozen: [...s.frozen],
    swiped: new Map(s.swiped),
    likes: new Map(s.likes),
    rejected: new Set(s.rejected),
    genreScore: new Map(s.genreScore),
    blockedFamilies: new Set(s.blockedFamilies),
  };
}

// Applies one fact. Safe to repeat and safe in any order, including a realtime echo
// of a swipe this device already made.
export function applySwipe(state: DeckState, swipe: Swipe): DeckState {
  const { participant_id: who, film_id: id, liked } = swipe;
  const film = state.films.get(id);
  if (!film) return state;
  if (who === state.me && state.swiped.has(id)) return state;
  if (who !== state.me && (liked ? state.likes.get(id)?.has(who) : state.rejected.has(id))) return state;

  const s = clone(state);
  if (who === s.me) {
    s.swiped.set(id, liked);
    s.frozen = s.frozen.filter((f) => f !== id);
    for (const g of film.genres) s.genreScore.set(g, (s.genreScore.get(g) ?? 0) + (liked ? 1 : -1));
    if (film.family) {
      if (liked) s.blockedFamilies.delete(film.family);
      else s.blockedFamilies.add(film.family);
    }
  }
  if (liked) {
    s.likes.set(id, new Set(s.likes.get(id)).add(who));
  } else {
    s.rejected.add(id);
  }
  return topUp(s);
}

export function buildDeck(pool: Film[], me: string, slot: number, swipes: Swipe[], rules: DeckRules = DECK_RULES): DeckState {
  return swipes.reduce(applySwipe, createDeck(pool, me, slot, rules));
}

export const frontFilms = (s: DeckState): Film[] => s.frozen.map((id) => s.films.get(id)!);
export const likedByOthers = (s: DeckState, id: number): string[] =>
  [...(s.likes.get(id) ?? [])].filter((p) => p !== s.me);
