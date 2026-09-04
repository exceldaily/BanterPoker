"use client";

import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { useCallback, useRef, useState } from "react";
import { CardBack, CardFace } from "@/components/cards/PlayingCard";
import { cn } from "@/components/ui";
import { haptic, prefersReducedMotion } from "@/lib/feedback";
import type { CardMode, CardSize } from "@/lib/storage";

// The player's two hole cards. Two interactions:
//   PEEL: drag from the corner; the back curls away proportionally and snaps
//         shut on release (feels like squeezing physical cards).
//   FLIP: press-and-hold flips face up; release flips back. "Lock face up"
//         keeps them visible with a clear CARDS VISIBLE banner.
// Everything is 2D transforms + clip-path, which stays at 60fps on mid-range phones.

export interface HoleCardsProps {
  cards: [string, string] | null;
  mode: CardMode;
  lockFaceUp: boolean;
  hapticsEnabled: boolean;
  /** Obscured (app backgrounded) until the user taps. */
  obscured: boolean;
  onReveal: () => void;
  orientation?: "portrait" | "landscape";
  /** Player-chosen face scale. "xl" is the large-print option. */
  size?: CardSize;
  handKey: string;
  disabled?: boolean;
}

const WIDTHS: Record<"portrait" | "landscape", Record<CardSize, string>> = {
  portrait: { standard: "max-w-xs gap-3", large: "max-w-sm gap-3", xl: "max-w-md gap-2" },
  landscape: { standard: "max-w-2xl gap-6", large: "max-w-3xl gap-6", xl: "max-w-4xl gap-4" },
};

const PEEL_MAX = 150;

function PeelCard({ id, hapticsEnabled, side, disabled }: { id: string; hapticsEnabled: boolean; side: "left" | "right"; disabled?: boolean }) {
  const y = useMotionValue(0);
  const reduced = prefersReducedMotion();
  const buzzed = useRef(false);
  // How far the back has been dragged up, 0..1
  const progress = useTransform(y, [0, -PEEL_MAX], [0, 1], { clamp: true });
  const backTranslate = useTransform(progress, (p) => `translateY(${-p * 78}%)`);
  const backSkew = useTransform(progress, (p) => `${side === "left" ? -1 : 1}${(p * 9).toFixed(1)}deg`);
  const backShadow = useTransform(progress, (p) => `0 ${8 + p * 22}px ${24 + p * 30}px rgba(0,0,0,${0.35 + p * 0.3})`);
  const faceBright = useTransform(progress, (p) => `brightness(${0.55 + p * 0.45})`);

  const onDrag = useCallback(
    (_: unknown, info: PanInfo) => {
      const p = Math.min(1, Math.max(0, -info.offset.y / PEEL_MAX));
      if (p > 0.55 && !buzzed.current) {
        buzzed.current = true;
        if (hapticsEnabled) haptic("peek");
      }
      if (p < 0.2) buzzed.current = false;
    },
    [hapticsEnabled],
  );

  return (
    <div className="relative w-full touch-none no-select" style={{ aspectRatio: "5 / 7" }}>
      <motion.div className="absolute inset-0" style={{ filter: reduced ? undefined : faceBright }}>
        <CardFace id={id} className="h-full w-full" />
      </motion.div>
      <motion.div
        className="absolute inset-0 origin-bottom"
        style={{ y, transform: backTranslate, skewX: backSkew, boxShadow: backShadow, borderRadius: "7%" }}
        drag={disabled ? false : "y"}
        dragConstraints={{ top: -PEEL_MAX, bottom: 0 }}
        dragElastic={0.08}
        dragMomentum={false}
        dragSnapToOrigin
        dragTransition={{ bounceStiffness: 500, bounceDamping: 30 }}
        onDrag={onDrag}
        whileTap={{ scale: 0.995 }}
        aria-label="Drag up to peek at this card"
        role="button"
      >
        <CardBack className="h-full w-full" />
        <span
          className={cn("pointer-events-none absolute inset-x-0 bottom-[7%] text-center text-[10px] font-semibold uppercase tracking-[0.3em] text-ivory-100/50")}
          aria-hidden
        >
          Peel
        </span>
      </motion.div>
    </div>
  );
}

function FlipCard({ id, up, delay }: { id: string; up: boolean; delay: number }) {
  const reduced = prefersReducedMotion();
  return (
    <div className="relative w-full" style={{ aspectRatio: "5 / 7", perspective: 1200 }}>
      <motion.div
        className="relative h-full w-full"
        style={{ transformStyle: "preserve-3d" }}
        animate={{ rotateY: up ? 180 : 0 }}
        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 26, delay }}
      >
        <div className="absolute inset-0" style={{ backfaceVisibility: "hidden" }}>
          <CardBack className="h-full w-full" />
        </div>
        <div className="absolute inset-0" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
          <CardFace id={id} className="h-full w-full" />
        </div>
      </motion.div>
    </div>
  );
}

export function HoleCards({ cards, mode, lockFaceUp, hapticsEnabled, obscured, onReveal, orientation = "portrait", size = "large", handKey, disabled }: HoleCardsProps) {
  // Holding is scoped to the current hand + mode so a new hand never inherits a press.
  const scope = `${handKey}:${mode}`;
  const [hold, setHold] = useState<{ scope: string; down: boolean }>({ scope, down: false });
  const holding = hold.scope === scope && hold.down;
  const reduced = prefersReducedMotion();
  const faceUp = mode === "flip" && (lockFaceUp || holding);

  const startHold = () => {
    if (disabled) return;
    setHold({ scope, down: true });
    if (hapticsEnabled) haptic("peek");
  };
  const endHold = () => setHold({ scope, down: false });

  const layout = `flex-row ${WIDTHS[orientation][size]}`;

  return (
    <div className="relative w-full">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={handKey}
          className={cn("mx-auto flex w-full items-stretch justify-center", layout)}
          initial={reduced ? false : { y: -60, opacity: 0, scale: 0.9 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={reduced ? undefined : { y: 40, opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
          transition={{ type: "spring", stiffness: 240, damping: 24 }}
        >
          {cards ? (
            mode === "peel" ? (
              <>
                <div className="w-1/2 rotate-[-3deg]">
                  <PeelCard id={cards[0]} hapticsEnabled={hapticsEnabled} side="left" disabled={disabled || obscured} />
                </div>
                <div className="w-1/2 rotate-[3deg]">
                  <PeelCard id={cards[1]} hapticsEnabled={hapticsEnabled} side="right" disabled={disabled || obscured} />
                </div>
              </>
            ) : (
              <div
                className="flex w-full touch-none select-none gap-3 no-select"
                onPointerDown={startHold}
                onPointerUp={endHold}
                onPointerCancel={endHold}
                onPointerLeave={endHold}
                onContextMenu={(e) => e.preventDefault()}
                role="button"
                aria-pressed={faceUp}
                aria-label={lockFaceUp ? "Cards visible" : "Press and hold to flip your cards"}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") startHold();
                }}
                onKeyUp={endHold}
              >
                <div className="w-1/2 rotate-[-3deg]">
                  <FlipCard id={cards[0]} up={faceUp && !obscured} delay={0} />
                </div>
                <div className="w-1/2 rotate-[3deg]">
                  <FlipCard id={cards[1]} up={faceUp && !obscured} delay={0.06} />
                </div>
              </div>
            )
          ) : (
            <>
              <div className="w-1/2 rotate-[-3deg] opacity-40">
                <CardBack className="w-full" />
              </div>
              <div className="w-1/2 rotate-[3deg] opacity-40">
                <CardBack className="w-full" />
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {obscured && cards ? (
        <button
          type="button"
          onClick={onReveal}
          className="absolute inset-0 flex flex-col items-center justify-center rounded-3xl bg-charcoal-950/92 text-ivory-100 backdrop-blur-md"
        >
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-ivory-400">Cards hidden</span>
          <span className="mt-2 font-serif text-2xl">Tap to continue</span>
        </button>
      ) : null}

      {mode === "flip" && lockFaceUp && cards && !obscured ? (
        <div className="pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-status-warn px-3 py-1 text-[10px] font-bold uppercase tracking-[0.25em] text-charcoal-950">
          Cards visible
        </div>
      ) : null}
    </div>
  );
}
