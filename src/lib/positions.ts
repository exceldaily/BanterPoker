// Pure reference implementation of Banter Poker's dealing rules. The database
// (banterpoker.start_hand / deal_street) is the authority at runtime; this
// module exists so the rules can be unit tested exhaustively and so the
// integration suite can assert that the database produced the same plan.

export interface SeatedPlayer {
  seat: number;
  status: "active" | "sitting_out" | "eliminated" | "pending" | "removed";
}

/** Next active seat strictly clockwise after `from` (wrapping). `from` may be null. */
export function nextActiveSeat(players: readonly SeatedPlayer[], from: number | null): number | null {
  const active = players.filter((p) => p.status === "active").map((p) => p.seat).sort((a, b) => a - b);
  if (active.length === 0) return null;
  const f = from ?? 0;
  const after = active.filter((s) => s > f);
  return after.length > 0 ? after[0]! : active[0]!;
}

/** The button for a new hand: keep `dealerSeat` if still active, otherwise the next active seat. */
export function resolveButton(players: readonly SeatedPlayer[], dealerSeat: number | null): number | null {
  if (dealerSeat != null && players.some((p) => p.seat === dealerSeat && p.status === "active")) return dealerSeat;
  return nextActiveSeat(players, dealerSeat);
}

/** Active seats in dealing order: clockwise from the seat after the button, ending on the button. */
export function dealOrder(players: readonly SeatedPlayer[], button: number): number[] {
  const active = players.filter((p) => p.status === "active").map((p) => p.seat).sort((a, b) => a - b);
  const after = active.filter((s) => s > button);
  const before = active.filter((s) => s <= button);
  return [...after, ...before];
}

export interface Positions {
  button: number;
  smallBlind: number;
  bigBlind: number;
}

/** Small/big blind seats with the heads-up rule: button posts the small blind. */
export function positions(order: readonly number[], button: number): Positions {
  if (order.length < 2) throw new Error("need at least two active players");
  if (order.length === 2) {
    return { button, smallBlind: button, bigBlind: order[0]! };
  }
  return { button, smallBlind: order[0]!, bigBlind: order[1]! };
}

export interface DealPlan {
  order: number[];
  positions: Positions;
  /** seat -> [card1, card2] */
  holeCards: Map<number, [string, string]>;
  burns: [string, string, string];
  flop: [string, string, string];
  turn: string;
  river: string;
  /** Index (0-based) of the first card never used in this hand. */
  unusedFrom: number;
}

/**
 * Applies a shuffled deck to a table exactly as the database does:
 * one card to each player in order, then a second; burn, flop; burn, turn; burn, river.
 */
export function planHand(deck: readonly string[], players: readonly SeatedPlayer[], dealerSeat: number | null): DealPlan {
  if (deck.length !== 52) throw new Error("deck must have 52 cards");
  const button = resolveButton(players, dealerSeat);
  if (button == null) throw new Error("no active players");
  const order = dealOrder(players, button);
  const n = order.length;
  if (n < 2) throw new Error("need at least two active players");
  const holeCards = new Map<number, [string, string]>();
  order.forEach((seat, i) => {
    holeCards.set(seat, [deck[i]!, deck[n + i]!]);
  });
  const c = 2 * n; // cursor after hole cards (0-based index of the next card)
  return {
    order,
    positions: positions(order, button),
    holeCards,
    burns: [deck[c]!, deck[c + 4]!, deck[c + 6]!],
    flop: [deck[c + 1]!, deck[c + 2]!, deck[c + 3]!],
    turn: deck[c + 5]!,
    river: deck[c + 7]!,
    unusedFrom: c + 8,
  };
}

/** Button for the hand after one dealt with `dealerSeat`. Skips inactive seats. */
export function rotateButton(players: readonly SeatedPlayer[], dealerSeat: number): number | null {
  return nextActiveSeat(players, dealerSeat);
}

/** Seat position labels for the UI given hand positions. */
export function seatLabel(seat: number, pos: Positions | null): "D" | "SB" | "BB" | "D/SB" | null {
  if (!pos) return null;
  if (seat === pos.button && seat === pos.smallBlind) return "D/SB";
  if (seat === pos.button) return "D";
  if (seat === pos.smallBlind) return "SB";
  if (seat === pos.bigBlind) return "BB";
  return null;
}
