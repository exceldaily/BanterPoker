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
import { useFullscreen } from "@/lib/hooks/useFullscreen";
import type { GameState } from "@/lib/hooks/useGame";
import { blindsInForce, formatClock } from "@/lib/timer";

type Drawer = "players" | "tournament" | "devices" | "settings" | "invite" | "events" | null;

/**
 * Dealer dashboard. One unmistakable primary action, everything else tucked
 * away. Phones get a stacked layout; anything laptop-sized or wider fills the
 * whole screen with the clock, a big board and the table side by side, so a
 * tablet or TV in the middle of the table works as the dealer tray.
 */
export function DealerView({ state, onSwitchToPlayer }: { state: GameState; onSwitchToPlayer?: () => void }) {
  const router = useRouter();
  const snap = state.snapshot!;
  const { game, hand, players, tournament, me } = snap;
  const toast = useToast();
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [busy, setBusy] = useState(false);
  const [confirmEndEarly, setConfirmEndEarly] = useState(false);
  const [confirmEndGame, setConfirmEndGame] = useState(false);
  const lastLevel = useRef<string | null>(null);
  const fullscreen = useFullscreen();

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

  // Folds are announced on the dealer device the moment they land.
  const foldedNames = useMemo(
    () => (hand && hand.state !== "complete" ? players.filter((p) => p.handStatus === "folded").map((p) => p.name) : []),
    [players, hand],
  );
  const lastFoldKey = useRef<string>("");
  useEffect(() => {
    const key = `${hand?.id ?? ""}:${foldedNames.join("|")}`;
    if (lastFoldKey.current && lastFoldKey.current.startsWith(`${hand?.id ?? ""}:`) && key !== lastFoldKey.current) {
      const prev = new Set(lastFoldKey.current.split(":")[1]?.split("|").filter(Boolean));
      const fresh = foldedNames.filter((n) => !prev.has(n));
      if (fresh.length > 0) {
        toast.show(`${fresh.join(", ")} folded`);
        if (game.soundsEnabled) playSound("fold");
      }
    }
    lastFoldKey.current = key;
  }, [foldedNames, hand?.id, toast, game.soundsEnabled]);

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
  const urgent = view?.status === "running" && view.remainingSeconds < 60;

  return (
    <main className="safe-top safe-bottom safe-x flex min-h-dvh w-full flex-col gap-3 py-3 lg:h-dvh lg:gap-4 lg:px-8 lg:py-4 2xl:px-14" onPointerDown={unlockAudio}>
      <Toast message={toast.message} tone={toast.tone} />

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Wordmark size="sm" />
          <h1 className="truncate font-serif text-2xl text-ivory-50 lg:text-3xl">{game.tableName}</h1>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ivory-400 lg:text-xs">
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

      {/* Phone: stacked. Laptop/TV/tablet-landscape: clock | board | table, filling the screen. */}
      <section className="flex flex-1 flex-col gap-3 lg:grid lg:min-h-0 lg:grid-cols-[minmax(240px,0.9fr)_minmax(0,1.8fr)_minmax(320px,1.4fr)] lg:items-center lg:gap-8">
        <div className="flex flex-col gap-3">
          {game.timerMode === "tournament" ? (
            <div className={cn("hidden rounded-3xl border p-5 lg:block", view?.isBreak ? "border-gold-400/40 bg-gold-500/10" : "border-white/10 bg-charcoal-900/60", urgent && "border-status-warn/60")}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ivory-400">
                {view?.isBreak ? "Break" : `Level ${view?.levelNumber ?? ""}`}
                {view?.status === "paused" ? " · paused" : view?.pendingAdvance || view?.status === "expired" ? " · complete" : ""}
              </p>
              <p className="font-serif text-4xl text-ivory-50 2xl:text-5xl">{blinds ? levelLabel(blinds) : "No blinds"}</p>
              {blinds && anteLabel(blinds) ? <p className="text-xl text-gold-300">{anteLabel(blinds)}</p> : null}
              <p className={cn("mt-3 font-mono text-6xl tabular-nums 2xl:text-7xl", urgent ? "text-status-warn" : "text-ivory-50")}>{view ? formatClock(view.remainingSeconds) : "--:--"}</p>
              {view?.nextLevel ? (
                <p className="mt-3 text-sm text-ivory-400">
                  Next: {levelLabel(view.nextLevel)}
                  {anteLabel(view.nextLevel) ? ` · ${anteLabel(view.nextLevel)}` : ""}
                </p>
              ) : null}
            </div>
          ) : null}
          <TournamentBar game={game} tournament={tournament} view={view} className={game.timerMode === "tournament" ? "lg:hidden" : ""} size="sm" />
          <HandStatus hand={hand} foldedNames={foldedNames} />
        </div>

        <Board hand={hand} size="auto" className="py-2" />

        <SeatMap maxSeats={game.maxSeats} players={players} hand={hand} dealerSeat={game.dealerSeat} connectedPlayerIds={connectedIds} className="lg:max-w-none" />
      </section>

      {view?.pendingAdvance ? (
        <div className="rounded-2xl border border-gold-400/40 bg-gold-500/10 px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-gold-300">
          Level complete · next level starts when you end this hand
        </div>
      ) : view?.status === "expired" && game.timerMode === "tournament" ? (
        <Button variant="gold" block onClick={() => void run(() => api.timerAction(game.id, "resume"))}>
          Start next level
        </Button>
      ) : null}

      <div className="mt-auto flex flex-col gap-2 lg:mt-0">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
          {primary ? (
            <Button size="xl" variant={primary.variant ?? "primary"} block onClick={primary.onClick} loading={busy} className="lg:flex-[2] lg:text-2xl">
              {primary.label}
            </Button>
          ) : null}
          {secondaryEnd ? (
            <Button variant="ghost" block onClick={() => setConfirmEndEarly(true)} className="lg:flex-1">
              End hand early
            </Button>
          ) : null}
        </div>
        <div className="grid grid-cols-5 gap-2 lg:mx-auto lg:w-full lg:max-w-4xl">
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
          <div className="flex items-center gap-4">
            {fullscreen.supported ? (
              <button type="button" onClick={() => void fullscreen.toggle()}>
                {fullscreen.active ? "Exit full screen" : "Full screen"}
              </button>
            ) : null}
            <button type="button" onClick={() => setDrawer("events")}>
              Log
            </button>
          </div>
          <div className="flex items-center gap-4">
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

function HandStatus({ hand, foldedNames }: { hand: GameState["snapshot"] extends infer S ? (S extends { hand: infer H } ? H : never) : never; foldedNames: string[] }) {
  if (!hand) return null;
  if (hand.state === "complete") {
    return <p className="text-center text-[10px] font-semibold uppercase tracking-[0.25em] text-ivory-400 lg:text-left lg:text-xs">Hand {hand.number} complete · button moves next hand</p>;
  }
  const decided = hand.playersRemaining <= 1;
  return (
    <div className={cn("rounded-2xl border px-4 py-2 text-center lg:py-3", decided ? "border-gold-400/40 bg-gold-500/10" : "border-white/10 bg-charcoal-900/50")}>
      {decided ? (
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-gold-300 lg:text-sm">Hand decided · 1 player remaining</p>
      ) : (
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ivory-300 lg:text-sm">
          {hand.playersRemaining} of {hand.playersDealtIn} in the hand{hand.playersFolded ? ` · ${hand.playersFolded} folded` : ""}
        </p>
      )}
      {foldedNames.length > 0 ? (
        <p className="mt-1 text-sm text-status-bad lg:text-base">
          <span className="font-semibold uppercase tracking-[0.15em]">Folded:</span> {foldedNames.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
