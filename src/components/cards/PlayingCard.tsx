import { cn } from "@/components/ui";
import { parseCard } from "@/lib/cards";

// Card faces are drawn with SVG + system fonts: no third-party artwork.
// A 5:7 aspect ratio, big corner indices, a large central pip so a rank is
// readable from a quick glance at a peeled corner.

export const CARD_ASPECT = "5 / 7";

function SuitGlyph({ symbol, className }: { symbol: string; className?: string }) {
  return (
    <span className={cn("leading-none", className)} aria-hidden>
      {symbol}
    </span>
  );
}

export function CardFace({ id, className, style, faded }: { id: string; className?: string; style?: React.CSSProperties; faded?: boolean }) {
  const c = parseCard(id);
  const color = c.color === "red" ? "text-card-red" : "text-card-black";
  return (
    <div
      className={cn(
        "card-face relative flex select-none flex-col overflow-hidden rounded-[7%] border border-black/15 shadow-card",
        color,
        faded && "opacity-60 saturate-50",
        className,
      )}
      style={{ aspectRatio: CARD_ASPECT, containerType: "inline-size", ...style }}
      role="img"
      aria-label={c.name}
    >
      {/* Large-index corners: rank first, suit below, bold and high contrast so a
          quick peek at a corner is readable even with poor eyesight. */}
      <div className="absolute left-[6%] top-[4%] flex flex-col items-center font-sans" style={{ fontSize: "min(17cqw, 4.2rem)", lineHeight: 0.95 }}>
        <span className="font-bold tabular-nums tracking-tight">{c.rankLabel}</span>
        <SuitGlyph symbol={c.suitSymbol} className="text-[0.95em]" />
      </div>
      <div className="absolute bottom-[4%] right-[6%] flex rotate-180 flex-col items-center font-sans" style={{ fontSize: "min(17cqw, 4.2rem)", lineHeight: 0.95 }}>
        <span className="font-bold tabular-nums tracking-tight">{c.rankLabel}</span>
        <SuitGlyph symbol={c.suitSymbol} className="text-[0.95em]" />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <span className="font-serif" style={{ fontSize: "min(40cqw, 9.5rem)" }} aria-hidden>
          {c.suitSymbol}
        </span>
      </div>
    </div>
  );
}

export function CardBack({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={cn("card-back relative select-none overflow-hidden rounded-[7%] border border-white/10 shadow-card", className)}
      style={{ aspectRatio: CARD_ASPECT, ...style }}
      aria-hidden
    >
      <div className="absolute inset-[6%] rounded-[6%] border border-ivory-100/30" />
      <div className="absolute inset-[11%] rounded-[5%] border border-gold-400/40" />
      <div className="absolute inset-0 flex items-center justify-center">
        <svg viewBox="0 0 100 100" className="h-[34%] w-[34%] text-gold-300/80" aria-hidden>
          <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" strokeWidth="1" />
          <path d="M50 22c-10 14-22 20-22 31a10 10 0 0 0 19 4 10 10 0 0 0 19-4c0-11-12-17-16-31z" fill="currentColor" opacity="0.9" />
          <rect x="47" y="58" width="6" height="18" fill="currentColor" opacity="0.9" />
        </svg>
      </div>
    </div>
  );
}

export type MiniSize = "xs" | "sm" | "md" | "lg" | "xl" | "auto";

// "auto" grows with the viewport: phone-sized on a phone, huge on a TV.
const MINI_FACE_SIZES: Record<MiniSize, string> = {
  xs: "w-7 text-[11px] rounded-[4px]",
  sm: "w-10 text-sm rounded-md",
  md: "w-14 text-lg rounded-lg",
  lg: "w-20 text-2xl rounded-xl",
  xl: "w-28 text-4xl rounded-2xl",
  auto: "w-14 text-lg rounded-lg md:w-20 md:text-2xl md:rounded-xl xl:w-28 xl:text-4xl xl:rounded-2xl 2xl:w-36 2xl:text-5xl",
};
const MINI_BOX_SIZES: Record<MiniSize, string> = {
  xs: "w-7 rounded-[4px]",
  sm: "w-10 rounded-md",
  md: "w-14 rounded-lg",
  lg: "w-20 rounded-xl",
  xl: "w-28 rounded-2xl",
  auto: "w-14 rounded-lg md:w-20 md:rounded-xl xl:w-28 xl:rounded-2xl 2xl:w-36",
};

/** Small inline card used on the board, the seat map and the display. */
export function MiniCard({ id, size = "md", className }: { id: string; size?: MiniSize; className?: string }) {
  const c = parseCard(id);
  const sizes = MINI_FACE_SIZES;
  return (
    <div
      className={cn(
        "card-face relative flex select-none flex-col justify-between border border-black/15 font-serif font-semibold shadow-card",
        c.color === "red" ? "text-card-red" : "text-card-black",
        sizes[size],
        className,
      )}
      style={{ aspectRatio: CARD_ASPECT, padding: "8% 10%" }}
      role="img"
      aria-label={c.name}
    >
      <span className="leading-none">{c.rankLabel}</span>
      <span className="self-end leading-none" aria-hidden>
        {c.suitSymbol}
      </span>
    </div>
  );
}

export function MiniCardBack({ size = "md", className }: { size?: MiniSize; className?: string }) {
  const sizes = MINI_BOX_SIZES;
  return <div className={cn("card-back border border-white/10 shadow-card", sizes[size], className)} style={{ aspectRatio: CARD_ASPECT }} aria-hidden />;
}

export function EmptyCardSlot({ size = "md", className }: { size?: MiniSize; className?: string }) {
  const sizes = MINI_BOX_SIZES;
  return <div className={cn("border border-dashed border-ivory-100/20", sizes[size], className)} style={{ aspectRatio: CARD_ASPECT }} aria-hidden />;
}
