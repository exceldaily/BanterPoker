"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { subscribeGame, type ConnectionState, type PresenceMeta } from "@/lib/realtime";
import type { GameSnapshot, PublicSnapshot } from "@/lib/types";

// Single source of truth for a device's view of one table.
//
//  * Realtime broadcasts carry the PUBLIC snapshot and apply immediately.
//  * Anything private (my hole cards, control-only data such as the join code
//    and device list) comes from get_game_snapshot over /api/rpc, refetched
//    whenever the hand changes, on reconnect, on tab focus and on a slow poll.
//  * Versions are monotonic, so a late broadcast can never roll state back.

export interface GameState {
  snapshot: GameSnapshot | null;
  connection: ConnectionState;
  presence: PresenceMeta[];
  error: ApiError | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Run an action and immediately reconcile with the returned snapshot. */
  act: <T>(fn: () => Promise<T>) => Promise<T>;
}

const POLL_MS = 15_000;

export function useGame(gameId: string | null): GameState {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("reconnecting");
  const [presence, setPresence] = useState<PresenceMeta[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const snapRef = useRef<GameSnapshot | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const trackRef = useRef<((m: PresenceMeta) => Promise<void>) | null>(null);

  const applyPrivate = useCallback((next: GameSnapshot) => {
    const cur = snapRef.current;
    if (cur && cur.game.version > next.game.version) {
      // Keep the newer public data but adopt fresh private fields.
      const merged: GameSnapshot = { ...cur, me: next.me, control: next.control ?? cur.control };
      snapRef.current = merged;
      setSnapshot(merged);
      return;
    }
    snapRef.current = next;
    setSnapshot(next);
  }, []);

  const refresh = useCallback(async () => {
    if (!gameId) return;
    if (inflight.current) return inflight.current;
    const p = (async () => {
      try {
        const next = await api.snapshot(gameId);
        applyPrivate(next);
        setError(null);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err);
        } else {
          setError(new ApiError("NETWORK"));
        }
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = p;
    return p;
  }, [gameId, applyPrivate]);

  const applyPublic = useCallback(
    (pub: PublicSnapshot) => {
      const cur = snapRef.current;
      if (!cur) {
        void refresh();
        return;
      }
      if (pub.game.version <= cur.game.version) return;
      const handChanged = (pub.hand?.id ?? null) !== (cur.hand?.id ?? null);
      const myHandStatus = cur.me.playerId ? pub.players.find((p) => p.id === cur.me.playerId)?.handStatus ?? null : null;
      const merged: GameSnapshot = {
        ...cur,
        game: pub.game,
        players: pub.players,
        hand: pub.hand,
        tournament: pub.tournament,
        me: {
          ...cur.me,
          status: cur.me.playerId ? pub.players.find((p) => p.id === cur.me.playerId)?.status ?? cur.me.status : cur.me.status,
          seat: cur.me.playerId ? pub.players.find((p) => p.id === cur.me.playerId)?.seat ?? cur.me.seat : cur.me.seat,
          hand: handChanged
            ? null
            : cur.me.hand
              ? { ...cur.me.hand, status: myHandStatus ?? cur.me.hand.status, cards: myHandStatus === "folded" ? null : cur.me.hand.cards }
              : null,
        },
      };
      snapRef.current = merged;
      setSnapshot(merged);
      // Private data (my cards, control block) must be fetched, never broadcast.
      const needsPrivate = handChanged || cur.me.canControl || (cur.me.playerId && !merged.me.hand && pub.hand && pub.hand.state !== "complete");
      if (needsPrivate) void refresh();
    },
    [refresh],
  );

  // State is per mount: callers key the consuming component by gameId, so a
  // different table always starts from a clean hook (no reset effect needed).
  useEffect(() => {
    if (!gameId) return;
    const kick = window.setTimeout(() => void refresh(), 0);

    const sub = subscribeGame(gameId, {
      onSnapshot: applyPublic,
      onPresence: setPresence,
      onState: (s) => {
        setConnection(s);
        if (s === "connected") void refresh();
      },
    });
    trackRef.current = sub.track;

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onOnline = () => void refresh();
    const onOffline = () => setConnection("offline");
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);

    return () => {
      window.clearTimeout(kick);
      sub.close();
      trackRef.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(poll);
    };
  }, [gameId, refresh, applyPublic]);

  // Presence: announce who this device is (public info only).
  const me = snapshot?.me;
  useEffect(() => {
    if (!me?.deviceId || !trackRef.current) return;
    void trackRef.current({
      deviceId: me.deviceId,
      role: me.role,
      playerId: me.playerId ?? null,
      name: me.name ?? null,
      canControl: me.canControl ?? false,
      isHost: me.isHost ?? false,
      at: Date.now(),
    });
  }, [me?.deviceId, me?.role, me?.playerId, me?.name, me?.canControl, me?.isHost, connection]);

  const act = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        const out = await fn();
        void refresh();
        return out;
      } catch (err) {
        // A stale-state rejection means the table moved on: pull the truth.
        if (err instanceof ApiError && ["INVALID_TRANSITION", "HAND_IN_PROGRESS", "NO_HAND", "SEAT_TAKEN"].includes(err.code)) {
          void refresh();
        }
        throw err;
      }
    },
    [refresh],
  );

  return useMemo(
    () => ({ snapshot, connection, presence, error, loading, refresh, act }),
    [snapshot, connection, presence, error, loading, refresh, act],
  );
}
