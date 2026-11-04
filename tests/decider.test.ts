import { describe, expect, it } from "vitest";
import { resolveRound, shortlist } from "@/lib/decider";
import type { Film, Swipe } from "@/lib/types";

const m = (cross_id: number | null, tick_id: number) => ({ cross_id, tick_id });
const film = (id: number) => ({ id }) as Film;
const like = (film_id: number, n: string): Swipe => ({ film_id, participant_id: n, liked: true });

describe("resolveRound", () => {
  it("removes crossed films and keeps ticked survivors", () => {
    expect(resolveRound([1, 2, 3, 4, 5, 6], [m(1, 2), m(3, 4), m(5, 2), m(6, 4)])).toEqual({ next: [2, 4] });
  });
  it("does not let a crossed film survive on a tick", () => {
    expect(resolveRound([1, 2, 3, 4], [m(1, 2), m(2, 3), m(4, 3)])).toEqual({ winner: 3 });
  });
  it("final round is tick only, most ticks wins", () => {
    expect(resolveRound([1, 2], [m(null, 1), m(null, 1), m(null, 2)])).toEqual({ winner: 1 });
  });
  it("final tie and empty final go to the randomiser", () => {
    expect(resolveRound([1, 2], [m(null, 1), m(null, 2)])).toEqual({ tied: [1, 2] });
    expect(resolveRound([1, 2], [])).toEqual({ tied: [1, 2] });
  });
  it("everything crossed is a stalemate", () => {
    expect(resolveRound([1, 2, 3], [m(1, 2), m(2, 3), m(3, 1)])).toEqual({ tied: [1, 2, 3] });
  });
  it("no marks at all is a stalemate", () => {
    expect(resolveRound([1, 2, 3], [])).toEqual({ tied: [1, 2, 3] });
  });
  it("survivors continue if nobody ticked one of them", () => {
    expect(resolveRound([1, 2, 3, 4], [m(1, 1)])).toEqual({ next: [2, 3, 4] });
  });
  it("always terminates", () => {
    for (let seed = 0; seed < 2000; seed++) {
      let ids = [1, 2, 3, 4, 5, 6, 7, 8].slice(0, 2 + (seed % 7));
      for (let round = 0; ; round++) {
        expect(round).toBeLessThan(9);
        const marks = [0, 1, 2, 3].map((p) => {
          const r = (p * 7 + seed * (round + 3)) % ids.length;
          return m(ids.length === 2 ? null : ids[r], ids[(r + 1) % ids.length]);
        });
        const out = resolveRound(ids, marks);
        if (!("next" in out)) break;
        expect(out.next.length).toBeLessThan(ids.length);
        ids = out.next;
      }
    }
  });
});

describe("shortlist", () => {
  it("ranks by likes and sizes to the group", () => {
    const swipes = [like(1, "a"), like(1, "b"), like(2, "a"), like(3, "a"), like(4, "a"), like(5, "b")];
    expect(shortlist([], swipes, 2)).toHaveLength(4);
    expect(shortlist([], swipes, 2)[0]).toBe(1);
  });
  it("fills from the pool when too few were liked", () => {
    expect(shortlist([film(7), film(8), film(9), film(10)], [like(9, "a")], 2)).toEqual([9, 7, 8, 10].slice(0, 4));
  });
});
