import { cn } from "@/components/ui";
import type { ConnectionState } from "@/lib/realtime";

const META: Record<ConnectionState, { color: string; label: string }> = {
  connected: { color: "bg-status-ok", label: "Connected" },
  reconnecting: { color: "bg-status-warn pulse-soft", label: "Reconnecting" },
  offline: { color: "bg-status-bad", label: "Offline" },
};

export function ConnectionDot({ state, showLabel = false, className }: { state: ConnectionState; showLabel?: boolean; className?: string }) {
  const m = META[state];
  return (
    <span className={cn("inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-ivory-400", className)} title={m.label}>
      <span className={cn("h-2 w-2 rounded-full", m.color)} aria-hidden />
      <span className={showLabel ? "" : "sr-only"}>{m.label}</span>
    </span>
  );
}
