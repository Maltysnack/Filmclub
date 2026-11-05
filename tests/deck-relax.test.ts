import { describe, expect, it } from "vitest";
import { applySwipe, createDeck } from "@/lib/deck";
import type { Film } from "@/lib/types";

const films = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, genres: [1], family: `f${i}`, services: [] }) as unknown as Film);

describe("deck with no likes", () => {
  it("keeps showing films that taste filters would hide", () => {
    let deck = createDeck(films, "me", 0);
    while (deck.frozen[0] !== undefined) deck = applySwipe(deck, { participant_id: "me", film_id: deck.frozen[0], liked: false });
    expect(deck.swiped.size).toBe(12);
  });
});
