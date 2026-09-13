"use client";

import { MiniCard } from "@/components/cards/PlayingCard";
import { cn } from "@/components/ui";
import { seatLabel } from "@/lib/positions";
import type { SnapshotHand, SnapshotPlayer } from "@/lib/types";

// Oval (stadium) poker table: a padded rail around a felt playing surface
// with a betting line, and seats spread evenly around the rim, clockwise from
// the top-left, exactly like people sit around a real home-game table.

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

// Geometry in a 200 x 100 box (the container is 2:1). The seat path is a
// stadium: two straights joined by semicircles, sitting just outside the rail.
const BOX_W = 200;
const BOX_H = 100;
const SEAT_R = 41; // radius of the seat path's end caps
const SEAT_CY = 50;
const CAP_LEFT_CX = BOX_W / 2 - 42; // 58
const CAP_RIGHT_CX = BOX_W / 2 + 42; // 142
const STRAIGHT = CAP_RIGHT_CX - CAP_LEFT_CX; // 84
const ARC = Math.PI * SEAT_R;
const PERIMETER = 2 * STRAIGHT + 2 * ARC;

/** Point on the seat path at arc-length `t` measured clockwise from the top-left junction. */
function pointAt(t: number): { x: number; y: number } {
  let d = ((t % PERIMETER) + PERIMETER) % PERIMETER;
  if (d < STRAIGHT) return { x: CAP_LEFT_CX + d, y: SEAT_CY - SEAT_R }; // top straight, left -> right
  d -= STRAIGHT;
  if (d < ARC) {
    const a = -Math.PI / 2 + (d / ARC) * Math.PI; // right cap, top -> bottom
    return { x: CAP_RIGHT_CX + SEAT_R * Math.cos(a), y: SEAT_CY + SEAT_R * Math.sin(a) };
  }
  d -= ARC;
  if (d < STRAIGHT) return { x: CAP_RIGHT_CX - d, y: SEAT_CY + SEAT_R }; // bottom straight, right -> left
  d -= STRAIGHT;
  const a = Math.PI / 2 + (d / ARC) * Math.PI; // left cap, bottom -> top
  return { x: CAP_LEFT_CX + SEAT_R * Math.cos(a), y: SEAT_CY + SEAT_R * Math.sin(a) };
}

/**
 * Percent positions for n seats. Anchored at the top centre so the layout is
 * left-right symmetric: seat 1 is the first chair left of top centre, seat 2
 * the first right of it, then clockwise around the table.
 */
export function seatPositions(n: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const spacing = PERIMETER / n;
  for (let i = 0; i < n; i++) {
    const p = pointAt(STRAIGHT / 2 + (i - 0.5) * spacing);
    out.push({ x: (p.x / BOX_W) * 100, y: (p.y / BOX_H) * 100 });
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
    <div className={cn("relative mx-auto w-full", compact ? "max-w-md" : "max-w-2xl", className)} style={{ aspectRatio: "2 / 1", padding: compact ? "6% 8%" : "7% 9%" }}>
      {/* Rail */}
      <div
        className="absolute inset-[9%_7%] rounded-full shadow-card"
        style={{ background: "linear-gradient(180deg, #2a2320 0%, #171311 55%, #0f0c0b 100%)", boxShadow: "0 18px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)" }}
        aria-hidden
      />
      {/* Felt */}
      <div
        className="absolute inset-[16%_11%] rounded-full"
        style={{ background: "radial-gradient(ellipse at 50% 40%, #1f4a35 0%, #143122 55%, #0e2418 100%)", boxShadow: "inset 0 8px 24px rgba(0,0,0,0.45)" }}
        aria-hidden
      />
      {/* Betting line */}
      <div className="absolute inset-[27%_19%] rounded-full border border-ivory-100/20" aria-hidden />
      {center ? <div className="absolute inset-[30%_22%] flex items-center justify-center">{center}</div> : null}

      {positions.map((pt, i) => {
        const seat = i + 1;
        const p = bySeat.get(seat) ?? null;
        const isMe = mySeat === seat || (p && myPlayerId && p.id === myPlayerId);
        const badge = p ? statusBadge(p, activeHand) : null;
        const label = pos ? seatLabel(seat, pos) : dealerSeat === seat ? "D" : null;
        const muted = p && (p.status === "eliminated" || p.status === "sitting_out" || (activeHand && p.handStatus === "folded"));
        const connected = p ? (connectedPlayerIds ? connectedPlayerIds.has(p.id) : true) : false;
        const clickable = !!onSeatTap && (selectable ? !p || isMe : true);
        const bottomHalf = pt.y > 50;
        return (
          <button
            key={seat}
            type="button"
            disabled={!clickable}
            onClick={() => onSeatTap?.(seat, p)}
            className={cn(
              "absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-2xl px-1 py-1 text-center transition",
              bottomHalf ? "flex-col-reverse" : "flex-col",
              clickable && "hover:scale-[1.04] active:scale-95",
              !clickable && "cursor-default",
            )}
            style={{ left: `${pt.x}%`, top: `${pt.y}%`, minWidth: compact ? 52 : 72 }}
            aria-label={p ? `Seat ${seat}, ${p.name}${badge ? `, ${badge.label.toLowerCase()}` : ""}` : `Seat ${seat}, available`}
          >
            <span
              className={cn(
                "relative flex items-center justify-center rounded-full border-2 font-semibold shadow-soft",
                compact ? "h-10 w-10 text-xs" : "h-14 w-14 text-sm xl:h-16 xl:w-16 xl:text-base 2xl:h-20 2xl:w-20 2xl:text-lg",
                p
                  ? muted
                    ? "border-white/10 bg-charcoal-800 text-ivory-600"
                    : isMe
                      ? "border-gold-400 bg-gold-500/25 text-ivory-50"
                      : "border-ivory-100/20 bg-charcoal-800 text-ivory-100"
                  : selectable
                    ? "border-dashed border-gold-400/70 bg-felt-800/70 text-gold-300"
                    : "border-dashed border-white/15 bg-charcoal-900/70 text-ivory-600",
              )}
            >
              {p ? initials(p.name) : seat}
              {label ? (
                <span
                  className={cn(
                    "absolute -right-1.5 -top-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-wide shadow-soft",
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
            <span className={cn("max-w-[5.5rem] truncate font-medium", compact ? "text-[10px]" : "text-[11px] xl:text-sm 2xl:max-w-[8rem] 2xl:text-base", p ? (muted ? "text-ivory-600" : "text-ivory-100") : "text-ivory-600")}>
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
