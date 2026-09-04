"use client";

import { MiniCard } from "@/components/cards/PlayingCard";
import { cn } from "@/components/ui";
import { seatLabel } from "@/lib/positions";
import type { SnapshotHand, SnapshotPlayer } from "@/lib/types";

// Poker-table shaped seating. Seats are laid out around an oval, clockwise
// from the top-left, so seat 1 and the last seat sit next to each other.

export interface SeatMapProps {
  maxSeats: number;
  players: SnapshotPlayer[];
  hand: SnapshotHand | null;
  dealerSeat: number | null;
  mySeat?: number | null;
  myPlayerId?: string | null;
  connectedPlayerIds?: Set<string>;
  onSeatTap?: (seat: number, occupant: SnapshotPlayer | null) => void;
  selectable?: boolean;
  compact?: boolean;
  className?: string;
  center?: React.ReactNode;
}

/** Positions (percent) for n seats around an oval, seat 1 top-left going clockwise. */
export function seatPositions(n: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  // Start at roughly 10 o'clock and go clockwise so the "top" of the table reads left to right.
  const start = -Math.PI * 0.78;
  for (let i = 0; i < n; i++) {
    const angle = start + (i / n) * Math.PI * 2;
    out.push({ x: 50 + 44 * Math.cos(angle), y: 50 + 40 * Math.sin(angle) });
  }
  return out;
}

function statusBadge(p: SnapshotPlayer, inHand: boolean): { label: string; className: string } | null {
  if (p.status === "eliminated") return { label: "OUT", className: "bg-charcoal-700 text-ivory-400" };
  if (p.status === "sitting_out") return { label: "SITTING OUT", className: "bg-charcoal-700 text-ivory-400" };
  if (p.status === "pending") return { label: "WAITING", className: "bg-gold-500/20 text-gold-300" };
  if (inHand && p.handStatus === "folded") return { label: "FOLDED", className: "bg-charcoal-700 text-ivory-400" };
  if (inHand && p.handStatus === "shown") return { label: "SHOWN", className: "bg-gold-500/20 text-gold-300" };
  return null;
}

export function SeatMap({ maxSeats, players, hand, dealerSeat, mySeat, myPlayerId, connectedPlayerIds, onSeatTap, selectable, compact, className, center }: SeatMapProps) {
  const positions = seatPositions(maxSeats);
  const bySeat = new Map<number, SnapshotPlayer>();
  for (const p of players) if (p.seat != null) bySeat.set(p.seat, p);
  const pos = hand && hand.state !== "complete" ? { button: hand.dealerSeat, smallBlind: hand.smallBlindSeat, bigBlind: hand.bigBlindSeat } : null;
  const activeHand = !!hand && hand.state !== "complete";

  return (
    <div className={cn("relative mx-auto w-full", compact ? "max-w-sm" : "max-w-xl", className)} style={{ aspectRatio: "4 / 3" }}>
      <div className="felt absolute inset-[12%] rounded-[45%] border-[6px] border-charcoal-800 shadow-card" aria-hidden />
      <div className="absolute inset-[16%] rounded-[45%] border border-gold-400/20" aria-hidden />
      {center ? <div className="absolute inset-[22%] flex items-center justify-center">{center}</div> : null}

      {positions.map((pt, i) => {
        const seat = i + 1;
        const p = bySeat.get(seat) ?? null;
        const isMe = mySeat === seat || (p && myPlayerId && p.id === myPlayerId);
        const badge = p ? statusBadge(p, activeHand) : null;
        const label = pos ? seatLabel(seat, pos) : dealerSeat === seat ? "D" : null;
        const muted = p && (p.status === "eliminated" || p.status === "sitting_out" || (activeHand && p.handStatus === "folded"));
        const connected = p ? (connectedPlayerIds ? connectedPlayerIds.has(p.id) : true) : false;
        const clickable = !!onSeatTap && (selectable ? !p || isMe : true);
        return (
          <button
            key={seat}
            type="button"
            disabled={!clickable}
            onClick={() => onSeatTap?.(seat, p)}
            className={cn(
              "absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-2xl px-1 py-1 text-center transition",
              clickable && "hover:scale-[1.04] active:scale-95",
              !clickable && "cursor-default",
            )}
            style={{ left: `${pt.x}%`, top: `${pt.y}%`, minWidth: compact ? 56 : 72 }}
            aria-label={p ? `Seat ${seat}, ${p.name}${badge ? `, ${badge.label.toLowerCase()}` : ""}` : `Seat ${seat}, available`}
          >
            <span
              className={cn(
                "relative flex items-center justify-center rounded-full border font-semibold shadow-soft",
                compact ? "h-11 w-11 text-xs" : "h-14 w-14 text-sm",
                p
                  ? muted
                    ? "border-white/10 bg-charcoal-800 text-ivory-600"
                    : isMe
                      ? "border-gold-400 bg-gold-500/20 text-ivory-50"
                      : "border-white/15 bg-charcoal-800 text-ivory-100"
                  : selectable
                    ? "border-dashed border-gold-400/60 bg-felt-800/60 text-gold-300"
                    : "border-dashed border-white/15 bg-charcoal-900/60 text-ivory-600",
              )}
            >
              {p ? initials(p.name) : seat}
              {label ? (
                <span
                  className={cn(
                    "absolute -right-1 -top-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-wide",
                    label.startsWith("D") ? "bg-ivory-50 text-charcoal-950" : "bg-gold-500 text-charcoal-950",
                  )}
                >
                  {label}
                </span>
              ) : null}
              {p ? (
                <span
                  className={cn("absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-full border-2 border-charcoal-900", connected ? "bg-status-ok" : "bg-charcoal-600")}
                  aria-hidden
                />
              ) : null}
            </span>
            <span className={cn("max-w-[5.5rem] truncate text-[11px] font-medium", p ? (muted ? "text-ivory-600" : "text-ivory-100") : "text-ivory-600")}>
              {p ? p.name : selectable ? "Open" : `Seat ${seat}`}
            </span>
            {badge ? <span className={cn("rounded-full px-1.5 py-0.5 text-[8px] font-bold tracking-widest", badge.className)}>{badge.label}</span> : null}
            {p?.shownCards ? (
              <span className="flex gap-0.5">
                <MiniCard id={p.shownCards[0]} size="xs" />
                <MiniCard id={p.shownCards[1]} size="xs" />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : parts[0]?.[1] ?? "";
  return (a + b).toUpperCase();
}
