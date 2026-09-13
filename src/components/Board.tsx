"use client";

import { AnimatePresence, motion } from "framer-motion";
import { EmptyCardSlot, MiniCard, type MiniSize } from "@/components/cards/PlayingCard";
import { cn } from "@/components/ui";
import { prefersReducedMotion } from "@/lib/feedback";
import type { SnapshotHand } from "@/lib/types";

const STAGE_LABEL: Record<SnapshotHand["state"], string> = {
  pre_flop: "Pre-flop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  complete: "Hand complete",
};

/** The shared community board. Identical on every device. */
export function Board({ hand, size = "md", className, showStage = true }: { hand: SnapshotHand | null; size?: MiniSize; className?: string; showStage?: boolean }) {
  const cards = hand?.board ?? [];
  const reduced = prefersReducedMotion();
  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      {showStage ? (
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ivory-400">{hand ? STAGE_LABEL[hand.state] : "Waiting for a hand"}</p>
      ) : null}
      <div className={cn("flex items-center gap-2 sm:gap-3", size === "auto" && "xl:gap-5 2xl:gap-6")}>
        <AnimatePresence initial={false}>
          {[0, 1, 2, 3, 4].map((i) => {
            const id = cards[i];
            return id ? (
              <motion.div
                key={`${hand?.id}-${i}-${id}`}
                initial={reduced ? false : { opacity: 0, y: -18, rotateY: 90 }}
                animate={{ opacity: 1, y: 0, rotateY: 0 }}
                transition={{ duration: 0.38, delay: reduced ? 0 : (i % 3) * 0.08, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <MiniCard id={id} size={size} />
              </motion.div>
            ) : (
              <EmptyCardSlot key={`empty-${i}`} size={size} />
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
