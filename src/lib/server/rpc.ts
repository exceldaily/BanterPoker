import "server-only";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { ApiError, errorFromPostgrest } from "@/lib/errors";

// Server-side bridge to the banterpoker Postgres functions.
//
// The browser never talks to the database directly for anything privileged:
// it calls /api/rpc, this module reads the device secret from an httpOnly
// cookie and forwards it as function arguments over the PostgREST RPC
// endpoint using only the public anon key. Authorization is enforced inside
// the SECURITY DEFINER functions, so even a forged request with the anon key
// cannot do more than that device is allowed to.

import { SUPABASE_ANON_KEY as ANON_KEY, SUPABASE_URL } from "@/lib/supabase-public";

const SCHEMA = "banterpoker";

export const DEVICE_COOKIE = "bp_device";

export interface DeviceCredentials {
  deviceId: string;
  secret: string;
}

const uuid = z.string().uuid();
const secret = z.string().min(20).max(120).regex(/^[A-Za-z0-9_-]+$/);

export function parseDeviceCookie(value: string | undefined): DeviceCredentials | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const sec = value.slice(dot + 1);
  if (!uuid.safeParse(id).success || !secret.safeParse(sec).success) return null;
  return { deviceId: id, secret: sec };
}

export function serializeDeviceCookie(c: DeviceCredentials): string {
  return `${c.deviceId}.${c.secret}`;
}

async function clientHint(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = h.get("x-real-ip");
  return (fwd || real || "local").slice(0, 64);
}

/** Calls a banterpoker.* function through PostgREST with the anon key. */
export async function callFunction<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY!,
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
      "Content-Profile": SCHEMA,
      "Accept-Profile": SCHEMA,
      "x-bp-client": await clientHint(),
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    throw errorFromPostgrest(body);
  }
  // Code-lookup functions return {"error": CODE} instead of raising so their
  // rate-limit counters commit. Surface those exactly like raised errors.
  if (body && typeof body === "object" && !Array.isArray(body) && "error" in body && Object.keys(body).length === 1) {
    throw new ApiError(String((body as { error: unknown }).error));
  }
  return body as T;
}

/** Reads the device cookie, or registers a new device and returns credentials to set. */
export async function currentDevice(): Promise<DeviceCredentials | null> {
  const store = await cookies();
  return parseDeviceCookie(store.get(DEVICE_COOKIE)?.value);
}

export async function registerDevice(label: string | null, userAgent: string | null): Promise<DeviceCredentials> {
  const out = await callFunction<{ deviceId: string; secret: string }>("register_device", {
    p_label: label,
    p_user_agent: userAgent,
  });
  return { deviceId: out.deviceId, secret: out.secret };
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  };
}

/**
 * Functions the browser may invoke through /api/rpc, with the exact argument
 * schema each accepts. p_device_id / p_secret are injected server-side and can
 * never be supplied by the client.
 */
export const RPC_ALLOWLIST = {
  my_games: z.object({}),
  create_game: z.object({ p_config: z.record(z.string(), z.unknown()) }),
  lookup_game: z.object({ p_join_code: z.string().min(4).max(8) }),
  join_game: z.object({
    p_join_code: z.string().min(4).max(8),
    p_display_name: z.string().min(1).max(24),
    p_device_label: z.string().max(60).nullable().optional(),
  }),
  choose_seat: z.object({ p_game_id: uuid, p_seat: z.number().int().min(1).max(12) }),
  set_display_name: z.object({ p_game_id: uuid, p_name: z.string().min(1).max(24) }),
  set_avatar: z.object({
    p_game_id: uuid,
    p_avatar: z.string().max(16384).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/).nullable(),
  }),
  leave_game: z.object({ p_game_id: uuid }),
  get_game_snapshot: z.object({ p_game_id: uuid }),
  set_seating_locked: z.object({ p_game_id: uuid, p_locked: z.boolean() }),
  set_player_status: z.object({
    p_game_id: uuid,
    p_player_id: uuid,
    p_status: z.enum(["active", "sitting_out", "eliminated", "removed"]),
  }),
  move_player_seat: z.object({ p_game_id: uuid, p_player_id: uuid, p_seat: z.number().int().min(1).max(12) }),
  set_dealer_seat: z.object({ p_game_id: uuid, p_seat: z.number().int().min(1).max(12) }),
  create_dealer_pairing: z.object({ p_game_id: uuid }),
  pair_dealer: z.object({ p_pairing_code: z.string().min(4).max(8), p_device_label: z.string().max(60).nullable().optional() }),
  revoke_dealer: z.object({ p_game_id: uuid, p_target_device_id: uuid }),
  disconnect_device: z.object({ p_game_id: uuid, p_target_device_id: uuid }),
  claim_player: z.object({ p_join_code: z.string().min(4).max(8), p_player_id: uuid }),
  transfer_host: z.object({ p_game_id: uuid, p_target_device_id: uuid }),
  update_settings: z.object({ p_game_id: uuid, p_patch: z.record(z.string(), z.unknown()) }),
  replace_levels: z.object({ p_game_id: uuid, p_levels: z.array(z.record(z.string(), z.unknown())).max(60) }),
  start_game: z.object({ p_game_id: uuid }),
  start_hand: z.object({ p_game_id: uuid }),
  deal_flop: z.object({ p_game_id: uuid }),
  deal_turn: z.object({ p_game_id: uuid }),
  deal_river: z.object({ p_game_id: uuid }),
  end_hand: z.object({ p_game_id: uuid }),
  fold_hand: z.object({ p_game_id: uuid }),
  dealer_mark_folded: z.object({ p_game_id: uuid, p_player_id: uuid }),
  show_hand: z.object({ p_game_id: uuid }),
  muck_hand: z.object({ p_game_id: uuid }),
  timer_action: z.object({
    p_game_id: uuid,
    p_action: z.enum(["pause", "resume", "next", "prev", "reset", "add_seconds"]),
    p_arg: z.number().int().min(-3600).max(3600).nullable().optional(),
  }),
  sync_timer: z.object({ p_game_id: uuid }),
  end_game: z.object({ p_game_id: uuid, p_winner_player_id: uuid.nullable().optional() }),
  set_winner: z.object({ p_game_id: uuid, p_winner_player_id: uuid.nullable() }),
  get_events: z.object({ p_game_id: uuid, p_after: z.number().int().min(0).optional(), p_limit: z.number().int().min(1).max(500).optional() }),
} as const;

export type RpcName = keyof typeof RPC_ALLOWLIST;

export function isRpcName(name: string): name is RpcName {
  return Object.prototype.hasOwnProperty.call(RPC_ALLOWLIST, name);
}

/** Validates args and invokes the function as the given device. */
export async function invokeAsDevice<T>(device: DeviceCredentials, fn: RpcName, rawArgs: unknown): Promise<T> {
  const parsed = RPC_ALLOWLIST[fn].safeParse(rawArgs ?? {});
  if (!parsed.success) {
    throw new ApiError("ARG_INVALID");
  }
  return callFunction<T>(fn, { p_device_id: device.deviceId, p_secret: device.secret, ...parsed.data });
}
