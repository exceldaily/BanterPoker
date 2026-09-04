"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Board } from "@/components/Board";
import { ConnectionDot } from "@/components/ConnectionDot";
import { HoleCards } from "@/components/cards/HoleCards";
import { MiniCard } from "@/components/cards/PlayingCard";
import { TournamentBar } from "@/components/TournamentBar";
import { Button, Confirm, Modal, Segmented, Toast, Toggle, cn, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { friendlyMessage } from "@/lib/errors";
import { haptic, playSound, prefersReducedMotion, unlockAudio } from "@/lib/feedback";
import { useCountdown } from "@/lib/hooks/useCountdown";
import type { GameState } from "@/lib/hooks/useGame";
import { seatLabel } from "@/lib/positions";
import { prefs, useStored, type CardMode, type CardSize, type Orientation } from "@/lib/storage";

// The player's phone becomes their two hole cards. Everything else stays small.

export function PlayerView({ state, onSwitchToDealer }: { state: GameState; onSwitchToDealer?: () => void }) {
  const router = useRouter();
  const snap = state.snapshot!;
  const { game, hand, me, players, tournament } = snap;
  const toast = useToast();
  // Preferences: stored value renders after hydration; local choice wins once the user changes it.
  const storedMode = useStored(prefs.getCardMode, "peel");
  const storedOrientation = useStored(prefs.getOrientation, "portrait");
  const storedLock = useStored(prefs.getLockFaceUp, false);
  const storedSize = useStored(prefs.getCardSize, "large");
  const [modeChoice, setMode] = useState<CardMode | null>(null);
  const [orientationChoice, setOrientation] = useState<Orientation | null>(null);
  const [lockChoice, setLockFaceUp] = useState<boolean | null>(null);
  const [sizeChoice, setCardSize] = useState<CardSize | null>(null);
  const mode: CardMode = modeChoice ?? storedMode;
  const orientation: Orientation = orientationChoice ?? storedOrientation;
  const lockFaceUp = lockChoice ?? storedLock;
  const cardSize: CardSize = sizeChoice ?? storedSize;
  // Five medium cards plus gaps still fit a 375px phone; anything bigger would overflow.
  const boardSize = cardSize === "standard" ? "sm" : "md";
  const [obscured, setObscured] = useState(false);
  const [confirmFold, setConfirmFold] = useState(false);
  const [confirmShow, setConfirmShow] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [levelFlash, setLevelFlash] = useState<string | null>(null);
  const lastHand = useRef<string | null>(null);
  const lastBoard = useRef<number>(0);
  const lastLevel = useRef<string | null>(null);

  // Privacy screen: hide the cards whenever the app loses focus.
  useEffect(() => {
    const hide = () => setObscured(true);
    const onVis = () => {
      if (document.visibilityState !== "visible") hide();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", hide);
    window.addEventListener("pagehide", hide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", hide);
      window.removeEventListener("pagehide", hide);
    };
  }, []);

  const myHand = me.hand ?? null;
  const cards = myHand?.cards ?? null;
  const inHand = !!hand && hand.state !== "complete" && !!myHand;
  const folded = myHand?.status === "folded";
  const shown = myHand?.status === "shown";
  const mucked = myHand?.status === "mucked";
  const handKey = hand?.id ?? "none";
  const myPlayer = players.find((p) => p.id === me.playerId);
  const pos = hand ? { button: hand.dealerSeat, smallBlind: hand.smallBlindSeat, bigBlind: hand.bigBlindSeat } : null;
  const myLabel = me.seat != null ? seatLabel(me.seat, pos) : null;

  // New hand / street / level cues.
  useEffect(() => {
    if (!hand) return;
    if (hand.id !== lastHand.current) {
      lastHand.current = hand.id;
      lastBoard.current = hand.board.length;
      if (cards) {
        if (game.hapticsEnabled) haptic("deal");
        if (game.soundsEnabled) playSound("deal");
      }
      return;
    }
    if (hand.board.length > lastBoard.current) {
      const street = hand.board.length === 3 ? "flop" : hand.board.length === 4 ? "turn" : "river";
      lastBoard.current = hand.board.length;
      if (game.soundsEnabled) playSound(street);
    }
  }, [hand, cards, game.hapticsEnabled, game.soundsEnabled]);

  useEffect(() => {
    const cur = tournament.currentLevelId;
    if (!cur || lastLevel.current === cur) {
      lastLevel.current = cur;
      return;
    }
    if (lastLevel.current !== null) {
      const level = tournament.levels.find((l) => l.id === cur);
      setLevelFlash(level?.type === "break" ? "Break" : "New blind level");
      if (game.timerAlertsEnabled && game.hapticsEnabled) haptic("level");
      if (game.soundsEnabled) playSound(level?.type === "break" ? "break" : "level");
      window.setTimeout(() => setLevelFlash(null), 2600);
    }
    lastLevel.current = cur;
  }, [tournament.currentLevelId, tournament.levels, game.timerAlertsEnabled, game.hapticsEnabled, game.soundsEnabled]);

  const onExpire = useCallback(() => {
    void api.syncTimer(game.id).then(() => state.refresh()).catch(() => undefined);
  }, [game.id, state]);
  const onWarning = useCallback(
    (s: number) => {
      if (!game.timerAlertsEnabled) return;
      if (game.hapticsEnabled) haptic("warning");
      if (game.soundsEnabled) playSound("warning");
      toast.show(s === 60 ? "One minute left in the level" : "Five minutes left in the level");
    },
    [game.timerAlertsEnabled, game.hapticsEnabled, game.soundsEnabled, toast],
  );
  const view = useCountdown(tournament, { onExpire, onWarning });

  const fold = async () => {
    setBusy(true);
    try {
      await state.act(() => api.foldHand(game.id));
      setConfirmFold(false);
      if (game.hapticsEnabled) haptic("fold");
      if (game.soundsEnabled) playSound("fold");
    } catch (err) {
      toast.show(friendlyMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };
  const show = async () => {
    setBusy(true);
    try {
      await state.act(() => api.showHand(game.id));
      setConfirmShow(false);
    } catch (err) {
      toast.show(friendlyMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };
  const muck = async () => {
    try {
      await state.act(() => api.muckHand(game.id));
    } catch (err) {
      toast.show(friendlyMessage(err), "error");
    }
  };

  const reduced = prefersReducedMotion();
  const canShow = !!myHand && !folded && !shown && !!hand;
  const showdownStage = !!hand && (hand.state === "complete" || hand.state === "river" || hand.playersRemaining <= 2);

  return (
    <main className={cn("safe-top safe-bottom safe-x mx-auto flex min-h-dvh w-full flex-col gap-3 py-3", orientation === "landscape" ? "max-w-4xl" : "max-w-md")} onPointerDown={unlockAudio}>
      <Toast message={toast.message} tone={toast.tone} />

      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-serif text-xl text-ivory-50">{game.tableName}</p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ivory-400">
            {hand ? `Hand ${hand.number}` : "Between hands"}
            {me.seat ? ` · Seat ${me.seat}` : ""}
            {myLabel ? ` · ${myLabel}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionDot state={state.connection} />
          <button type="button" aria-label="Card settings" onClick={() => setShowSettings(true)} className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-ivory-400">
            {mode}
          </button>
        </div>
      </header>

      <TournamentBar game={game} tournament={tournament} view={view} />

      <Board hand={hand} size={boardSize} className="py-1" />

      <AnimatePresence>
        {levelFlash ? (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-2xl border border-gold-400/40 bg-gold-500/15 py-2 text-center text-xs font-bold uppercase tracking-[0.3em] text-gold-300"
          >
            {levelFlash}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <section className="flex flex-1 flex-col items-center justify-center gap-4">
        {myPlayer?.status === "eliminated" ? (
          <Status title="Out" body="You are out of the tournament. The host can restore you if the table allows re-entry." />
        ) : myPlayer?.status === "sitting_out" ? (
          <Status title="Sitting out" body="You will be dealt in once the host marks you active." />
        ) : myPlayer?.status === "pending" ? (
          <Status title="Waiting for approval" body="The host will let you in before the next hand." />
        ) : !hand || (hand.state === "complete" && !myHand) ? (
          <Status title="Waiting for the deal" body="Cards arrive here the moment the dealer starts the next hand." />
        ) : !myHand ? (
          <Status title="Not in this hand" body="You will be dealt in on the next hand." />
        ) : folded ? (
          <Status title="Folded" body="Waiting for next hand." muted />
        ) : (
          <>
            <div className={cn("w-full", orientation === "landscape" ? "px-6" : "px-2")}>
              <HoleCards
                cards={cards}
                mode={mode}
                lockFaceUp={lockFaceUp}
                hapticsEnabled={game.hapticsEnabled}
                obscured={obscured}
                onReveal={() => setObscured(false)}
                orientation={orientation}
                size={cardSize}
                handKey={handKey}
                disabled={!inHand && hand.state === "complete" && !shown ? false : undefined}
              />
            </div>
            {shown && cards ? (
              <div className="flex items-center gap-2 rounded-full border border-gold-400/40 bg-gold-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.25em] text-gold-300">
                Shown to the table <MiniCard id={cards[0]} size="xs" /> <MiniCard id={cards[1]} size="xs" />
              </div>
            ) : null}
            {hand.state === "complete" ? (
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-ivory-400">Hand over · next hand coming</p>
            ) : null}
          </>
        )}
      </section>

      <footer className="flex flex-col items-center gap-3">
        {myHand && !folded ? (
          <div className="flex w-full items-center justify-center gap-2">
            {canShow && (showdownStage || hand?.state === "complete") ? (
              <>
                <Button variant="gold" size="sm" onClick={() => setConfirmShow(true)}>
                  Show hand
                </Button>
                {!mucked ? (
                  <Button variant="ghost" size="sm" onClick={() => void muck()}>
                    Keep private
                  </Button>
                ) : (
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-600">Kept private</span>
                )}
              </>
            ) : null}
          </div>
        ) : null}

        <div className="flex w-full items-center justify-between gap-3">
          <Segmented
            size="sm"
            value={mode}
            options={[
              { value: "peel", label: "Peel" },
              { value: "flip", label: "Flip" },
            ]}
            onChange={(m) => {
              setMode(m);
              prefs.setCardMode(m);
            }}
          />
          {inHand && !folded && hand?.state !== "complete" ? (
            <Button variant="secondary" size="sm" onClick={() => setConfirmFold(true)} className="min-w-28">
              Fold
            </Button>
          ) : (
            <span className="min-w-28" />
          )}
        </div>
        <div className="flex items-center gap-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-600">
          {onSwitchToDealer ? (
            <button type="button" onClick={onSwitchToDealer} className="text-gold-300">
              Dealer controls
            </button>
          ) : null}
          <button type="button" onClick={() => router.push("/")}>
            Home
          </button>
        </div>
      </footer>

      <Confirm
        open={confirmFold}
        title="Fold this hand?"
        body={<p>Your cards close immediately and stay private. You are dealt in again next hand.</p>}
        confirmLabel="Fold"
        cancelLabel="Cancel"
        danger
        onConfirm={() => void fold()}
        onCancel={() => setConfirmFold(false)}
        busy={busy}
      />
      <Confirm
        open={confirmShow}
        title="Show your hand to the table?"
        body={<p>Everyone at the table will see both of your cards for this hand. This cannot be undone.</p>}
        confirmLabel="Yes, show cards"
        onConfirm={() => void show()}
        onCancel={() => setConfirmShow(false)}
        busy={busy}
      />
      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Card view">
        <div className="flex flex-col gap-3">
          <Segmented
            value={mode}
            options={[
              { value: "peel", label: "Peel" },
              { value: "flip", label: "Flip" },
            ]}
            onChange={(m) => {
              setMode(m);
              prefs.setCardMode(m);
            }}
          />
          <p className="text-sm text-ivory-400">Peel: drag a card up to squeeze a look. Flip: press and hold to turn both cards over.</p>
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-400">Card size</p>
            <Segmented
              value={cardSize}
              options={[
                { value: "standard", label: "Standard" },
                { value: "large", label: "Large" },
                { value: "xl", label: "Extra large" },
              ]}
              onChange={(s) => {
                setCardSize(s);
                prefs.setCardSize(s);
              }}
            />
            <p className="mt-2 text-sm text-ivory-400">Extra large is the big-print option: bigger faces, bigger corner numbers, bigger board.</p>
          </div>
          {mode === "flip" ? (
            <Toggle
              label="Lock face up"
              description="Keep cards visible until you turn this off."
              checked={lockFaceUp}
              onChange={(v) => {
                setLockFaceUp(v);
                prefs.setLockFaceUp(v);
              }}
            />
          ) : null}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-400">Layout</p>
            <Segmented
              value={orientation}
              options={[
                { value: "portrait", label: "Portrait" },
                { value: "landscape", label: "Landscape" },
              ]}
              onChange={(o) => {
                setOrientation(o);
                prefs.setOrientation(o);
                const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
                if (so?.lock) so.lock(o === "landscape" ? "landscape" : "portrait").catch(() => undefined);
              }}
            />
          </div>
        </div>
      </Modal>
    </main>
  );
}

function Status({ title, body, muted }: { title: string; body: string; muted?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 text-center", muted && "opacity-70")}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-ivory-400">{title}</p>
      <p className="max-w-xs font-serif text-2xl text-ivory-100">{body}</p>
    </div>
  );
}
