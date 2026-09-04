// Canonical card identifiers: rank + suit, e.g. "AS", "TD", "2C".
// Ranks: A 2 3 4 5 6 7 8 9 T J Q K. Suits: S H D C.
// These mirror banterpoker.fresh_deck() in the database exactly.

export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"] as const;
export const SUITS = ["S", "H", "D", "C"] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];
export type CardId = `${Rank}${Suit}`;

export interface CardInfo {
  id: CardId;
  rank: Rank;
  suit: Suit;
  /** Display rank: "10" for T, otherwise the rank letter. */
  rankLabel: string;
  suitSymbol: "♠" | "♥" | "♦" | "♣";
  suitName: "spades" | "hearts" | "diamonds" | "clubs";
  color: "black" | "red";
  /** Screen-reader friendly, e.g. "ace of spades". */
  name: string;
}

const SUIT_META: Record<Suit, Pick<CardInfo, "suitSymbol" | "suitName" | "color">> = {
  S: { suitSymbol: "♠", suitName: "spades", color: "black" },
  H: { suitSymbol: "♥", suitName: "hearts", color: "red" },
  D: { suitSymbol: "♦", suitName: "diamonds", color: "red" },
  C: { suitSymbol: "♣", suitName: "clubs", color: "black" },
};

const RANK_NAMES: Record<Rank, string> = {
  A: "ace", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven",
  "8": "eight", "9": "nine", T: "ten", J: "jack", Q: "queen", K: "king",
};

/** All 52 cards, suit-major order to match the database's fresh_deck(). */
export function freshDeck(): CardId[] {
  const deck: CardId[] = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      deck.push(`${r}${s}`);
    }
  }
  return deck;
}

export function isCardId(value: unknown): value is CardId {
  if (typeof value !== "string" || value.length !== 2) return false;
  return (RANKS as readonly string[]).includes(value[0]!) && (SUITS as readonly string[]).includes(value[1]!);
}

export function parseCard(id: string): CardInfo {
  if (!isCardId(id)) {
    throw new Error(`Invalid card id: ${id}`);
  }
  const rank = id[0] as Rank;
  const suit = id[1] as Suit;
  const meta = SUIT_META[suit];
  return {
    id,
    rank,
    suit,
    rankLabel: rank === "T" ? "10" : rank,
    ...meta,
    name: `${RANK_NAMES[rank]} of ${meta.suitName}`,
  };
}

/** Human-readable "A♠" form used in compact text contexts. */
export function cardText(id: string): string {
  const c = parseCard(id);
  return `${c.rankLabel}${c.suitSymbol}`;
}

/**
 * Validates a deck: exactly 52 entries, every canonical card exactly once.
 * Used by fairness tests against real shuffles from the database.
 */
export function validateDeck(cards: readonly string[]): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (cards.length !== 52) problems.push(`expected 52 cards, got ${cards.length}`);
  const seen = new Set<string>();
  for (const c of cards) {
    if (!isCardId(c)) problems.push(`invalid card ${c}`);
    if (seen.has(c)) problems.push(`duplicate card ${c}`);
    seen.add(c);
  }
  for (const c of freshDeck()) {
    if (!seen.has(c)) problems.push(`missing card ${c}`);
  }
  return { ok: problems.length === 0, problems };
}
