import { describe, expect, it } from "vitest";
import { cardText, freshDeck, isCardId, parseCard, validateDeck } from "@/lib/cards";

describe("deck", () => {
  it("has exactly 52 unique canonical cards", () => {
    const d = freshDeck();
    expect(d).toHaveLength(52);
    expect(new Set(d).size).toBe(52);
    expect(validateDeck(d).ok).toBe(true);
  });

  it("matches the database ordering (suit-major, A..K)", () => {
    const d = freshDeck();
    expect(d.slice(0, 3)).toEqual(["AS", "2S", "3S"]);
    expect(d[12]).toBe("KS");
    expect(d[13]).toBe("AH");
    expect(d[51]).toBe("KC");
  });

  it("rejects bad decks", () => {
    expect(validateDeck(freshDeck().slice(1)).ok).toBe(false);
    const dup = freshDeck();
    dup[5] = "AS";
    const res = validateDeck(dup);
    expect(res.ok).toBe(false);
    expect(res.problems.some((p) => p.includes("duplicate"))).toBe(true);
    expect(validateDeck([...freshDeck().slice(0, 51), "ZZ"]).ok).toBe(false);
  });
});

describe("parseCard", () => {
  it("parses ranks and suits", () => {
    const c = parseCard("TD");
    expect(c.rankLabel).toBe("10");
    expect(c.suitSymbol).toBe("♦");
    expect(c.color).toBe("red");
    expect(c.name).toBe("ten of diamonds");
    expect(cardText("AS")).toBe("A♠");
  });
  it("rejects invalid ids", () => {
    expect(isCardId("1S")).toBe(false);
    expect(isCardId("ASX")).toBe(false);
    expect(() => parseCard("XX")).toThrow();
  });
});
