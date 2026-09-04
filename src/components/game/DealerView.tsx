"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Board } from "@/components/Board";
import { ConnectionDot } from "@/components/ConnectionDot";
import { Wordmark } from "@/components/Logo";
import { SeatMap } from "@/components/SeatMap";
import { TournamentBar } from "@/components/TournamentBar";
import { Button, Confirm, Toast, cn, useToast } from "@/components/ui";
import { DevicesDrawer, EventsDrawer, InviteDrawer, PlayersDrawer, SettingsDrawer, TournamentDrawer } from "@/components/game/drawers";
import { RoleChip } from "@/components/game/LobbyView";
import { api } from "@/lib/api";
import { anteLabel, levelLabel } from "@/lib/blinds";
import { friendlyMessage } from "@/lib/errors";
import { haptic, playSound, unlockAudio } from "@/lib/feedback";
import { useCountdown } from "@/lib/hooks/useCountdown";
import type { GameState } from "@/lib/hooks/useGame";
import { prefs, useStored } from "@/lib/storage";
import { blindsInForce, formatClock } from "@/lib/timer";

type Drawer = "players" | "tournament" | "devices" | "settings" | "invite" | "events" | null;

/** Dealer dashboard: one unmistakable primary action, everything else tucked away. */
export function DealerView({ state, onSwitchToPlayer }: { state: GameState; onSwitchToPlayer?: () => void }) {
  const router = useRouter();
  const snap = state.snapshot!;
  const { game, hand, players, tournament, me } = snap;
  const toast = useToast();
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [busy, setBusy] = useState(false);
  const [confirmEndEarly, setConfirmEndEarly] = useState(false);
  const [confirmEndGame, setConfirmEndGame] = useState(false);
  const storedTabletop = useStored(prefs.getTabletopMode, false);
  const [tabletopChoice, setTabletop] = useState<boolean | null>(null);
  const tabletop = tabletopChoice ?? storedTabletop;
  const lastLevel = useRef<string | null>(null);

  const connectedIds = useMemo(() => new Set(state.presence.map((p) => p.playerId).filter((x): x is string => !!x)), [state.presence]);
  const hostPresent = state.presence.some((p) => p.isHost) || !!me.isHost;

  const onExpire = useCallback(() => {
    void api.syncTimer(game.id).then(() => state.refresh()).catch(() => undefined);
  }, [game.id, state]);
  const view = useCountdown(tournament, { onExpire });

  useEffect(() => {
    const cur = tournament.currentLevelId;
    if (lastLevel.current && cur && lastLevel.current !== cur) {
      const level = tournament.levels.find((l) => l.id === cur);
      if (game.soundsEnabled) playSound(level?.type === "break" ? "break" : "level");
      if (game.hapticsEnabled && game.timerAlertsEnabled) haptic("level");
    }
    lastLevel.current = cur;
  }, [tournament.currentLevelId, tournament.levels, game.soundsEnabled, game.hapticsEnabled, game.timerAlertsEnabled]);

  const run = async (fn: () => Promise<unknown>, sound?: Parameters<typeof playSound>[0]) => {
    if (busy) return;
    setBusy(true);
    try {
      unlockAudio();
      await state.act(fn);
      if (sound && game.soundsEnabled) playSound(sound);
      if (game.hapticsEnabled) haptic("tap");
    } catch (err) {
      toast.show(friendlyMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const activeCount = players.filter((p) => p.status === "active" && p.seat != null).length;
  const handOpen = !!hand && hand.state !== "complete";
  const oneLeft = handOpen && hand.playersRemaining <= 1;
  const blinds = blindsInForce(tournament);

  let primary: { label: string; onClick: () => void; variant?: "primary" | "gold" | "danger" } | null = null;
  if (!handOpen) {
    primary = { label: hand ? "Next hand" : "Start hand", onClick: () => void run(() => api.startHand(game.id), "deal"), variant: "gold" };
  } else if (oneLeft) {
    primary = { label: "End hand", onClick: () => void run(() => api.endHand(game.id)) };
  } else if (hand.state === "pre_flop") {
    primary = { label: "Deal flop", onClick: () => void run(() => api.dealFlop(game.id), "flop") };
  } else if (hand.state === "flop") {
    primary = { label: "Deal turn", onClick: () => void run(() => api.dealTurn(game.id), "turn") };
  } else if (hand.state === "turn") {
    primary = { label: "Deal river", onClick: () => void run(() => api.dealRiver(game.id), "river") };
  } else if (hand.state === "river") {
    primary = { label: "End hand", onClick: () => void run(() => api.endHand(game.id)) };
  }

  const secondaryEnd = handOpen && hand.state !== "river" && !oneLeft;

  const endHandEarly = () => {
    setConfirmEndEarly(false);
    void run(() => api.endHand(game.id));
  };

  const pendingCount = players.filter((p) => p.status === "pending").length;

  return (
    <main className={cn("safe-top safe-bottom safe-x mx-auto flex min-h-dvh w-full flex-col gap-3 py-3", tabletop ? "max-w-6xl" : "max-w-2xl")} onPointerDown={unlockAudio}>
      <Toast message={toast.message} tone={toast.tone} />

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Wordmark size="sm" />
          <h1 className="truncate font-serif text-2xl text-ivory-50">{game.tableName}</h1>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ivory-400">
            {hand ? `Hand ${hand.number}` : "No hand yet"} · Button seat {game.dealerSeat ?? "–"} · {activeCount} active
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ConnectionDot state={state.connection} showLabel />
          <RoleChip me={me} />
        </div>
      </header>

      {!hostPresent ? (
        <div className="rounded-2xl border border-status-warn/40 bg-status-warn/10 px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-status-warn">
          Host device disconnected
        </div>
      ) : null}
      {pendingCount > 0 ? (
        <button type="button" onClick={() => setDrawer("players")} className="rounded-2xl border border-gold-400/40 bg-gold-500/10 px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-gold-300">
          {pendingCount} late {pendingCount === 1 ? "player" : "players"} waiting for approval
        </button>
      ) : null}

      {tabletop ? (
        <section className="grid flex-1 grid-cols-1 items-center gap-4 lg:grid-cols-[1fr_1.2fr_1fr]">
          <div className="flex flex-col gap-3">
            {game.timerMode === "tournament" ? (
              <div className="rounded-3xl border border-white/10 bg-charcoal-900/60 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-ivory-400">{view?.isBreak ? "Break" : `Level ${view?.levelNumber ?? ""}`}</p>
                <p className="font-serif text-3xl text-ivory-50">{blinds ? levelLabel(blinds) : "No blinds"}</p>
                {blinds && anteLabel(blinds) ? <p className="text-gold-300">{anteLabel(blinds)}</p> : null}
                <p className={cn("mt-2 font-mono text-5xl tabular-nums", view && view.status === "running" && view.remainingSeconds < 60 ? "text-status-warn" : "text-ivory-50")}>
                  {view ? formatClock(view.remainingSeconds) : "--:--"}
                </p>
              </div>
            ) : (
              <TournamentBar game={game} tournament={tournament} view={view} size="lg" />
            )}
            <HandStatus hand={hand} />
          </div>
          <Board hand={hand} size="xl" />
          <SeatMap maxSeats={game.maxSeats} players={players} hand={hand} dealerSeat={game.dealerSeat} connectedPlayerIds={connectedIds} compact />
        </section>
      ) : (
        <>
          <TournamentBar game={game} tournament={tournament} view={view} />
          <Board hand={hand} size="md" className="py-2" />
          <HandStatus hand={hand} />
          <SeatMap maxSeats={game.maxSeats} players={players} hand={hand} dealerSeat={game.dealerSeat} connectedPlayerIds={connectedIds} compact />
        </>
      )}

      {view?.pendingAdvance ? (
        <div className="rounded-2xl border border-gold-400/40 bg-gold-500/10 px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-gold-300">
          Level complete · next level starts when you end this hand
        </div>
      ) : view?.status === "expired" && game.timerMode === "tournament" ? (
        <Button variant="gold" block onClick={() => void run(() => api.timerAction(game.id, "resume"))}>
          Start next level
        </Button>
      ) : null}

      <div className="mt-auto flex flex-col gap-2">
        {primary ? (
          <Button size="xl" variant={primary.variant ?? "primary"} block onClick={primary.onClick} loading={busy}>
            {primary.label}
          </Button>
        ) : null}
        {secondaryEnd ? (
          <Button variant="ghost" block onClick={() => setConfirmEndEarly(true)}>
            End hand early
          </Button>
        ) : null}
        <div className="grid grid-cols-5 gap-2">
          <Button variant="secondary" size="sm" onClick={() => setDrawer("players")}>
            Players
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDrawer("tournament")}>
            Clock
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDrawer("invite")}>
            Display
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDrawer("devices")}>
            Devices
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDrawer("settings")}>
            More
          </Button>
        </div>
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-600">
          <button
            type="button"
            onClick={() => {
              const v = !tabletop;
              setTabletop(v);
              prefs.setTabletopMode(v);
            }}
          >
            {tabletop ? "Compact layout" : "Tabletop layout"}
          </button>
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => setDrawer("events")}>
              Log
            </button>
            {onSwitchToPlayer ? (
              <button type="button" onClick={onSwitchToPlayer} className="text-gold-300">
                My cards
              </button>
            ) : null}
            {me.isHost ? (
              <button type="button" onClick={() => setConfirmEndGame(true)} className="text-status-bad">
                End game
              </button>
            ) : (
              <button type="button" onClick={() => router.push("/")}>
                Home
              </button>
            )}
          </div>
        </div>
      </div>

      <Confirm
        open={confirmEndEarly}
        title="End this hand?"
        body={<p>End this hand without dealing the remaining community cards? Unused cards stay hidden.</p>}
        confirmLabel="End hand"
        onConfirm={endHandEarly}
        onCancel={() => setConfirmEndEarly(false)}
      />
      <Confirm
        open={confirmEndGame}
        title="End the game?"
        body={<p>This closes the table for everyone. You can pick a winner on the final screen.</p>}
        confirmLabel="End game"
        danger
        onConfirm={() => {
          setConfirmEndGame(false);
          void run(() => api.endGame(game.id));
        }}
        onCancel={() => setConfirmEndGame(false)}
      />

      <PlayersDrawer open={drawer === "players"} onClose={() => setDrawer(null)} state={state} />
      <TournamentDrawer open={drawer === "tournament"} onClose={() => setDrawer(null)} state={state} />
      <InviteDrawer open={drawer === "invite"} onClose={() => setDrawer(null)} state={state} />
      <DevicesDrawer open={drawer === "devices"} onClose={() => setDrawer(null)} state={state} />
      <SettingsDrawer open={drawer === "settings"} onClose={() => setDrawer(null)} state={state} />
      <EventsDrawer open={drawer === "events"} onClose={() => setDrawer(null)} state={state} />
    </main>
  );
}

function HandStatus({ hand }: { hand: GameState["snapshot"] extends infer S ? (S extends { hand: infer H } ? H : never) : never }) {
  if (!hand) return null;
  if (hand.state === "complete") {
    return <p className="text-center text-[10px] font-semibold uppercase tracking-[0.25em] text-ivory-400">Hand {hand.number} complete · button moves next hand</p>;
  }
  const decided = hand.playersRemaining <= 1;
  return (
    <div className={cn("rounded-2xl border px-4 py-2 text-center", decided ? "border-gold-400/40 bg-gold-500/10" : "border-white/10 bg-charcoal-900/50")}>
      {decided ? (
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-gold-300">Hand decided · 1 player remaining</p>
      ) : (
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ivory-300">
          {hand.playersRemaining} of {hand.playersDealtIn} in the hand{hand.playersFolded ? ` · ${hand.playersFolded} folded` : ""}
        </p>
      )}
    </div>
  );
}
