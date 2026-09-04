"use client";

import { useEffect, useState } from "react";
import { QrCode, siteUrl } from "@/components/QrCode";
import { StructureEditor } from "@/components/StructureEditor";
import { Button, Confirm, Eyebrow, Field, Modal, NumberInput, Segmented, Toggle, cn } from "@/components/ui";
import { api } from "@/lib/api";
import { anteLabel, appendDoubledLevel, doubleBlindsFrom, formatChips, formatDuration, levelLabel } from "@/lib/blinds";
import { friendlyMessage } from "@/lib/errors";
import { useCountdown } from "@/lib/hooks/useCountdown";
import type { GameState } from "@/lib/hooks/useGame";
import { formatClock } from "@/lib/timer";
import type { GameEvent, LevelInput, SnapshotDevice, SnapshotLevel, SnapshotPlayer } from "@/lib/types";

// Secondary dealer/host surfaces. Each is a modal so the primary dealer
// screen stays uncluttered. Confirmations only for destructive actions.

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  state: GameState;
}

function useAction(state: GameState) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await state.act(fn);
      return true;
    } catch (err) {
      setError(friendlyMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

/** Snapshot levels -> editable level inputs (drops ids and sort order). */
function toInputs(levels: SnapshotLevel[]): LevelInput[] {
  return levels.map((l) => ({ type: l.type, smallBlind: l.smallBlind, bigBlind: l.bigBlind, ante: l.ante, anteType: l.anteType, durationSeconds: l.durationSeconds }));
}

// -----------------------------------------------------------------------------
// Invite / display
// -----------------------------------------------------------------------------

export function InviteDrawer({ open, onClose, state }: DrawerProps) {
  const snap = state.snapshot!;
  const control = snap.control;
  const [tab, setTab] = useState<"players" | "display" | "dealer">("players");
  const { busy, error, run } = useAction(state);
  const [copied, setCopied] = useState<string | null>(null);
  if (!control) return null;
  const base = siteUrl();
  const joinUrl = `${base}/join/${control.joinCode}`;
  const displayUrl = `${base}/display/${control.displayToken}`;
  const pairUrl = control.dealerPairingCode ? `${base}/pair/${control.dealerPairingCode}` : null;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Invite">
      <div className="flex flex-col items-center gap-4">
        <Segmented
          size="sm"
          value={tab}
          options={[
            { value: "players", label: "Players" },
            { value: "display", label: "Display" },
            { value: "dealer", label: "Dealer" },
          ]}
          onChange={setTab}
        />
        {tab === "players" ? (
          <>
            <QrCode value={joinUrl} size={220} label="Scan to join" />
            <p className="font-mono text-4xl tracking-[0.3em] text-ivory-50">{control.joinCode}</p>
            <p className="text-center text-sm text-ivory-400">Hold phones together and scan, or share the code.</p>
            <Button variant="secondary" block onClick={() => void copy(joinUrl, "join")}>
              {copied === "join" ? "Copied" : "Copy join link"}
            </Button>
          </>
        ) : null}
        {tab === "display" ? (
          <>
            <QrCode value={displayUrl} size={200} label="Table display" />
            <p className="text-center text-sm text-ivory-400">Read-only board, blinds and clock for a tablet or TV. It never shows cards.</p>
            <div className="flex w-full gap-2">
              <Button variant="secondary" block onClick={() => void copy(displayUrl, "display")}>
                {copied === "display" ? "Copied" : "Copy display link"}
              </Button>
              <Button variant="ghost" onClick={() => window.open(displayUrl, "_blank", "noopener")}>
                Open
              </Button>
            </div>
          </>
        ) : null}
        {tab === "dealer" ? (
          <>
            {snap.me.isHost ? (
              <>
                {pairUrl && control.dealerPairingCode ? (
                  <>
                    <QrCode value={pairUrl} size={200} label="Dealer pairing" />
                    <p className="font-mono text-3xl tracking-[0.3em] text-gold-300">{control.dealerPairingCode}</p>
                    <p className="text-center text-sm text-ivory-400">Open Banter Poker on the dealer device, choose Pair as dealer device, and enter this code. Expires in 15 minutes.</p>
                  </>
                ) : (
                  <p className="text-center text-sm text-ivory-400">A dealer device controls the table but never receives a hand. Only the host can authorize one.</p>
                )}
                <Button variant="gold" block loading={busy} onClick={() => void run(() => api.createDealerPairing(snap.game.id))}>
                  {control.dealerPairingCode ? "New dealer code" : "Add dealer device"}
                </Button>
              </>
            ) : (
              <p className="text-center text-sm text-ivory-400">Only the host can add dealer devices.</p>
            )}
          </>
        ) : null}
        {error ? <p className="text-sm text-status-bad">{error}</p> : null}
      </div>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Players
// -----------------------------------------------------------------------------

const STATUS_LABEL: Record<SnapshotPlayer["status"], string> = {
  active: "Active",
  sitting_out: "Sitting out",
  eliminated: "Out",
  pending: "Waiting",
  removed: "Removed",
};

export function PlayersDrawer({ open, onClose, state }: DrawerProps) {
  const snap = state.snapshot!;
  const { game, players, hand, me } = snap;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Always the live row for the selected player (or null once they are gone).
  const selected: SnapshotPlayer | null = selectedId ? (players.find((p) => p.id === selectedId) ?? null) : null;
  const setSelected = (p: SnapshotPlayer | null) => setSelectedId(p?.id ?? null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; label: string; danger?: boolean; action: () => Promise<unknown> } | null>(null);
  const [moveSeat, setMoveSeat] = useState<number | null>(null);
  const { busy, error, run, setError } = useAction(state);
  const handOpen = !!hand && hand.state !== "complete";
  const devices = snap.control?.devices ?? [];

  const list = players.filter((p) => p.status !== "removed").sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99));
  const takenSeats = new Set(list.map((p) => p.seat).filter((s): s is number => s != null));

  const act = async (fn: () => Promise<unknown>) => {
    const ok = await run(fn);
    if (ok) {
      setConfirm(null);
      setSelected(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Players">
      {!selected ? (
        <ul className="flex max-h-[60vh] flex-col gap-2 overflow-auto scrollbar-thin">
          {list.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setSelected(p);
                }}
                className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-charcoal-800/60 px-4 py-3 text-left"
              >
                <span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-400">{p.seat ? `Seat ${p.seat}` : "No seat"}</span>
                  <span className="block font-medium text-ivory-50">
                    {p.name}
                    {p.isHost ? <span className="ml-2 text-[9px] font-bold uppercase tracking-[0.2em] text-gold-300">Host</span> : null}
                  </span>
                </span>
                <span className={cn("text-[10px] font-bold uppercase tracking-[0.2em]", p.status === "active" ? "text-status-ok" : p.status === "pending" ? "text-gold-300" : "text-ivory-500")}>
                  {handOpen && p.handStatus === "folded" ? "Folded" : STATUS_LABEL[p.status]}
                </span>
              </button>
            </li>
          ))}
          {list.length === 0 ? <li className="text-center text-sm text-ivory-600">Nobody has joined yet.</li> : null}
        </ul>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="mb-2">
            <Eyebrow>{selected.seat ? `Seat ${selected.seat}` : "No seat"} · {STATUS_LABEL[selected.status]}</Eyebrow>
            <p className="font-serif text-2xl text-ivory-50">{selected.name}</p>
          </div>
          {selected.status === "pending" ? (
            <Button variant="gold" block disabled={selected.seat == null} onClick={() => void act(() => api.setPlayerStatus(game.id, selected.id, "active"))}>
              Approve late entry
            </Button>
          ) : null}
          {selected.status !== "active" && selected.status !== "pending" ? (
            <Button block disabled={selected.seat == null} onClick={() => void act(() => api.setPlayerStatus(game.id, selected.id, "active"))}>
              {selected.status === "eliminated" ? "Restore player" : "Mark active"}
            </Button>
          ) : null}
          {selected.status === "active" ? (
            <Button variant="secondary" block onClick={() => void act(() => api.setPlayerStatus(game.id, selected.id, "sitting_out"))}>
              Sit out
            </Button>
          ) : null}
          {selected.status !== "eliminated" ? (
            <Button
              variant="secondary"
              block
              onClick={() =>
                setConfirm({
                  title: `Eliminate ${selected.name}?`,
                  body: "They stay at the table but receive no more cards. You can restore them later.",
                  label: "Mark eliminated",
                  danger: true,
                  action: () => api.setPlayerStatus(game.id, selected.id, "eliminated"),
                })
              }
            >
              Eliminate
            </Button>
          ) : null}
          {handOpen && selected.handStatus && selected.handStatus !== "folded" ? (
            <Button
              variant="secondary"
              block
              onClick={() =>
                setConfirm({
                  title: `Mark ${selected.name} as folded?`,
                  body: "Use this only when their phone died or they folded verbally. Their cards stay private.",
                  label: "Mark folded",
                  action: () => api.dealerMarkFolded(game.id, selected.id),
                })
              }
            >
              Mark folded
            </Button>
          ) : null}
          {!handOpen ? (
            <div className="rounded-2xl border border-white/10 p-3">
              <Eyebrow className="mb-2">Move seat</Eyebrow>
              <div className="grid grid-cols-6 gap-1.5">
                {Array.from({ length: game.maxSeats }, (_, i) => i + 1).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setMoveSeat(s)}
                    className={cn(
                      "h-10 rounded-lg border text-sm font-semibold",
                      moveSeat === s ? "border-gold-400 bg-gold-500/20 text-ivory-50" : takenSeats.has(s) ? "border-white/5 text-ivory-600" : "border-white/10 text-ivory-200",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
              {moveSeat != null && moveSeat !== selected.seat ? (
                <Button size="sm" block className="mt-2" loading={busy} onClick={() => void act(() => api.movePlayerSeat(game.id, selected.id, moveSeat))}>
                  Move to seat {moveSeat}
                  {takenSeats.has(moveSeat) ? " (swap)" : ""}
                </Button>
              ) : null}
            </div>
          ) : null}
          {!handOpen && selected.status === "active" && selected.seat != null && selected.seat !== game.dealerSeat ? (
            <Button variant="ghost" block onClick={() => void act(() => api.setDealerSeat(game.id, selected.seat!))}>
              Give the button to seat {selected.seat}
            </Button>
          ) : null}
          {me.isHost && !selected.isHost ? (
            <Button
              variant="ghost"
              block
              onClick={() => {
                const dev = devices.find((d) => d.playerId === selected.id);
                if (!dev) {
                  setError("This player has no connected device to transfer to.");
                  return;
                }
                setConfirm({
                  title: `Make ${selected.name} the host?`,
                  body: "They get full host controls. You keep playing as a normal player.",
                  label: "Transfer host",
                  danger: true,
                  action: () => api.transferHost(game.id, dev.deviceId),
                });
              }}
            >
              Transfer host
            </Button>
          ) : null}
          {!selected.isHost ? (
            <Button
              variant="ghost"
              block
              className="text-status-bad"
              onClick={() =>
                setConfirm({
                  title: `Remove ${selected.name} from the table?`,
                  body: "Their seat opens up and their phone is disconnected.",
                  label: "Remove",
                  danger: true,
                  action: () => api.setPlayerStatus(game.id, selected.id, "removed"),
                })
              }
            >
              Remove from table
            </Button>
          ) : null}
          {error ? <p className="text-sm text-status-bad">{error}</p> : null}
          <Button variant="ghost" block onClick={() => setSelected(null)}>
            Back
          </Button>
        </div>
      )}
      <Confirm
        open={!!confirm}
        title={confirm?.title ?? ""}
        body={<p>{confirm?.body}</p>}
        confirmLabel={confirm?.label}
        danger={confirm?.danger}
        busy={busy}
        onConfirm={() => confirm && void act(confirm.action)}
        onCancel={() => setConfirm(null)}
      />
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Tournament clock
// -----------------------------------------------------------------------------

export function TournamentDrawer({ open, onClose, state }: DrawerProps) {
  const snap = state.snapshot!;
  const { game, tournament } = snap;
  const { busy, error, run } = useAction(state);
  const view = useCountdown(tournament);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<LevelInput[]>([]);
  const [confirm, setConfirm] = useState<{ title: string; action: () => Promise<unknown> } | null>(null);
  const [casual, setCasual] = useState({ sb: game.casual.smallBlind ?? 0, bb: game.casual.bigBlind ?? 0, ante: game.casual.ante ?? 0, anteType: game.casual.anteType });

  const startEdit = () => {
    setDraft(toInputs(tournament.levels));
    setEditing(true);
  };
  const timer = (action: Parameters<typeof api.timerAction>[1], arg?: number) => void run(() => api.timerAction(game.id, action, arg));

  if (game.timerMode === "casual") {
    return (
      <Modal open={open} onClose={onClose} title="Stakes">
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="gold"
            className="col-span-2"
            loading={busy}
            onClick={() => {
              const sb = Math.max(1, (game.casual.smallBlind ?? casual.sb) * 2);
              const bb = Math.max(sb, (game.casual.bigBlind ?? casual.bb) * 2);
              const anteType = game.casual.anteType;
              const ante = anteType === "big_blind" ? bb : (game.casual.ante ?? 0) * 2;
              setCasual({ sb, bb, ante, anteType });
              void run(() => api.updateSettings(game.id, { casualSmallBlind: sb, casualBigBlind: bb, casualAnte: ante, casualAnteType: anteType }));
            }}
          >
            Double the blinds now
          </Button>
          <NumberInput label="Small blind" value={casual.sb} onChange={(v) => setCasual({ ...casual, sb: v })} />
          <NumberInput label="Big blind" value={casual.bb} onChange={(v) => setCasual({ ...casual, bb: v, ante: casual.anteType === "big_blind" ? v : casual.ante })} />
          <div className="col-span-2">
            <Segmented
              size="sm"
              value={casual.anteType}
              options={[
                { value: "none", label: "No ante" },
                { value: "big_blind", label: "BB ante" },
                { value: "standard", label: "Everyone" },
              ]}
              onChange={(v) => setCasual({ ...casual, anteType: v, ante: v === "none" ? 0 : v === "big_blind" ? casual.bb : casual.ante || 1 })}
            />
          </div>
          {casual.anteType === "standard" ? <NumberInput label="Ante" value={casual.ante} onChange={(v) => setCasual({ ...casual, ante: v })} /> : null}
          <Button
            block
            variant="secondary"
            className="col-span-2"
            loading={busy}
            onClick={() =>
              void run(() => api.updateSettings(game.id, { casualSmallBlind: casual.sb, casualBigBlind: casual.bb, casualAnte: casual.ante, casualAnteType: casual.anteType })).then((ok) => ok && onClose())
            }
          >
            Save stakes
          </Button>
        </div>
        {error ? <p className="mt-2 text-sm text-status-bad">{error}</p> : null}
      </Modal>
    );
  }

  if (game.timerMode !== "tournament") {
    return (
      <Modal open={open} onClose={onClose} title="Clock">
        <p className="text-ivory-400">This table runs without blinds or a clock.</p>
      </Modal>
    );
  }

  const current = view?.level ?? null;
  const next = view?.nextLevel ?? null;

  return (
    <Modal open={open} onClose={onClose} title="Tournament">
      {editing ? (
        <div className="flex max-h-[65vh] flex-col gap-3 overflow-auto scrollbar-thin pr-1">
          <StructureEditor levels={draft} onChange={setDraft} compact />
          <div className="flex gap-2">
            <Button block loading={busy} onClick={() => void run(() => api.replaceLevels(game.id, draft)).then((ok) => ok && setEditing(false))}>
              Save structure
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          {error ? <p className="text-sm text-status-bad">{error}</p> : null}
        </div>
      ) : (
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-auto scrollbar-thin pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/10 bg-charcoal-800/60 p-3">
              <Eyebrow>{view?.isBreak ? "Break" : `Level ${view?.levelNumber ?? "–"}`}</Eyebrow>
              <p className="font-serif text-2xl text-ivory-50">{current ? levelLabel(current) : "–"}</p>
              {current && anteLabel(current) ? <p className="text-sm text-gold-300">{anteLabel(current)}</p> : null}
              <p className={cn("mt-1 font-mono text-3xl tabular-nums", view?.status === "paused" ? "text-ivory-400" : "text-ivory-50")}>{view ? formatClock(view.remainingSeconds) : "--:--"}</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-400">
                {view?.status === "paused" ? "Paused" : view?.status === "expired" ? "Complete" : view?.pendingAdvance ? "Complete · after hand" : "Running"}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-charcoal-800/40 p-3">
              <Eyebrow>Next</Eyebrow>
              {next ? (
                <>
                  <p className="font-serif text-2xl text-ivory-200">{levelLabel(next)}</p>
                  {anteLabel(next) ? <p className="text-sm text-ivory-400">{anteLabel(next)}</p> : null}
                  <p className="mt-1 text-sm text-ivory-400">{formatDuration(next.durationSeconds)}</p>
                </>
              ) : (
                <p className="text-sm text-ivory-600">Last level</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {view?.status === "running" ? (
              <Button variant="secondary" onClick={() => timer("pause")} loading={busy}>
                Pause
              </Button>
            ) : (
              <Button variant="gold" onClick={() => timer("resume")} loading={busy}>
                {view?.status === "expired" ? "Start next level" : "Resume"}
              </Button>
            )}
            <Button variant="secondary" onClick={() => timer("next")} disabled={!next}>
              Next level
            </Button>
            <Button variant="secondary" onClick={() => timer("add_seconds", 60)}>
              +1 min
            </Button>
            <Button variant="secondary" onClick={() => timer("add_seconds", 300)}>
              +5 min
            </Button>
            <Button variant="secondary" onClick={() => timer("add_seconds", -60)}>
              -1 min
            </Button>
            <Button variant="ghost" onClick={() => setConfirm({ title: "Reset this level's clock?", action: () => api.timerAction(game.id, "reset") })}>
              Reset level
            </Button>
            <Button variant="ghost" onClick={() => setConfirm({ title: "Go back to the previous level?", action: () => api.timerAction(game.id, "prev") })} disabled={(view?.levelIndex ?? 0) <= 0}>
              Previous level
            </Button>
          </div>

          <div className="rounded-2xl border border-gold-400/30 bg-gold-500/5 p-3">
            <Eyebrow className="mb-2">Quick blinds</Eyebrow>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="gold"
                loading={busy}
                onClick={() =>
                  setConfirm({
                    title: "Double the blinds from the next level on?",
                    action: () => api.replaceLevels(game.id, doubleBlindsFrom(toInputs(tournament.levels), Math.max(0, (view?.levelIndex ?? -1) + 1))),
                  })
                }
              >
                Double next levels
              </Button>
              <Button size="sm" variant="secondary" loading={busy} onClick={() => void run(() => api.replaceLevels(game.id, appendDoubledLevel(toInputs(tournament.levels))))}>
                Add level (double last)
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="col-span-2"
                onClick={() =>
                  setConfirm({
                    title: "Double every level, including the current one?",
                    action: () => api.replaceLevels(game.id, doubleBlindsFrom(toInputs(tournament.levels), 0)),
                  })
                }
              >
                Double all blinds
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-ivory-600">The current level keeps its clock either way.</p>
          </div>

          <Toggle label="Advance after current hand" description="When time runs out mid-hand, the new level waits for END HAND." checked={game.advanceAfterHand} onChange={(v) => void run(() => api.updateSettings(game.id, { advanceAfterHand: v }))} />
          <Toggle label="Auto advance" description="Otherwise you press Start next level yourself." checked={game.autoAdvanceLevels} onChange={(v) => void run(() => api.updateSettings(game.id, { autoAdvanceLevels: v }))} />

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Eyebrow>Full structure</Eyebrow>
              {game.status === "lobby" || game.allowStructureEdits ? (
                <Button size="sm" variant="secondary" onClick={startEdit}>
                  Edit
                </Button>
              ) : (
                <Toggle label="Allow mid-game editing" checked={false} onChange={() => void run(() => api.updateSettings(game.id, { allowStructureEdits: true }))} />
              )}
            </div>
            <ol className="text-sm">
              {tournament.levels.map((l, i) => {
                const num = tournament.levels.slice(0, i + 1).filter((x) => x.type === "play").length;
                const isCur = l.id === tournament.currentLevelId;
                return (
                  <li key={l.id} className={cn("flex items-center justify-between border-b border-white/5 py-1.5", isCur && "text-gold-300", l.type === "break" && !isCur && "text-ivory-400")}>
                    <span>
                      {l.type === "break" ? "Break" : `Level ${num} · ${formatChips(l.smallBlind)}/${formatChips(l.bigBlind)}`}
                      {anteLabel(l) ? <span className="ml-2 text-ivory-400">{anteLabel(l)}</span> : null}
                    </span>
                    <span className="text-ivory-400">{formatDuration(l.durationSeconds)}</span>
                  </li>
                );
              })}
            </ol>
          </div>
          {error ? <p className="text-sm text-status-bad">{error}</p> : null}
        </div>
      )}
      <Confirm open={!!confirm} title={confirm?.title ?? ""} confirmLabel="Yes" busy={busy} onConfirm={() => confirm && void run(confirm.action).then(() => setConfirm(null))} onCancel={() => setConfirm(null)} />
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Devices
// -----------------------------------------------------------------------------

export function DevicesDrawer({ open, onClose, state }: DrawerProps) {
  const snap = state.snapshot!;
  const { game, me, players } = snap;
  const devices = snap.control?.devices ?? [];
  const { busy, error, run } = useAction(state);
  const [confirm, setConfirm] = useState<{ title: string; body: string; label: string; action: () => Promise<unknown> } | null>(null);
  const online = new Set(state.presence.map((p) => p.deviceId));
  const displays = state.presence.filter((p) => p.role === "display");

  const describe = (d: SnapshotDevice): string => {
    const parts: string[] = [];
    if (d.role === "player") parts.push("Player");
    if (d.role === "dealer" || (d.canControl && !d.isHost)) parts.push("Dealer");
    if (d.isHost) parts.push("Host");
    return parts.join(" · ");
  };

  return (
    <Modal open={open} onClose={onClose} title="Connected devices">
      <ul className="flex max-h-[60vh] flex-col gap-2 overflow-auto scrollbar-thin">
        {devices.map((d) => {
          const player = d.playerId ? players.find((p) => p.id === d.playerId) : null;
          const isMe = d.deviceId === me.deviceId;
          return (
            <li key={d.id} className="rounded-2xl border border-white/10 bg-charcoal-800/60 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-ivory-50">
                    {player ? player.name : d.label ?? "Device"}
                    {isMe ? <span className="ml-2 text-[9px] font-bold uppercase tracking-[0.2em] text-ivory-500">This device</span> : null}
                  </p>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-400">
                    {describe(d)}
                    {player?.seat ? ` · Seat ${player.seat}` : ""}
                    {online.has(d.deviceId) ? " · connected" : " · away"}
                  </p>
                </div>
                {me.isHost && !d.isHost ? (
                  <div className="flex flex-col gap-1">
                    {d.canControl ? (
                      <Button size="sm" variant="ghost" onClick={() => void run(() => api.revokeDealer(game.id, d.deviceId))}>
                        Revoke dealer
                      </Button>
                    ) : null}
                    {d.role === "player" && !d.canControl ? (
                      <Button size="sm" variant="ghost" onClick={() => setConfirm({ title: `Make ${player?.name ?? "this player"} the host?`, body: "They receive full host controls.", label: "Transfer host", action: () => api.transferHost(game.id, d.deviceId) })}>
                        Transfer host
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-status-bad"
                      onClick={() =>
                        setConfirm({
                          title: "Disconnect this device?",
                          body: player ? `${player.name} keeps their seat and can reconnect from another phone using the table code.` : "The dealer device loses its controls.",
                          label: "Disconnect",
                          action: () => api.disconnectDevice(game.id, d.deviceId),
                        })
                      }
                    >
                      Disconnect
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
        {displays.map((d) => (
          <li key={d.deviceId} className="rounded-2xl border border-white/10 bg-charcoal-800/40 px-4 py-3">
            <p className="font-medium text-ivory-50">Table display</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-400">Read only · connected</p>
          </li>
        ))}
      </ul>
      {error ? <p className="mt-2 text-sm text-status-bad">{error}</p> : null}
      <Confirm open={!!confirm} title={confirm?.title ?? ""} body={<p>{confirm?.body}</p>} confirmLabel={confirm?.label} danger busy={busy} onConfirm={() => confirm && void run(confirm.action).then(() => setConfirm(null))} onCancel={() => setConfirm(null)} />
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

export function SettingsDrawer({ open, onClose, state }: DrawerProps) {
  const snap = state.snapshot!;
  const { game } = snap;
  const { error, run } = useAction(state);
  const [nameEdit, setName] = useState<string | null>(null);
  const name = nameEdit ?? game.tableName;
  const patch = (p: Record<string, unknown>) => void run(() => api.updateSettings(game.id, p)).then((ok) => ok && "tableName" in p && setName(null));

  return (
    <Modal open={open} onClose={onClose} title="Table settings">
      <div className="flex max-h-[65vh] flex-col gap-3 overflow-auto scrollbar-thin pr-1">
        <div className="flex gap-2">
          <Field label="Table name" value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} className="flex-1" />
          <Button variant="secondary" className="self-end" onClick={() => patch({ tableName: name })}>
            Save
          </Button>
        </div>
        {game.status === "lobby" ? (
          <div>
            <Eyebrow className="mb-2">Seats</Eyebrow>
            <div className="grid grid-cols-6 gap-1.5">
              {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                <button key={n} type="button" onClick={() => patch({ maxSeats: n })} className={cn("h-10 rounded-lg border text-sm font-semibold", game.maxSeats === n ? "border-gold-400 bg-gold-500/20 text-ivory-50" : "border-white/10 text-ivory-300")}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <Toggle label="Allow late players" description="Late arrivals pick an open seat and wait for approval." checked={game.allowLateEntry} onChange={(v) => patch({ allowLateEntry: v })} />
        <Toggle label="Sounds" checked={game.soundsEnabled} onChange={(v) => patch({ soundsEnabled: v })} />
        <Toggle label="Haptics" checked={game.hapticsEnabled} onChange={(v) => patch({ hapticsEnabled: v })} />
        {game.timerMode === "tournament" ? (
          <>
            <Toggle label="Timer alerts" description="Vibrate at 5 minutes, 1 minute and level changes." checked={game.timerAlertsEnabled} onChange={(v) => patch({ timerAlertsEnabled: v })} />
            <Toggle label="Auto advance levels" checked={game.autoAdvanceLevels} onChange={(v) => patch({ autoAdvanceLevels: v })} />
            <Toggle label="Advance after current hand" checked={game.advanceAfterHand} onChange={(v) => patch({ advanceAfterHand: v })} />
            <Toggle label="Allow mid-game structure editing" checked={game.allowStructureEdits} onChange={(v) => patch({ allowStructureEdits: v })} />
          </>
        ) : null}
        {error ? <p className="text-sm text-status-bad">{error}</p> : null}
      </div>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Event log (dealer/host only; never contains card values)
// -----------------------------------------------------------------------------

export function EventsDrawer({ open, onClose, state }: DrawerProps) {
  const snap = state.snapshot!;
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    api
      .events(snap.game.id, 0, 150)
      .then(setEvents)
      .catch((err) => setError(friendlyMessage(err)));
  }, [open, snap.game.id, snap.game.version]);
  return (
    <Modal open={open} onClose={onClose} title="Game log">
      {error ? <p className="text-sm text-status-bad">{error}</p> : null}
      <ol className="max-h-[60vh] overflow-auto scrollbar-thin text-sm">
        {events.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-3 border-b border-white/5 py-1.5">
            <span className="text-ivory-200">{e.type.replace(/_/g, " ").toLowerCase()}</span>
            <span className="shrink-0 font-mono text-[11px] text-ivory-500">{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
          </li>
        ))}
        {events.length === 0 && !error ? <li className="text-ivory-600">Nothing yet.</li> : null}
      </ol>
    </Modal>
  );
}
