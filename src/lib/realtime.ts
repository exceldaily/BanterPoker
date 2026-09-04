"use client";

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase-public";
import type { PublicSnapshot } from "@/lib/types";

// Realtime is used for PUBLIC data only. The database broadcasts the public
// snapshot on `game:<id>` after every mutation (see banterpoker.touch_game).
// Private hole cards never travel over this channel: a player's device fetches
// them through /api/rpc (get_game_snapshot) when a new hand appears.

let client: SupabaseClient | null = null;

export function realtimeClient(): SupabaseClient {
  if (client) return client;
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return client;
}

export type ConnectionState = "connected" | "reconnecting" | "offline";

export interface PresenceMeta {
  deviceId: string;
  role: "player" | "dealer" | "display";
  playerId?: string | null;
  name?: string | null;
  canControl?: boolean;
  isHost?: boolean;
  at: number;
}

export interface GameChannelHandlers {
  onSnapshot: (snap: PublicSnapshot) => void;
  onPresence: (present: PresenceMeta[]) => void;
  onState: (state: ConnectionState) => void;
}

export interface GameChannel {
  channel: RealtimeChannel;
  track: (meta: PresenceMeta) => Promise<void>;
  close: () => void;
}

export function subscribeGame(gameId: string, handlers: GameChannelHandlers): GameChannel {
  const sb = realtimeClient();
  const channel = sb.channel(`game:${gameId}`, {
    config: { broadcast: { self: true }, presence: { key: `${Math.random().toString(36).slice(2)}` } },
  });

  let lastMeta: PresenceMeta | null = null;

  channel
    .on("broadcast", { event: "snapshot" }, (msg) => {
      const payload = msg.payload as PublicSnapshot | undefined;
      if (payload && payload.game) handlers.onSnapshot(payload);
    })
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<PresenceMeta>();
      const list: PresenceMeta[] = [];
      for (const key of Object.keys(state)) {
        for (const m of state[key] ?? []) list.push(m);
      }
      handlers.onPresence(list);
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        handlers.onState("connected");
        if (lastMeta) void channel.track(lastMeta);
      } else if (status === "CLOSED") {
        handlers.onState("offline");
      } else {
        handlers.onState("reconnecting");
      }
    });

  return {
    channel,
    track: async (meta) => {
      lastMeta = meta;
      if (channel.state === "joined") await channel.track(meta);
    },
    close: () => {
      void sb.removeChannel(channel);
    },
  };
}
