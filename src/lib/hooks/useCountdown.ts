"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clockOffset, timerView, type TimerView } from "@/lib/timer";
import type { SnapshotTournament } from "@/lib/types";

/**
 * Derives the visible tournament clock from authoritative server timestamps.
 * Ticks locally once a second; fires `onExpire` once when the running level
 * hits zero so the caller can ask the server to apply expiry rules.
 */
export function useCountdown(
  tournament: SnapshotTournament | null,
  handlers: { onExpire?: () => void; onWarning?: (secondsLeft: number) => void } = {},
): TimerView | null {
  const [now, setNow] = useState(() => Date.now());
  const expiredForLevel = useRef<string | null>(null);
  const warnedRef = useRef<Set<string>>(new Set());

  // Server clock offset, measured when a snapshot with a fresh serverNow arrives.
  const serverNow = tournament?.serverNow ?? null;
  const offset = useMemo(() => (serverNow ? clockOffset(serverNow) : 0), [serverNow]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const view = useMemo(() => (tournament ? timerView(tournament, now + offset) : null), [tournament, now, offset]);

  useEffect(() => {
    if (!view || !tournament) return;
    const key = `${tournament.currentLevelId}:${tournament.levelStartedAt}`;
    if (view.status === "running" && view.remainingSeconds <= 0 && expiredForLevel.current !== key) {
      expiredForLevel.current = key;
      handlers.onExpire?.();
    }
    if (view.status === "running" && handlers.onWarning) {
      for (const mark of [300, 60]) {
        const wkey = `${key}:${mark}`;
        if (view.remainingSeconds <= mark && view.remainingSeconds > mark - 2 && !warnedRef.current.has(wkey)) {
          warnedRef.current.add(wkey);
          handlers.onWarning(mark);
        }
      }
    }
  }, [view, tournament, handlers]);

  return view;
}
