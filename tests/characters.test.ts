import { describe, expect, it } from "vitest";
import { CHARACTER_SETS, nextName } from "@/lib/characters";

describe("nextName", () => {
  it("stays in one set, then takes a random character without repeats", () => {
    const taken: string[] = [];
    const set = "Hogwarts";
    for (let i = 0; i < 12; i++) taken.push(nextName(set, taken));
    expect(new Set(taken).size).toBe(12);
    expect(taken.slice(0, 5).every((n) => CHARACTER_SETS[set].includes(n))).toBe(true);
    expect(CHARACTER_SETS[set].includes(taken[5])).toBe(false);
  });
});
