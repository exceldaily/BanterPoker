import { ApiError } from "@/lib/errors";
import type { CreateGameConfig, GameEvent, GameSnapshot, PublicSnapshot } from "@/lib/types";

// Browser-side wrapper around /api/rpc. Every call is authenticated by the
// httpOnly device cookie; the browser never sees the device secret.

interface RpcOk<T> {
  result: T;
}
interface RpcErr {
  error: string;
  reset?: boolean;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(typeof navigator !== "undefined" && !navigator.onLine ? "OFFLINE" : "NETWORK");
  }
  const data = (await res.json().catch(() => null)) as RpcOk<T> | RpcErr | null;
  if (!res.ok || !data || "error" in data) {
    const code = data && "error" in data ? data.error : "NETWORK";
    throw new ApiError(code);
  }
  return data.result;
}

/** Development simulator: a window may impersonate a minted fake device. Ignored in production builds. */
interface DevWindow extends Window {
  __bpDev?: { deviceId: string; secret: string };
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    const dev = (window as DevWindow).__bpDev;
    if (dev) return post<T>("/api/dev", { op: "rpc", deviceId: dev.deviceId, secret: dev.secret, fn, args });
  }
  return post<T>("/api/rpc", { fn, args });
}

export interface MyGame {
  gameId: string;
  tableName: string;
  status: "lobby" | "active" | "complete";
  role: "player" | "dealer";
  canControl: boolean;
  isHost: boolean;
  playerId: string | null;
  updatedAt: string;
}

export async function ensureDevice(): Promise<{ deviceId: string; games: MyGame[] }> {
  let res: Response;
  try {
    res = await fetch("/api/device", { method: "POST", credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError("NETWORK");
  }
  const data = (await res.json().catch(() => null)) as { deviceId: string; games: MyGame[] } | RpcErr | null;
  if (!res.ok || !data || "error" in data) throw new ApiError(data && "error" in data ? data.error : "NETWORK");
  return data;
}

export const api = {
  createGame: (config: CreateGameConfig) =>
    rpc<{ gameId: string; joinCode: string; playerId: string | null; role: "player" | "dealer" }>("create_game", { p_config: config }),
  lookupGame: (code: string) =>
    rpc<{
      gameId: string;
      tableName: string;
      status: "lobby" | "active" | "complete";
      maxSeats: number;
      seated: number;
      seatingLocked: boolean;
      allowLateEntry: boolean;
      alreadyMember: boolean;
    }>("lookup_game", { p_join_code: code }),
  joinGame: (code: string, name: string, label?: string) =>
    rpc<{ gameId: string; playerId: string | null; role: "player" | "dealer"; rejoined: boolean }>("join_game", {
      p_join_code: code,
      p_display_name: name,
      p_device_label: label ?? null,
    }),
  chooseSeat: (gameId: string, seat: number) => rpc<{ seat: number }>("choose_seat", { p_game_id: gameId, p_seat: seat }),
  setDisplayName: (gameId: string, name: string) => rpc<null>("set_display_name", { p_game_id: gameId, p_name: name }),
  leaveGame: (gameId: string) => rpc<null>("leave_game", { p_game_id: gameId }),
  snapshot: (gameId: string) => rpc<GameSnapshot>("get_game_snapshot", { p_game_id: gameId }),
  setSeatingLocked: (gameId: string, locked: boolean) => rpc<null>("set_seating_locked", { p_game_id: gameId, p_locked: locked }),
  setPlayerStatus: (gameId: string, playerId: string, status: "active" | "sitting_out" | "eliminated" | "removed") =>
    rpc<null>("set_player_status", { p_game_id: gameId, p_player_id: playerId, p_status: status }),
  movePlayerSeat: (gameId: string, playerId: string, seat: number) =>
    rpc<null>("move_player_seat", { p_game_id: gameId, p_player_id: playerId, p_seat: seat }),
  setDealerSeat: (gameId: string, seat: number) => rpc<null>("set_dealer_seat", { p_game_id: gameId, p_seat: seat }),
  createDealerPairing: (gameId: string) => rpc<{ pairingCode: string; expiresAt: string }>("create_dealer_pairing", { p_game_id: gameId }),
  pairDealer: (code: string, label?: string) =>
    rpc<{ gameId: string; role: "player" | "dealer" }>("pair_dealer", { p_pairing_code: code, p_device_label: label ?? null }),
  revokeDealer: (gameId: string, deviceId: string) => rpc<null>("revoke_dealer", { p_game_id: gameId, p_target_device_id: deviceId }),
  disconnectDevice: (gameId: string, deviceId: string) =>
    rpc<null>("disconnect_device", { p_game_id: gameId, p_target_device_id: deviceId }),
  claimPlayer: (code: string, playerId: string) => rpc<{ gameId: string; playerId: string }>("claim_player", { p_join_code: code, p_player_id: playerId }),
  transferHost: (gameId: string, deviceId: string) => rpc<null>("transfer_host", { p_game_id: gameId, p_target_device_id: deviceId }),
  updateSettings: (gameId: string, patch: Record<string, unknown>) => rpc<null>("update_settings", { p_game_id: gameId, p_patch: patch }),
  replaceLevels: (gameId: string, levels: unknown[]) => rpc<null>("replace_levels", { p_game_id: gameId, p_levels: levels }),
  startGame: (gameId: string) => rpc<null>("start_game", { p_game_id: gameId }),
  startHand: (gameId: string) => rpc<{ handId: string; handNumber: number }>("start_hand", { p_game_id: gameId }),
  dealFlop: (gameId: string) => rpc<{ state: string; board: string[] }>("deal_flop", { p_game_id: gameId }),
  dealTurn: (gameId: string) => rpc<{ state: string; board: string[] }>("deal_turn", { p_game_id: gameId }),
  dealRiver: (gameId: string) => rpc<{ state: string; board: string[] }>("deal_river", { p_game_id: gameId }),
  endHand: (gameId: string) => rpc<{ handId: string; nextDealerSeat: number | null }>("end_hand", { p_game_id: gameId }),
  foldHand: (gameId: string) => rpc<null>("fold_hand", { p_game_id: gameId }),
  dealerMarkFolded: (gameId: string, playerId: string) => rpc<null>("dealer_mark_folded", { p_game_id: gameId, p_player_id: playerId }),
  showHand: (gameId: string) => rpc<null>("show_hand", { p_game_id: gameId }),
  muckHand: (gameId: string) => rpc<null>("muck_hand", { p_game_id: gameId }),
  timerAction: (gameId: string, action: "pause" | "resume" | "next" | "prev" | "reset" | "add_seconds", arg?: number) =>
    rpc<{ timerStatus: string; remainingSeconds: number; currentLevelId: string | null }>("timer_action", {
      p_game_id: gameId,
      p_action: action,
      p_arg: arg ?? null,
    }),
  syncTimer: (gameId: string) => rpc<{ timerStatus: string }>("sync_timer", { p_game_id: gameId }),
  endGame: (gameId: string, winnerPlayerId?: string | null) =>
    rpc<{ ended: boolean }>("end_game", { p_game_id: gameId, p_winner_player_id: winnerPlayerId ?? null }),
  setWinner: (gameId: string, winnerPlayerId: string | null) =>
    rpc<null>("set_winner", { p_game_id: gameId, p_winner_player_id: winnerPlayerId }),
  events: (gameId: string, after = 0, limit = 100) => rpc<GameEvent[]>("get_events", { p_game_id: gameId, p_after: after, p_limit: limit }),
  displaySnapshot: (token: string) => post<PublicSnapshot & { me: { role: "display" } }>("/api/display", { token }),
};
