import { describe, expect, it } from "vitest";
import { freshDeck, validateDeck } from "@/lib/cards";
import { dealOrder, nextActiveSeat, planHand, positions, resolveButton, rotateButton, seatLabel, type SeatedPlayer } from "@/lib/positions";

const table = (seats: Array<[number, SeatedPlayer["status"]]>): SeatedPlayer[] => seats.map(([seat, status]) => ({ seat, status }));

describe("dealing order", () => {
  it("starts with the seat after the button and ends on the button", () => {
    const players = table([[1, "active"], [3, "active"], [5, "active"], [8, "active"]]);
    expect(dealOrder(players, 3)).toEqual([5, 8, 1, 3]);
    expect(dealOrder(players, 8)).toEqual([1, 3, 5, 8]);
  });

  it("excludes sitting-out and eliminated players", () => {
    const players = table([[1, "active"], [2, "sitting_out"], [3, "eliminated"], [4, "active"], [5, "pending"], [6, "active"]]);
    expect(dealOrder(players, 4)).toEqual([6, 1, 4]);
  });
});

describe("positions", () => {
  it("assigns SB/BB clockwise from the button with three or more players", () => {
    const order = [5, 8, 1, 3];
    expect(positions(order, 3)).toEqual({ button: 3, smallBlind: 5, bigBlind: 8 });
  });

  it("heads-up: button is the small blind, other player is the big blind", () => {
    const players = table([[2, "active"], [7, "active"]]);
    const order = dealOrder(players, 7);
    expect(order).toEqual([2, 7]);
    expect(positions(order, 7)).toEqual({ button: 7, smallBlind: 7, bigBlind: 2 });
    expect(seatLabel(7, positions(order, 7))).toBe("D/SB");
    expect(seatLabel(2, positions(order, 7))).toBe("BB");
  });

  it("throws with fewer than two players", () => {
    expect(() => positions([4], 4)).toThrow();
  });
});

describe("button rotation", () => {
  const players = table([[1, "active"], [2, "eliminated"], [3, "active"], [4, "sitting_out"], [6, "active"]]);
  it("moves clockwise to the next active seat, skipping OUT and SITTING OUT", () => {
    expect(rotateButton(players, 1)).toBe(3);
    expect(rotateButton(players, 3)).toBe(6);
    expect(rotateButton(players, 6)).toBe(1);
  });
  it("wraps around and handles a null starting point", () => {
    expect(nextActiveSeat(players, null)).toBe(1);
    expect(nextActiveSeat(players, 12)).toBe(1);
  });
  it("keeps the button if that seat is still active, otherwise advances", () => {
    expect(resolveButton(players, 3)).toBe(3);
    expect(resolveButton(players, 2)).toBe(3);
    expect(resolveButton(players, null)).toBe(1);
  });
  it("returns null when nobody is active", () => {
    expect(nextActiveSeat(table([[1, "eliminated"]]), 1)).toBeNull();
  });
});

describe("planHand (mirror of the database dealing rules)", () => {
  const deck = freshDeck(); // unshuffled so positions are predictable

  it("deals one card to each player in order, then a second", () => {
    const players = table([[1, "active"], [2, "active"], [3, "active"]]);
    const plan = planHand(deck, players, 1);
    expect(plan.order).toEqual([2, 3, 1]);
    expect(plan.holeCards.get(2)).toEqual([deck[0], deck[3]]);
    expect(plan.holeCards.get(3)).toEqual([deck[1], deck[4]]);
    expect(plan.holeCards.get(1)).toEqual([deck[2], deck[5]]);
  });

  it("burns one before the flop, turn and river and never reuses a card", () => {
    const players = table([[1, "active"], [2, "active"], [3, "active"], [4, "active"]]);
    const plan = planHand(deck, players, 4);
    const n = 4;
    expect(plan.burns[0]).toBe(deck[2 * n]);
    expect(plan.flop).toEqual([deck[2 * n + 1], deck[2 * n + 2], deck[2 * n + 3]]);
    expect(plan.burns[1]).toBe(deck[2 * n + 4]);
    expect(plan.turn).toBe(deck[2 * n + 5]);
    expect(plan.burns[2]).toBe(deck[2 * n + 6]);
    expect(plan.river).toBe(deck[2 * n + 7]);
    expect(plan.unusedFrom).toBe(2 * n + 8);
    const used = [...[...plan.holeCards.values()].flat(), ...plan.burns, ...plan.flop, plan.turn, plan.river];
    expect(new Set(used).size).toBe(used.length);
    expect(validateDeck(deck).ok).toBe(true);
  });

  it("uses 2n + 8 cards for n players and never exceeds 52 at 12 players", () => {
    const players = table(Array.from({ length: 12 }, (_, i) => [i + 1, "active"] as [number, SeatedPlayer["status"]]));
    const plan = planHand(deck, players, 12);
    expect(plan.unusedFrom).toBe(32);
    expect(plan.unusedFrom).toBeLessThanOrEqual(52);
  });

  it("refuses a hand with fewer than two active players", () => {
    expect(() => planHand(deck, table([[1, "active"], [2, "sitting_out"]]), 1)).toThrow();
  });
});
