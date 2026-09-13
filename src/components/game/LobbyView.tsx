"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ConnectionDot } from "@/components/ConnectionDot";
import { Wordmark } from "@/components/Logo";
import { SeatMap } from "@/components/SeatMap";
import { Button, Card, Confirm, Eyebrow, Toast, cn, useToast } from "@/components/ui";
import { InviteDrawer, PlayersDrawer, SettingsDrawer, TournamentDrawer, DevicesDrawer } from "@/components/game/drawers";
import { api } from "@/lib/api";
import { friendlyMessage } from "@/lib/errors";
import { unlockAudio } from "@/lib/feedback";
import type { GameState } from "@/lib/hooks/useGame";
import type { SnapshotPlayer } from "@/lib/types";

type Drawer = "invite" | "players" | "tournament" | "settings" | "devices" | null;

export function LobbyView({ state }: { state: GameState }) {
  const router = useRouter();
  const snap = state.snapshot!;
  const { game, players, me } = snap;
  const canControl = !!me.canControl;
  const toast = useToast();
  const [drawer, setDrawer] = useState<Drawer>(canControl && me.role === "dealer" ? "invite" : null);
  const [pendingSeat, setPendingSeat] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);

  const connectedIds = useMemo(() => new Set(state.presence.map((p) => p.playerId).filter((x): x is string => !!x)), [state.presence]);
  const seated = players.filter((p) => p.seat != null && p.status !== "removed");
  const activeSeated = seated.filter((p) => p.status === "active");
  const unseated = players.filter((p) => p.seat == null && p.status !== "removed");
  const isPlayer = !!me.playerId;

  const onSeatTap = (seat: number, occupant: SnapshotPlayer | null) => {
    if (!isPlayer) return;
    if (occupant && occupant.id !== me.playerId) return;
    if (game.seatingLocked && me.status !== "pending") {
      toast.show("Seating is locked.", "error");
      return;
    }
    if (occupant?.id === me.playerId) return;
    setPendingSeat(seat);
  };

  const confirmSeat = async () => {
    if (pendingSeat == null) return;
    setBusy(true);
    try {
      await state.act(() => api.chooseSeat(game.id, pendingSeat));
      setPendingSeat(null);
    } catch (err) {
      toast.show(friendlyMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const startGame = async () => {
    setBusy(true);
    try {
      unlockAudio();
      await state.act(() => api.startGame(game.id));
      setConfirmStart(false);
    } catch (err) {
      toast.show(friendlyMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={cn("safe-top safe-bottom safe-x mx-auto flex min-h-dvh w-full flex-col gap-4 py-4", canControl ? "max-w-2xl lg:max-w-5xl lg:px-8" : "max-w-2xl")}>
      <Toast message={toast.message} tone={toast.tone} />
      <header className="flex items-start justify-between">
        <div>
          <Wordmark size="sm" />
          <h1 className="font-serif text-3xl text-ivory-50">{game.tableName}</h1>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ivory-400">
            Lobby · {seated.length}/{game.maxSeats} seated
            {game.seatingLocked ? " · seating locked" : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ConnectionDot state={state.connection} />
          <RoleChip me={me} />
        </div>
      </header>

      {canControl && snap.control ? (
        <Card className="flex items-center justify-between gap-3 py-4">
          <div>
            <Eyebrow>Table code</Eyebrow>
            <p className="font-mono text-3xl tracking-[0.3em] text-ivory-50">{snap.control.joinCode}</p>
          </div>
          <Button variant="gold" onClick={() => setDrawer("invite")}>
            Invite players
          </Button>
        </Card>
      ) : null}

      {isPlayer ? (
        <p className="text-center text-sm text-ivory-400">
          {me.seat ? (
            <>
              You are <span className="font-semibold text-ivory-50">Seat {me.seat}</span>
              {game.seatingLocked ? "" : ". Tap another open seat to move."}
              {me.status === "pending" ? " · waiting for the host to let you in" : ""}
            </>
          ) : game.seatingLocked && me.status !== "pending" ? (
            "Seating is locked. Ask the host for a seat."
          ) : (
            "Tap an open seat to sit down."
          )}
        </p>
      ) : null}

      <SeatMap
        maxSeats={game.maxSeats}
        players={players}
        hand={null}
        dealerSeat={game.dealerSeat}
        mySeat={me.seat ?? null}
        myPlayerId={me.playerId ?? null}
        connectedPlayerIds={connectedIds}
        onSeatTap={isPlayer && (!game.seatingLocked || me.status === "pending") ? onSeatTap : undefined}
        selectable={isPlayer && (!game.seatingLocked || me.status === "pending")}
        className={canControl ? "lg:max-w-4xl" : undefined}
        center={
          <div className="text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-ivory-400">Waiting for players</p>
            <p className="font-serif text-2xl text-ivory-50">{activeSeated.length} ready</p>
          </div>
        }
      />

      {unseated.length > 0 ? (
        <Card className="py-3">
          <Eyebrow>Not seated yet</Eyebrow>
          <p className="mt-1 text-ivory-200">{unseated.map((p) => p.name).join(", ")}</p>
        </Card>
      ) : null}

      {canControl ? (
        <div className="mt-auto flex flex-col gap-3">
          <div className="grid grid-cols-4 gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDrawer("players")}>
              Players
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDrawer("tournament")}>
              {game.timerMode === "tournament" ? "Blinds" : "Stakes"}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDrawer("devices")}>
              Devices
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDrawer("settings")}>
              Settings
            </Button>
          </div>
          <Button
            variant="secondary"
            block
            onClick={async () => {
              try {
                await state.act(() => api.setSeatingLocked(game.id, !game.seatingLocked));
              } catch (err) {
                toast.show(friendlyMessage(err), "error");
              }
            }}
          >
            {game.seatingLocked ? "Unlock seating" : "Lock seating"}
          </Button>
          <Button size="xl" variant="gold" block disabled={activeSeated.length < 2} onClick={() => setConfirmStart(true)}>
            Start game
          </Button>
          {activeSeated.length < 2 ? <p className="text-center text-xs text-ivory-600">Need at least two seated players.</p> : null}
        </div>
      ) : (
        <div className="mt-auto flex flex-col items-center gap-3">
          <p className="pulse-soft text-[10px] font-semibold uppercase tracking-[0.3em] text-ivory-400">Waiting for the host to start</p>
          <button
            type="button"
            className="text-xs text-ivory-600 underline"
            onClick={async () => {
              try {
                await api.leaveGame(game.id);
              } catch {
                // ignore
              }
              router.push("/");
            }}
          >
            Leave table
          </button>
        </div>
      )}

      <Confirm
        open={pendingSeat != null}
        title={`Take seat ${pendingSeat ?? ""}?`}
        body={<p>Match the seat number to where you are actually sitting at the table.</p>}
        confirmLabel="Confirm seat"
        onConfirm={() => void confirmSeat()}
        onCancel={() => setPendingSeat(null)}
        busy={busy}
      />
      <Confirm
        open={confirmStart}
        title="Start the game?"
        body={
          <p>
            {activeSeated.length} players are seated. Seating locks when the game starts
            {game.allowLateEntry ? ", but late players can still ask for a seat." : "."}
          </p>
        }
        confirmLabel="Start game"
        onConfirm={() => void startGame()}
        onCancel={() => setConfirmStart(false)}
        busy={busy}
      />

      <InviteDrawer open={drawer === "invite"} onClose={() => setDrawer(null)} state={state} />
      <PlayersDrawer open={drawer === "players"} onClose={() => setDrawer(null)} state={state} />
      <TournamentDrawer open={drawer === "tournament"} onClose={() => setDrawer(null)} state={state} />
      <DevicesDrawer open={drawer === "devices"} onClose={() => setDrawer(null)} state={state} />
      <SettingsDrawer open={drawer === "settings"} onClose={() => setDrawer(null)} state={state} />
    </main>
  );
}

export function RoleChip({ me, className }: { me: GameState["snapshot"] extends infer S ? (S extends { me: infer M } ? M : never) : never; className?: string }) {
  const parts: string[] = [];
  if (me.isHost) parts.push("Host");
  if (me.role === "dealer") parts.push("Dealer");
  else if (me.role === "player") parts.push(me.canControl && !me.isHost ? "Dealer" : "Player");
  return <span className={cn("rounded-full border border-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-ivory-400", className)}>{parts.join(" · ")}</span>;
}
