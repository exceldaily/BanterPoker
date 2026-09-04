"use client";

import { ArrowDown, ArrowUp, Coffee, Plus, Trash2 } from "lucide-react";
import { Button, NumberInput, Segmented, cn } from "@/components/ui";
import { appendDoubledLevel, breakLevel, doubleAllBlinds, formatDuration, playLevelNumber, roundBlind } from "@/lib/blinds";
import type { LevelInput } from "@/lib/types";

// Full control over the blind structure: add, remove, reorder, edit blinds,
// antes, ante type and an independent duration for every level, plus breaks.
// The two "double" buttons cover the way most home games actually run:
// play a timed level, then double the blinds.

export function StructureEditor({ levels, onChange, compact }: { levels: LevelInput[]; onChange: (levels: LevelInput[]) => void; compact?: boolean }) {
  const update = (i: number, patch: Partial<LevelInput>) => {
    onChange(levels.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };
  const remove = (i: number) => onChange(levels.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= levels.length) return;
    const next = levels.slice();
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
    onChange(next);
  };
  const addBreak = () => onChange([...levels, breakLevel(10)]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="gold" onClick={() => onChange(appendDoubledLevel(levels))}>
          <Plus className="h-4 w-4" /> Add level (double last)
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onChange(doubleAllBlinds(levels))} disabled={levels.every((l) => l.type === "break")}>
          Double all blinds
        </Button>
        <Button size="sm" variant="secondary" onClick={addBreak}>
          <Coffee className="h-4 w-4" /> Add break
        </Button>
      </div>

      <ol className="flex flex-col gap-2">
        {levels.map((l, i) => (
          <li key={i} className={cn("rounded-2xl border p-3", l.type === "break" ? "border-gold-400/30 bg-gold-500/5" : "border-white/10 bg-charcoal-900/60")}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ivory-400">
                {l.type === "break" ? "Break" : `Level ${playLevelNumber(levels, i)}`}
                <span className="ml-2 text-ivory-600">{formatDuration(l.durationSeconds)}</span>
              </span>
              <span className="flex items-center gap-1">
                <IconButton label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                  <ArrowUp className="h-4 w-4" />
                </IconButton>
                <IconButton label="Move down" onClick={() => move(i, 1)} disabled={i === levels.length - 1}>
                  <ArrowDown className="h-4 w-4" />
                </IconButton>
                <IconButton label="Remove" onClick={() => remove(i)} danger>
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </span>
            </div>
            {l.type === "break" ? (
              <NumberInput size="sm" label="Minutes" min={1} max={600} value={Math.round(l.durationSeconds / 60)} onChange={(v) => update(i, { durationSeconds: v * 60 })} />
            ) : (
              <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-5")}>
                <NumberInput size="sm" label="Small" value={l.smallBlind} onChange={(v) => update(i, { smallBlind: v })} />
                <NumberInput size="sm" label="Big" value={l.bigBlind} onChange={(v) => update(i, { bigBlind: v, ante: l.anteType === "big_blind" ? v : l.ante })} />
                <NumberInput size="sm" label="Minutes" min={1} max={600} value={Math.round(l.durationSeconds / 60)} onChange={(v) => update(i, { durationSeconds: v * 60 })} />
                <div className="col-span-2 flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-400">Ante</span>
                  <div className="flex items-center gap-2">
                    <Segmented
                      size="sm"
                      value={l.anteType}
                      options={[
                        { value: "none", label: "None" },
                        { value: "standard", label: "Each" },
                        { value: "big_blind", label: "BB" },
                      ]}
                      onChange={(v) => update(i, { anteType: v, ante: v === "none" ? 0 : v === "big_blind" ? l.bigBlind : l.ante || roundBlind(l.bigBlind / 8) })}
                    />
                    {l.anteType === "standard" ? (
                      <NumberInput size="sm" value={l.ante} onChange={(v) => update(i, { ante: v })} className="w-24" />
                    ) : l.anteType === "big_blind" ? (
                      <span className="text-sm text-ivory-400">= {l.bigBlind}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      {levels.length === 0 ? <p className="text-center text-sm text-ivory-600">No levels yet. Add one above.</p> : null}
    </div>
  );
}

function IconButton({ children, label, onClick, disabled, danger }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn("flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-ivory-300 hover:bg-white/5 disabled:opacity-30", danger && "hover:text-status-bad")}
    >
      {children}
    </button>
  );
}
