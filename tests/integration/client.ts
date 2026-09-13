// Thin PostgREST client for integration tests. Talks to the real shared
// Supabase project with the PUBLIC anon key only, exactly like the app server
// does, so what passes here is what the product actually enforces.

import { config } from "dotenv";
config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!URL || !KEY) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing (see .env.example)");

export class DbError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

// The app server forwards the client IP as x-bp-client for per-IP limits on
// device registration; each test run identifies itself so repeated runs do not
// share (and exhaust) one bucket.
const RUN_ID = `vitest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", "Content-Profile": "banterpoker", "Accept-Profile": "banterpoker", "x-bp-client": RUN_ID },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new DbError(String(body?.message ?? body?.code ?? res.status), res.status);
  if (body && typeof body === "object" && !Array.isArray(body) && "error" in body && Object.keys(body).length === 1) {
    throw new DbError(String(body.error), 200);
  }
  return body as T;
}

/** Raw REST access to a table (expected to be denied). */
export async function restSelect(table: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${URL}/rest/v1/${table}?select=*&limit=5`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Accept-Profile": "banterpoker" } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export interface Device {
  deviceId: string;
  secret: string;
}

export async function mint(label: string): Promise<Device> {
  return rpc<Device>("register_device", { p_label: label, p_user_agent: "vitest" });
}

export function as(d: Device) {
  const call = <T = unknown>(fn: string, args: Record<string, unknown> = {}) => rpc<T>(fn, { p_device_id: d.deviceId, p_secret: d.secret, ...args });
  return {
    call,
    snapshot: (gameId: string) => call<Snapshot>("get_game_snapshot", { p_game_id: gameId }),
  };
}

export interface Snapshot {
  game: { id: string; status: string; version: number; dealerSeat: number | null; handCount: number; seatingLocked: boolean; winnerPlayerId: string | null };
  players: Array<{ id: string; name: string; seat: number | null; status: string; handStatus: string | null; shownCards: [string, string] | null; avatar: string | null }>;
  hand: { id: string; number: number; state: string; dealerSeat: number; smallBlindSeat: number; bigBlindSeat: number; board: string[]; playersDealtIn: number; playersRemaining: number; playersFolded: number } | null;
  tournament: { levels: Array<{ id: string; type: string; durationSeconds: number }>; currentLevelId: string | null; timerStatus: string; remainingSeconds: number; pendingAdvance: boolean };
  me: { role: string; canControl: boolean; isHost: boolean; playerId: string | null; seat: number | null; status: string | null; hand: { status: string; cards: [string, string] | null } | null };
  control?: { joinCode: string; displayToken: string; devices: Array<{ deviceId: string; role: string; canControl: boolean; isHost: boolean; playerId: string | null }>; dealerPairingCode: string | null };
}

export async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DbError && err.code === code) return;
    throw new Error(`expected ${code}, got ${err instanceof DbError ? err.code : String(err)}`);
  }
  throw new Error(`expected ${code}, but call succeeded`);
}

export const LEVELS = [
  { smallBlind: 25, bigBlind: 50, durationSeconds: 60 },
  { type: "break", durationSeconds: 60 },
  { smallBlind: 50, bigBlind: 100, ante: 10, anteType: "standard", durationSeconds: 1200 },
  { smallBlind: 100, bigBlind: 200, ante: 200, anteType: "big_blind", durationSeconds: 1200 },
];

/** Creates a table with a host of the given mode and N seated players. Returns everything needed to drive it. */
export async function makeTable(opts: { mode: "play_host" | "dealer"; players: number; seats?: number; timerMode?: "tournament" | "casual" | "none"; advanceAfterHand?: boolean; autoAdvance?: boolean }) {
  const host = await mint("host");
  const created = await as(host).call<{ gameId: string; joinCode: string; playerId: string | null }>("create_game", {
    p_config: {
      tableName: "vitest table",
      maxSeats: opts.seats ?? Math.max(opts.players + (opts.mode === "play_host" ? 1 : 0), 2),
      mode: opts.mode,
      displayName: opts.mode === "play_host" ? "Host" : undefined,
      timerMode: opts.timerMode ?? "tournament",
      levels: LEVELS,
      allowLateEntry: true,
      autoAdvanceLevels: opts.autoAdvance ?? true,
      advanceAfterHand: opts.advanceAfterHand ?? false,
    },
  });
  const gameId = created.gameId;
  let seat = 1;
  if (opts.mode === "play_host") {
    await as(host).call("choose_seat", { p_game_id: gameId, p_seat: seat++ });
  }
  const players: Array<{ device: Device; playerId: string; seat: number }> = [];
  for (let i = 0; i < opts.players; i++) {
    const d = await mint(`p${i}`);
    const joined = await as(d).call<{ playerId: string }>("join_game", { p_join_code: created.joinCode, p_display_name: `Player ${i + 1}` });
    await as(d).call("choose_seat", { p_game_id: gameId, p_seat: seat });
    players.push({ device: d, playerId: joined.playerId, seat });
    seat++;
  }
  return { host, hostPlayerId: created.playerId, gameId, joinCode: created.joinCode, players };
}
