"use client";

import { cn } from "@/components/ui";
import { anteLabel, formatChips, levelLabel } from "@/lib/blinds";
import { blindsInForce, formatClock, type TimerView } from "@/lib/timer";
import type { SnapshotGame, SnapshotTournament } from "@/lib/types";

/**
 * Compact tournament status: level, blinds, ante, time. Grows more prominent
 * under a minute. In casual mode shows static blinds; in "none" mode renders nothing.
 */
export function TournamentBar({
  game,
  tournament,
  view,
  size = "sm",
  className,
}: {
  game: SnapshotGame;
  tournament: SnapshotTournament;
  view: TimerView | null;
  size?: "sm" | "lg";
  className?: string;
}) {
  if (game.timerMode === "none") return null;

  if (game.timerMode === "casual") {
    const sb = game.casual.smallBlind ?? 0;
    const bb = game.casual.bigBlind ?? 0;
    const ante = game.casual.ante ?? 0;
    if (!sb && !bb && !ante) return null;
    return (
      <div className={cn("flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-charcoal-900/60 px-4 py-2", className)}>
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-400">Blinds</span>
        <span className={cn("font-serif text-ivory-50", size === "lg" ? "text-3xl" : "text-lg")}>
          {formatChips(sb)} / {formatChips(bb)}
        </span>
        {ante > 0 ? (
          <span className="text-sm text-gold-300">{game.casual.anteType === "big_blind" ? `BB Ante ${formatChips(ante)}` : `Ante ${formatChips(ante)}`}</span>
        ) : null}
      </div>
    );
  }

  const blinds = blindsInForce(tournament);
  const level = view?.level ?? null;
  const urgent = view?.status === "running" && view.remainingSeconds < 60;
  const isBreak = view?.isBreak ?? false;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-2xl border px-4 py-2 transition-colors",
        isBreak ? "border-gold-400/40 bg-gold-500/10" : "border-white/10 bg-charcoal-900/60",
        urgent && "border-status-warn/60 bg-status-warn/10",
        className,
      )}
      aria-live="polite"
    >
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-400">
          {isBreak ? "Break" : level ? `Level ${view?.levelNumber ?? ""}` : "Clock"}
          {view?.pendingAdvance ? " · complete" : view?.status === "paused" ? " · paused" : view?.status === "expired" ? " · complete" : ""}
        </p>
        <p className={cn("truncate font-serif text-ivory-50", size === "lg" ? "text-3xl" : "text-lg")}>
          {blinds ? levelLabel(blinds) : "No blinds"}
          {blinds && anteLabel(blinds) ? <span className={cn("ml-2 text-gold-300", size === "lg" ? "text-xl" : "text-sm")}>{anteLabel(blinds)}</span> : null}
        </p>
      </div>
      <div className={cn("shrink-0 text-right font-mono tabular-nums", urgent ? "text-status-warn" : "text-ivory-50", size === "lg" ? "text-4xl" : urgent ? "text-2xl" : "text-xl")}>
        {view ? formatClock(view.remainingSeconds) : "--:--"}
      </div>
    </div>
  );
}
