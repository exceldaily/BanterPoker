import { cn } from "@/lib/cn";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("h-10 w-10", className)} aria-hidden>
      <defs>
        <linearGradient id="bp-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d9c391" />
          <stop offset="1" stopColor="#b3944f" />
        </linearGradient>
      </defs>
      <rect x="6" y="10" width="34" height="46" rx="5" fill="#f4efe3" transform="rotate(-12 23 33)" />
      <rect x="24" y="8" width="34" height="46" rx="5" fill="#fbf8f1" stroke="url(#bp-gold)" strokeWidth="1.5" transform="rotate(8 41 31)" />
      <path d="M41 20c-4 6-9 9-9 14a7 7 0 0 0 13 3 7 7 0 0 0 13-3c0-5-5-8-9-14h-8z" fill="#161616" transform="translate(-4 4) scale(0.75) translate(10 6)" />
    </svg>
  );
}

export function Wordmark({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "text-xl", md: "text-3xl", lg: "text-5xl" };
  return (
    <span className={cn("font-serif tracking-tight text-ivory-50", sizes[size], className)}>
      Banter <span className="text-gold-400">Poker</span>
    </span>
  );
}
