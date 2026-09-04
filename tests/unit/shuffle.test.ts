import { describe, expect, it } from "vitest";
import { freshDeck, validateDeck } from "@/lib/cards";
import { randomInt, secureShuffle, webCryptoSource, type RandomSource } from "@/lib/shuffle";

/** Deterministic source for exercising rejection sampling paths. */
function scripted(values: number[]): RandomSource {
  let i = 0;
  return {
    fill(bytes) {
      const v = values[i++ % values.length]! >>> 0;
      bytes[0] = (v >>> 24) & 0xff;
      bytes[1] = (v >>> 16) & 0xff;
      bytes[2] = (v >>> 8) & 0xff;
      bytes[3] = v & 0xff;
    },
  };
}

describe("randomInt", () => {
  it("returns values in [1, n]", () => {
    for (let n = 1; n <= 52; n++) {
      for (let k = 0; k < 50; k++) {
        const v = randomInt(n, webCryptoSource);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(n);
      }
    }
  });

  it("rejects biased draws above the limit and retries", () => {
    // For n = 3, limit = 2^32 - (2^32 % 3) = 4294967295. The value 4294967295 is rejected; 4 -> (4 % 3) + 1 = 2.
    const src = scripted([4294967295, 4]);
    expect(randomInt(3, src)).toBe(2);
  });

  it("is uniform enough over many draws", () => {
    const n = 6;
    const counts = new Array<number>(n).fill(0);
    const draws = 60_000;
    for (let i = 0; i < draws; i++) counts[randomInt(n) - 1]!++;
    const expected = draws / n;
    for (const c of counts) expect(Math.abs(c - expected) / expected).toBeLessThan(0.06);
  });

  it("throws on invalid n", () => {
    expect(() => randomInt(0)).toThrow();
    expect(() => randomInt(1.5)).toThrow();
  });
});

describe("secureShuffle", () => {
  it("returns a permutation of 52 unique cards without mutating input", () => {
    const deck = freshDeck();
    const copy = deck.slice();
    const out = secureShuffle(deck);
    expect(deck).toEqual(copy);
    expect(validateDeck(out).ok).toBe(true);
  });

  it("produces a different order each time (new shuffle per hand)", () => {
    const a = secureShuffle(freshDeck()).join("");
    const b = secureShuffle(freshDeck()).join("");
    expect(a).not.toBe(b);
  });

  it("with a source that always returns 0 yields a deterministic rotation (Fisher-Yates sanity)", () => {
    // j = 1 every step: each i swaps with position 1.
    // [1,2,3,4] -> i=4: [4,2,3,1] -> i=3: [3,2,4,1] -> i=2: [2,3,4,1]
    const out = secureShuffle([1, 2, 3, 4], scripted([0]));
    expect(out).toEqual([2, 3, 4, 1]);
  });

  it("every card lands in every position over many shuffles", () => {
    const seen = new Map<string, Set<number>>();
    for (let k = 0; k < 400; k++) {
      const out = secureShuffle(freshDeck());
      out.forEach((c, i) => {
        if (!seen.has(c)) seen.set(c, new Set());
        seen.get(c)!.add(i);
      });
    }
    // Each card should have appeared in a large majority of the 52 positions.
    for (const positions of seen.values()) expect(positions.size).toBeGreaterThan(45);
  });
});
