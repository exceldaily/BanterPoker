"use client";

import { ArrowDown, ArrowUp, Coffee, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Segmented, cn } from "@/components/ui";
import { breakLevel, formatDuration, generateStructure, playLevelNumber, roundBlind } from "@/lib/blinds";
import type { AnteType, LevelInput } from "@/lib/types";

// Full control over the blind structure: add, remove, reorder, edit blinds,
// antes, ante type and an independent duration for every level, plus breaks.

export function StructureEditor({ levels, onChange, compact }: { levels: LevelInput[]; onChange: (levels: LevelInput[]) => void; compact?: boolean }) {
  const [showGenerator, setShowGenerator] = useState(false);
  const [gen, setGen] = useState({ sb: 25, bb: 50, minutes: 20, count: 12, growth: 1.5, breakEvery: 4, breakMinutes: 10, anteType: "none" as AnteType, antesFrom: 4 });

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
  const addLevel = () => {
    const last = [...levels].reverse().find((l) => l.type === "play");
    const bb = last ? roundBlind(last.bigBlind * 1.5) : 50;
    onChange([
      ...levels,
      {
        type: "play",
        smallBlind: roundBlind(bb / 2),
        bigBlind: bb,
        ante: last?.anteType === "big_blind" ? bb : last?.anteType === "standard" ? roundBlind(bb / 8) : 0,
        anteType: last?.anteType ?? "none",
        durationSeconds: last?.durationSeconds ?? 1200,
      },
    ]);
  };
  const addBreak = () => onChange([...levels, breakLevel(10)]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={addLevel}>
          <Plus className="h-4 w-4" /> Level
        </Button>
        <Button size="sm" variant="secondary" onClick={addBreak}>
          <Coffee className="h-4 w-4" /> Break
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowGenerator((v) => !v)}>
          {showGenerator ? "Hide generator" : "Generate levels"}
        </Button>
      </div>

      {showGenerator ? (
        <div className="grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-charcoal-900/60 p-4 sm:grid-cols-3">
          <NumberField label="Start SB" value={gen.sb} onChange={(v) => setGen({ ...gen, sb: v })} />
          <NumberField label="Start BB" value={gen.bb} onChange={(v) => setGen({ ...gen, bb: v })} />
          <NumberField label="Minutes / level" value={gen.minutes} onChange={(v) => setGen({ ...gen, minutes: v })} />
          <NumberField label="Levels" value={gen.count} onChange={(v) => setGen({ ...gen, count: Math.min(40, v) })} />
          <NumberField label="Break every" value={gen.breakEvery} onChange={(v) => setGen({ ...gen, breakEvery: v })} hint="0 = none" />
          <NumberField label="Break minutes" value={gen.breakMinutes} onChange={(v) => setGen({ ...gen, breakMinutes: v })} />
          <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-400">Growth</span>
            <select
              className="h-11 rounded-xl border border-white/10 bg-charcoal-900 px-3 text-ivory-50"
              value={gen.growth}
              onChange={(e) => setGen({ ...gen, growth: Number(e.target.value) })}
            >
              <option value={1.25}>Gentle (x1.25)</option>
              <option value={1.5}>Standard (x1.5)</option>
              <option value={2}>Aggressive (x2)</option>
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-400">Antes</span>
            <select
              className="h-11 rounded-xl border border-white/10 bg-charcoal-900 px-3 text-ivory-50"
              value={gen.anteType}
              onChange={(e) => setGen({ ...gen, anteType: e.target.value as AnteType })}
            >
              <option value="none">No ante</option>
              <option value="standard">Standard ante</option>
              <option value="big_blind">Big blind ante</option>
            </select>
          </label>
          <NumberField label="Antes from level" value={gen.antesFrom} onChange={(v) => setGen({ ...gen, antesFrom: v })} />
          <div className="col-span-2 sm:col-span-3">
            <Button
              size="sm"
              block
              onClick={() => {
                onChange(
                  generateStructure({
                    startingSmallBlind: gen.sb,
                    startingBigBlind: gen.bb,
                    levelMinutes: gen.minutes,
                    levels: gen.count,
                    growth: gen.growth,
                    breakEvery: gen.breakEvery,
                    breakMinutes: gen.breakMinutes,
                    anteType: gen.anteType,
                    antesFromLevel: gen.antesFrom,
                  }),
                );
                setShowGenerator(false);
              }}
            >
              Replace structure with generated levels
            </Button>
          </div>
        </div>
      ) : null}

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
              <NumberField label="Minutes" value={Math.round(l.durationSeconds / 60)} onChange={(v) => update(i, { durationSeconds: Math.max(1, v) * 60 })} />
            ) : (
              <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-5")}>
                <NumberField label="Small" value={l.smallBlind} onChange={(v) => update(i, { smallBlind: v })} />
                <NumberField label="Big" value={l.bigBlind} onChange={(v) => update(i, { bigBlind: v })} />
                <NumberField label="Minutes" value={Math.round(l.durationSeconds / 60)} onChange={(v) => update(i, { durationSeconds: Math.max(1, v) * 60 })} />
                <div className="col-span-2 flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-400">Ante</span>
                  <div className="flex items-center gap-2">
                    <Segmented
                      size="sm"
                      value={l.anteType}
                      options={[
                        { value: "none", label: "None" },
                        { value: "standard", label: "Std" },
                        { value: "big_blind", label: "BB" },
                      ]}
                      onChange={(v) => update(i, { anteType: v, ante: v === "none" ? 0 : v === "big_blind" ? l.bigBlind : l.ante || roundBlind(l.bigBlind / 8) })}
                    />
                    {l.anteType !== "none" ? (
                      <input
                        type="number"
                        inputMode="numeric"
                        className="h-10 w-24 rounded-xl border border-white/10 bg-charcoal-900 px-3 text-ivory-50"
                        value={l.ante}
                        onChange={(e) => update(i, { ante: Math.max(0, Number(e.target.value) || 0) })}
                        aria-label="Ante amount"
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      {levels.length === 0 ? <p className="text-center text-sm text-ivory-600">No levels yet. Add one or generate a structure.</p> : null}
    </div>
  );
}

function NumberField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-400">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        className="h-11 w-full rounded-xl border border-white/10 bg-charcoal-900 px-3 text-ivory-50 focus:border-gold-400/60 focus:outline-none"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      />
      {hint ? <span className="text-[10px] text-ivory-600">{hint}</span> : null}
    </label>
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
