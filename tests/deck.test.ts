import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });
import { applySwipe, buildDeck, createDeck, DECK_RULES, frontFilms, type DeckState } from "@/lib/deck";
import { familyKey } from "@/lib/family";
import type { Film, Swipe } from "@/lib/types";

const film = (id: number, extra: Partial<Film> = {}): Film => ({
  id, title: `Film ${id}`, year: 2000, overview: "", poster: "", genres: [id % 5], language: "en",
  rating: 7, popularity: 1, family: `f${id}`, services: [], ...extra,
});
const pool = (n: number) => Array.from({ length: n }, (_, i) => film(i + 1));

function rng(seed: number) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 0) / 2 ** 32;
}

describe("slices", () => {
  it("gives every person a unique opening set, however big the group", () => {
    const films = pool(40 * 8);
    const decks = Array.from({ length: 8 }, (_, slot) => createDeck(films, `p${slot}`, slot));
    const seen = new Set<number>();
    for (const d of decks) for (const id of d.films.keys()) if (!d.reserve.has(id)) {
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });
});

describe("rules", () => {
  it("surfaces a film someone else liked behind the frozen cards", () => {
    let d = createDeck(pool(160), "me", 0);
    const outside = [...d.reserve][0];
    const front = [...d.frozen];
    d = applySwipe(d, { participant_id: "you", film_id: outside, liked: true });
    expect(d.frozen).toEqual(front);
    d = applySwipe(d, { participant_id: "me", film_id: front[0], liked: true });
    expect(d.frozen[3]).toBe(outside);
  });

  it("never shows a film someone rejected unless it was already frozen", () => {
    let d = createDeck(pool(80), "me", 0);
    const frozen = d.frozen[1];
    d = applySwipe(d, { participant_id: "you", film_id: frozen, liked: false });
    expect(d.frozen).toContain(frozen);
    const later = [...d.films.keys()].find((id) => !d.frozen.includes(id))!;
    d = applySwipe(d, { participant_id: "you", film_id: later, liked: false });
    for (let i = 0; i < 70 && d.frozen.length; i++) {
      expect(d.frozen).not.toContain(later);
      d = applySwipe(d, { participant_id: "me", film_id: d.frozen[0], liked: true });
    }
  });

  it("hides a franchise after one no, unless a friend liked it", () => {
    const films = [...pool(40), film(101, { family: "spiderman" }), film(102, { family: "spiderman" }), film(103, { family: "spiderman" })];
    let d = createDeck(films, "me", 0);
    d = applySwipe(d, { participant_id: "you", film_id: 103, liked: true });
    d = applySwipe(d, { participant_id: "me", film_id: 101, liked: false });
    const shown: number[] = [];
    while (d.frozen.length) {
      shown.push(d.frozen[0]);
      d = applySwipe(d, { participant_id: "me", film_id: d.frozen[0], liked: d.frozen[0] <= 40 });
    }
    expect(shown).not.toContain(102);
    expect(shown).toContain(103);
  });

  it("hides a genre after three noes unless a friend liked the film", () => {
    const films = Array.from({ length: 30 }, (_, i) => film(i + 1, { genres: [i < 10 ? 1 : 2] }));
    let d = createDeck(films, "me", 0);
    for (const id of [1, 2, 3]) d = applySwipe(d, { participant_id: "me", film_id: id, liked: false });
    const shown: number[] = [];
    while (d.frozen.length) {
      shown.push(d.frozen[0]);
      d = applySwipe(d, { participant_id: "me", film_id: d.frozen[0], liked: d.frozen[0] > 10 });
    }
    expect(shown.filter((id) => id > 3 && id <= 10).length).toBeLessThanOrEqual(DECK_RULES.frozen);
  });

  it("drips reserve films into a long run", () => {
    let d = createDeck(pool(200), "me", 0);
    const shown: number[] = [];
    for (let i = 0; i < 39; i++) {
      shown.push(d.frozen[0]);
      d = applySwipe(d, { participant_id: "me", film_id: d.frozen[0], liked: true });
    }
    expect(shown.some((id) => d.reserve.has(id))).toBe(true);
  });
});

// Random play: fast local swipes against remote events that arrive late, twice and out of order.
function simulate(seed: number) {
  const random = rng(seed);
  const films = pool(40 * 5);
  const people = ["a", "b", "c", "d"];
  const decks: Record<string, DeckState> = Object.fromEntries(people.map((p, i) => [p, createDeck(films, p, i)]));
  const inbox: Record<string, Swipe[]> = Object.fromEntries(people.map((p) => [p, []]));
  const history: Record<string, Swipe[]> = Object.fromEntries(people.map((p) => [p, []]));
  const seen: Record<string, Set<number>> = Object.fromEntries(people.map((p) => [p, new Set()]));

  const assertFrozen = (before: number[], after: number[], removed?: number) => {
    const kept = removed === undefined ? before : before.filter((id) => id !== removed);
    expect(after.slice(0, kept.length)).toEqual(kept);
  };

  for (let step = 0; step < 800; step++) {
    const p = people[Math.floor(random() * 4)];
    const deck = decks[p];
    if (random() < 0.55 && deck.frozen.length) {
      const front = deck.frozen[0];
      expect(seen[p].has(front)).toBe(false);
      seen[p].add(front);
      const swipe = { participant_id: p, film_id: front, liked: random() < 0.4 };
      decks[p] = applySwipe(deck, swipe);
      assertFrozen(deck.frozen, decks[p].frozen, front);
      history[p].push(swipe);
      for (const q of people) if (q !== p) inbox[q].push(swipe);
      if (random() < 0.3) decks[p] = applySwipe(decks[p], swipe); // realtime echo
    } else if (inbox[p].length) {
      const i = Math.floor(random() * inbox[p].length); // out of order
      const swipe = inbox[p][i];
      if (random() < 0.8) inbox[p].splice(i, 1); // sometimes delivered again
      const before = deck.frozen;
      decks[p] = applySwipe(deck, swipe);
      assertFrozen(before, decks[p].frozen);
    }
  }
  return { decks, inbox, history, films, people };
}

describe("simulation", () => {
  it("holds its invariants across thousands of swipes", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { decks } = simulate(seed);
      for (const d of Object.values(decks)) {
        expect(new Set(d.frozen).size).toBe(d.frozen.length);
        for (const id of d.frozen) expect(d.swiped.has(id)).toBe(false);
      }
    }
  });

  it("reaches the same facts in any delivery order", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { history, films, people } = simulate(seed);
      const all = people.flatMap((p) => history[p]);
      const random = rng(seed + 999);
      const shuffled = [...all].sort(() => random() - 0.5);
      const a = buildDeck(films, "a", 0, all);
      const b = buildDeck(films, "a", 0, shuffled);
      expect([...b.swiped].sort()).toEqual([...a.swiped].sort());
      expect([...b.rejected].sort()).toEqual([...a.rejected].sort());
      expect([...b.genreScore].sort()).toEqual([...a.genreScore].sort());
    }
  });

  it("only ever exposes real pool films", () => {
    const films = pool(40);
    const d = applySwipe(createDeck(films, "a", 0), { participant_id: "b", film_id: 9999, liked: true });
    expect(frontFilms(d).every((f) => f.id <= 40)).toBe(true);
  });
});

describe("families", () => {
  it("joins franchises TMDB splits apart", () => {
    const spidey = ["Spider-Man", "Spider-Man 2", "The Amazing Spider-Man", "The Amazing Spider-Man 2", "Spider-Man: Homecoming", "Spider-Man: No Way Home", "Spider-Man: Into the Spider-Verse"];
    expect(new Set(spidey.map(familyKey)).size).toBe(1);
    expect(familyKey("Harry Potter and the Goblet of Fire")).toBe(familyKey("Harry Potter and the Chamber of Secrets"));
    expect(familyKey("The Godfather Part II")).toBe(familyKey("The Godfather"));
    expect(familyKey("Parasite")).not.toBe(familyKey("Spider-Man"));
  });
});
