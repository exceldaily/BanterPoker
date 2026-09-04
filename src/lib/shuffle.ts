// Reference implementation of the shuffle used inside the database
// (banterpoker.secure_shuffle): Fisher-Yates with unbiased indices drawn from
// a cryptographically secure source via rejection sampling.
//
// The database is the ONLY place a real hand is shuffled. This TypeScript copy
// exists for tests (bias, coverage, determinism properties) and for the
// development simulator, never for live dealing.

export interface RandomSource {
  /** Fills the array with cryptographically secure random bytes. */
  fill(bytes: Uint8Array): void;
}

export const webCryptoSource: RandomSource = {
  fill(bytes) {
    globalThis.crypto.getRandomValues(bytes);
  },
};

const SPAN = 4294967296; // 2^32

/** Uniform integer in [1, n], matching banterpoker.random_int. */
export function randomInt(n: number, source: RandomSource = webCryptoSource): number {
  if (!Number.isInteger(n) || n < 1) throw new Error("randomInt: n must be a positive integer");
  if (n === 1) return 1;
  const lim = SPAN - (SPAN % n);
  const buf = new Uint8Array(4);
  for (;;) {
    source.fill(buf);
    const r = ((buf[0]! << 24) >>> 0) + (buf[1]! << 16) + (buf[2]! << 8) + buf[3]!;
    if (r < lim) return (r % n) + 1;
  }
}

/** Returns a new array; the input is not mutated. */
export function secureShuffle<T>(cards: readonly T[], source: RandomSource = webCryptoSource): T[] {
  const arr = cards.slice();
  for (let i = arr.length; i >= 2; i--) {
    const j = randomInt(i, source) - 1; // 0-based
    const tmp = arr[i - 1]!;
    arr[i - 1] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}
