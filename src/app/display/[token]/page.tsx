"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { Board } from "@/components/Board";
import { ConnectionDot } from "@/components/ConnectionDot";
import { Wordmark } from "@/components/Logo";
import { SeatMap } from "@/components/SeatMap";
import { TournamentBar } from "@/components/TournamentBar";
import { Spinner, cn } from "@/components/ui";
import { api } from "@/lib/api";
import { anteLabel, levelLabel } from "@/lib/blinds";
import { friendlyMessage } from "@/lib/errors";
import { useCountdown } from "@/lib/hooks/useCountdown";
import { useWakeLock } from "@/lib/hooks/useWakeLock";
import { subscribeGame, type ConnectionState } from "@/lib/realtime";
import { blindsInForce, formatClock } from "@/lib/timer";
import type { PublicSnapshot } from "@/lib/types";

// TABLE DISPLAY MODE: read-only, never shows private cards (the snapshot it
// receives is the public one; the token grants nothing else).

export default function DisplayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [snap, setSnap] = useState<PublicSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("reconnecting");
  const snapRef = useRef<PublicSnapshot | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.displaySnapshot(token);
      if (!snapRef.current || s.game.version >= snapRef.current.game.version) {
        snapRef.current = s;
        setSnap(s);
      }
      setError(null);
    } catch (err) {
      setError(friendlyMessage(err));
    }
  }, [token]);

  useEffect(() => {
    const kick = window.setTimeout(() => void refresh(), 0);
    const poll = window.setInterval(() => void refresh(), 15_000);
    return () => {
      window.clearTimeout(kick);
      window.clearInterval(poll);
    };
  }, [refresh]);

  useEffect(() => {
    const gameId = snap?.game.id;
    if (!gameId) return;
    const sub = subscribeGame(gameId, {
      onSnapshot: (pub) => {
        if (!snapRef.current || pub.game.version > snapRef.current.game.version) {
          snapRef.current = pub;
          setSnap(pub);
        }
      },
      onPresence: () => undefined,
      onState: (s) => {
        setConnection(s);
        if (s === "connected") void refresh();
      },
    });
    void sub.track({ deviceId: `display-${token.slice(0, 6)}`, role: "display", at: Date.now() });
    return () => sub.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap?.game.id]);

  useWakeLock(!!snap && snap.game.status !== "complete");
  const view = useCountdown(snap?.tournament ?? null, { onExpire: () => void refresh() });

  if (error && !snap) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <Wordmark />
        <p className="text-status-bad">{error}</p>
      </main>
    );
  }
  if (!snap) return <Spinner label="Connecting to table" />;

  const { game, hand, players, tournament } = snap;
  const blinds = blindsInForce(tournament);
  const isBreak = view?.isBreak ?? false;
  const urgent = view?.status === "running" && view.remainingSeconds < 60;
  const winner = game.winnerPlayerId ? players.find((p) => p.id === game.winnerPlayerId) : null;

  return (
    <main className="safe-top safe-bottom safe-x flex min-h-dvh flex-col gap-4 lg:gap-6">
      <header className="flex items-center justify-between">
        <div>
          <Wordmark size="sm" />
          <p className="font-serif text-2xl text-ivory-50 lg:text-3xl">{game.tableName}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-ivory-400">{hand ? `Hand ${hand.number}` : game.status === "lobby" ? "Lobby" : "Between hands"}</p>
          <ConnectionDot state={connection} showLabel />
        </div>
      </header>

      {game.status === "complete" ? (
        <section className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold-300">Game complete</p>
          <p className="font-serif text-5xl text-ivory-50">{game.handCount} hands played</p>
          {winner ? <p className="text-2xl text-ivory-200">Winner: {winner.name}</p> : null}
        </section>
      ) : (
        <>
          {game.timerMode === "tournament" ? (
            <section className={cn("grid grid-cols-1 items-center gap-4 rounded-3xl border p-5 lg:grid-cols-3", isBreak ? "border-gold-400/40 bg-gold-500/10" : "border-white/10 bg-charcoal-900/60", urgent && "border-status-warn/60")}>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ivory-400">{isBreak ? "Break" : `Level ${view?.levelNumber ?? ""}`}</p>
                <p className="font-serif text-4xl text-ivory-50 lg:text-5xl">{blinds ? levelLabel(blinds) : "No blinds"}</p>
                {blinds && anteLabel(blinds) ? <p className="text-xl text-gold-300">{anteLabel(blinds)}</p> : null}
              </div>
              <div className={cn("text-center font-mono text-6xl tabular-nums lg:text-8xl", urgent ? "text-status-warn" : "text-ivory-50")}>
                {view ? formatClock(view.remainingSeconds) : "--:--"}
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-ivory-400">
                  {view?.status === "paused" ? "Paused" : view?.pendingAdvance ? "Level complete · finishing hand" : view?.status === "expired" ? "Level complete" : isBreak ? "Play resumes in" : "Time remaining"}
                </p>
              </div>
              <div className="lg:text-right">
                {view?.nextLevel ? (
                  <>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ivory-400">Next</p>
                    <p className="font-serif text-2xl text-ivory-200">{levelLabel(view.nextLevel)}</p>
                    {anteLabel(view.nextLevel) ? <p className="text-ivory-400">{anteLabel(view.nextLevel)}</p> : null}
                  </>
                ) : null}
              </div>
            </section>
          ) : (
            <TournamentBar game={game} tournament={tournament} view={view} size="lg" />
          )}

          <section className="grid flex-1 grid-cols-1 items-center gap-6 lg:grid-cols-[1.2fr_1fr]">
            <div className="flex flex-col items-center gap-4">
              <Board hand={hand} size="xl" />
              {hand && hand.state !== "complete" ? (
                <p className="text-sm text-ivory-400">
                  {hand.playersRemaining} of {hand.playersDealtIn} still in the hand
                  {hand.playersRemaining === 1 ? " · hand decided" : ""}
                </p>
              ) : null}
            </div>
            <SeatMap maxSeats={game.maxSeats} players={players} hand={hand} dealerSeat={game.dealerSeat} />
          </section>
        </>
      )}
    </main>
  );
}
