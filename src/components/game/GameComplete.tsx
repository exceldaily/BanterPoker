"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Wordmark } from "@/components/Logo";
import { Button, Card, Eyebrow, cn } from "@/components/ui";
import { api } from "@/lib/api";
import { friendlyMessage } from "@/lib/errors";
import type { GameState } from "@/lib/hooks/useGame";
import { prefs } from "@/lib/storage";

export function GameComplete({ state }: { state: GameState }) {
  const router = useRouter();
  const snap = state.snapshot!;
  const { game, players, me } = snap;
  const [error, setError] = useState<string | null>(null);
  const winner = players.find((p) => p.id === game.winnerPlayerId) ?? null;
  const duration = game.startedAt && game.endedAt ? Math.max(0, Date.parse(game.endedAt) - Date.parse(game.startedAt)) : 0;
  const hours = Math.floor(duration / 3_600_000);
  const minutes = Math.round((duration % 3_600_000) / 60_000);
  const list = players.filter((p) => p.status !== "removed").sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99));

  const pick = async (id: string | null) => {
    setError(null);
    try {
      await state.act(() => api.setWinner(game.id, id));
    } catch (err) {
      setError(friendlyMessage(err));
    }
  };

  return (
    <main className="safe-top safe-bottom safe-x mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 py-8">
      <div className="text-center">
        <Wordmark size="sm" />
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.3em] text-gold-300">Game complete</p>
        <h1 className="mt-2 font-serif text-4xl text-ivory-50">{game.tableName}</h1>
        <p className="mt-3 text-ivory-300">
          {game.handCount} {game.handCount === 1 ? "hand" : "hands"} played
          {duration ? ` · ${hours ? `${hours}h ` : ""}${minutes}m game time` : ""}
        </p>
      </div>

      {winner ? (
        <Card className="text-center">
          <Eyebrow>Winner</Eyebrow>
          <p className="mt-1 font-serif text-3xl text-ivory-50">{winner.name}</p>
        </Card>
      ) : null}

      <Card>
        <Eyebrow className="mb-3">Players</Eyebrow>
        <ul className="flex flex-col gap-2">
          {list.map((p) => (
            <li key={p.id}>
              {me.isHost ? (
                <button
                  type="button"
                  onClick={() => void pick(p.id === game.winnerPlayerId ? null : p.id)}
                  className={cn("flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left", p.id === game.winnerPlayerId ? "border-gold-400 bg-gold-500/15" : "border-white/10")}
                >
                  <span className="text-ivory-100">{p.name}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-500">{p.id === game.winnerPlayerId ? "Winner" : p.status === "eliminated" ? "Out" : ""}</span>
                </button>
              ) : (
                <div className="flex items-center justify-between px-1 py-1">
                  <span className="text-ivory-100">{p.name}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-500">{p.id === game.winnerPlayerId ? "Winner" : p.status === "eliminated" ? "Out" : ""}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
        {me.isHost ? <p className="mt-3 text-xs text-ivory-600">Tap a player to mark the winner. No payouts, no ledger, just bragging rights.</p> : null}
        {error ? <p className="mt-2 text-sm text-status-bad">{error}</p> : null}
      </Card>

      <Button
        size="lg"
        block
        onClick={() => {
          prefs.setCurrentGame(null);
          router.push("/");
        }}
      >
        Back to start
      </Button>
    </main>
  );
}
