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
      <div className="absolute left-[7%] top-[5%] flex flex-col items-center font-serif" style={{ fontSize: "min(9cqw, 2.2rem)" }}>
        <span className="font-semibold leading-none">{c.rankLabel}</span>
        <SuitGlyph symbol={c.suitSymbol} className="mt-[0.1em] text-[0.9em]" />
      </div>
      <div className="absolute bottom-[5%] right-[7%] flex rotate-180 flex-col items-center font-serif" style={{ fontSize: "min(9cqw, 2.2rem)" }}>
        <span className="font-semibold leading-none">{c.rankLabel}</span>
        <SuitGlyph symbol={c.suitSymbol} className="mt-[0.1em] text-[0.9em]" />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <span className="font-serif opacity-90" style={{ fontSize: "min(38cqw, 9rem)" }} aria-hidden>
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

/** Small inline card used on the board, the seat map and the display. */
export function MiniCard({ id, size = "md", className }: { id: string; size?: "xs" | "sm" | "md" | "lg" | "xl"; className?: string }) {
  const c = parseCard(id);
  const sizes = {
    xs: "w-7 text-[11px] rounded-[4px]",
    sm: "w-10 text-sm rounded-md",
    md: "w-14 text-lg rounded-lg",
    lg: "w-20 text-2xl rounded-xl",
    xl: "w-28 text-4xl rounded-2xl",
  };
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

export function MiniCardBack({ size = "md", className }: { size?: "xs" | "sm" | "md" | "lg" | "xl"; className?: string }) {
  const sizes = { xs: "w-7 rounded-[4px]", sm: "w-10 rounded-md", md: "w-14 rounded-lg", lg: "w-20 rounded-xl", xl: "w-28 rounded-2xl" };
  return <div className={cn("card-back border border-white/10 shadow-card", sizes[size], className)} style={{ aspectRatio: CARD_ASPECT }} aria-hidden />;
}

export function EmptyCardSlot({ size = "md", className }: { size?: "xs" | "sm" | "md" | "lg" | "xl"; className?: string }) {
  const sizes = { xs: "w-7 rounded-[4px]", sm: "w-10 rounded-md", md: "w-14 rounded-lg", lg: "w-20 rounded-xl", xl: "w-28 rounded-2xl" };
  return <div className={cn("border border-dashed border-ivory-100/20", sizes[size], className)} style={{ aspectRatio: CARD_ASPECT }} aria-hidden />;
}
