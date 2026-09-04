import type { AnteType, LevelInput } from "@/lib/types";

// Blind structure presets and a progression generator. Presets are only a
// starting point: the host can add, remove, reorder and edit every level.

export type PresetKey = "casual" | "slow" | "standard" | "turbo" | "custom";

export interface PresetMeta {
  key: PresetKey;
  label: string;
  description: string;
}

export const PRESETS: PresetMeta[] = [
  { key: "casual", label: "Casual", description: "Long levels, gentle climb. A relaxed evening." },
  { key: "slow", label: "Slow", description: "25 minute levels with breaks. Deep-stack feel." },
  { key: "standard", label: "Standard", description: "20 minute levels, antes from level 4." },
  { key: "turbo", label: "Turbo", description: "10 minute levels. Done in a couple of hours." },
  { key: "custom", label: "Custom", description: "Start from scratch and build your own." },
];

function level(smallBlind: number, bigBlind: number, minutes: number, ante = 0, anteType: AnteType = "none"): LevelInput {
  return { type: "play", smallBlind, bigBlind, ante, anteType, durationSeconds: minutes * 60 };
}

export function breakLevel(minutes: number): LevelInput {
  return { type: "break", smallBlind: 0, bigBlind: 0, ante: 0, anteType: "none", durationSeconds: minutes * 60 };
}

/** Rounds to a "poker-friendly" chip number (25, 50, 75, 100, 150, 200, 300, 400, 500...). */
export function roundBlind(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10];
  let best = steps[0]!;
  let bestDiff = Infinity;
  for (const s of steps) {
    const d = Math.abs(normalized - s);
    if (d < bestDiff) {
      bestDiff = d;
      best = s;
    }
  }
  return Math.round(best * magnitude);
}

export interface GenerateOptions {
  startingSmallBlind: number;
  startingBigBlind: number;
  startingAnte?: number;
  anteType?: AnteType;
  levelMinutes: number;
  levels: number;
  /** Multiply blinds by roughly this factor each level (1.5 = gentle, 2 = aggressive). */
  growth?: number;
  /** Insert a break of this many minutes every N levels (0 disables). */
  breakEvery?: number;
  breakMinutes?: number;
  /** Start antes (as a fraction of the big blind) from this level number (1-based). */
  antesFromLevel?: number;
}

/** Generates a reasonable progression that the host can then edit by hand. */
export function generateStructure(opts: GenerateOptions): LevelInput[] {
  const out: LevelInput[] = [];
  const growth = opts.growth ?? 1.5;
  const anteType: AnteType = opts.anteType ?? "none";
  let sb = opts.startingSmallBlind;
  let bb = opts.startingBigBlind;
  for (let i = 1; i <= opts.levels; i++) {
    let ante = 0;
    let type: AnteType = "none";
    if (i === 1 && (opts.startingAnte ?? 0) > 0 && anteType !== "none") {
      ante = opts.startingAnte!;
      type = anteType;
    } else if (anteType !== "none" && opts.antesFromLevel && i >= opts.antesFromLevel) {
      type = anteType;
      ante = anteType === "big_blind" ? bb : roundBlind(bb / 8);
    }
    out.push(level(sb, bb, opts.levelMinutes, ante, type));
    if (opts.breakEvery && opts.breakEvery > 0 && i % opts.breakEvery === 0 && i < opts.levels) {
      out.push(breakLevel(opts.breakMinutes ?? 10));
    }
    bb = roundBlind(bb * growth);
    sb = roundBlind(bb / 2);
  }
  return out;
}

export function presetLevels(key: PresetKey): LevelInput[] {
  switch (key) {
    case "casual":
      return [
        level(25, 50, 30), level(50, 100, 30), level(75, 150, 30), level(100, 200, 25),
        breakLevel(10),
        level(150, 300, 25), level(200, 400, 25, 50, "standard"), level(300, 600, 20, 75, "standard"),
        level(400, 800, 20, 100, "standard"), level(500, 1000, 20, 100, "standard"),
        breakLevel(10),
        level(600, 1200, 20, 200, "standard"), level(800, 1600, 20, 200, "standard"),
        level(1000, 2000, 20, 300, "standard"), level(1500, 3000, 20, 500, "standard"),
      ];
    case "slow":
      return [
        level(25, 50, 25), level(50, 100, 25), level(75, 150, 25), level(100, 200, 25),
        breakLevel(10),
        level(150, 300, 25), level(200, 400, 25, 400, "big_blind"), level(250, 500, 25, 500, "big_blind"),
        level(300, 600, 25, 600, "big_blind"),
        breakLevel(10),
        level(400, 800, 25, 800, "big_blind"), level(500, 1000, 25, 1000, "big_blind"),
        level(600, 1200, 25, 1200, "big_blind"), level(800, 1600, 25, 1600, "big_blind"),
        level(1000, 2000, 25, 2000, "big_blind"), level(1500, 3000, 25, 3000, "big_blind"),
      ];
    case "standard":
      return [
        level(25, 50, 20), level(50, 100, 20), level(75, 150, 20), level(100, 200, 20, 25, "standard"),
        breakLevel(10),
        level(150, 300, 20, 25, "standard"), level(200, 400, 20, 50, "standard"), level(300, 600, 20, 75, "standard"),
        level(400, 800, 20, 100, "standard"),
        breakLevel(10),
        level(500, 1000, 20, 100, "standard"), level(600, 1200, 20, 200, "standard"), level(800, 1600, 20, 200, "standard"),
        level(1000, 2000, 20, 300, "standard"), level(1500, 3000, 20, 500, "standard"), level(2000, 4000, 20, 500, "standard"),
      ];
    case "turbo":
      return [
        level(25, 50, 10), level(50, 100, 10), level(100, 200, 10), level(150, 300, 10, 300, "big_blind"),
        level(200, 400, 10, 400, "big_blind"), level(300, 600, 10, 600, "big_blind"),
        breakLevel(5),
        level(400, 800, 10, 800, "big_blind"), level(600, 1200, 10, 1200, "big_blind"), level(800, 1600, 10, 1600, "big_blind"),
        level(1000, 2000, 10, 2000, "big_blind"), level(1500, 3000, 10, 3000, "big_blind"), level(2000, 4000, 10, 4000, "big_blind"),
      ];
    case "custom":
    default:
      return [level(25, 50, 20)];
  }
}

export function formatChips(n: number): string {
  return n.toLocaleString("en-US");
}

/** "25 / 50", "Break", etc. */
export function levelLabel(l: Pick<LevelInput, "type" | "smallBlind" | "bigBlind">): string {
  if (l.type === "break") return "Break";
  return `${formatChips(l.smallBlind)} / ${formatChips(l.bigBlind)}`;
}

/** "Ante 25", "BB Ante 200" or "" */
export function anteLabel(l: Pick<LevelInput, "type" | "ante" | "anteType" | "bigBlind">): string {
  if (l.type === "break" || l.anteType === "none" || l.ante <= 0) return "";
  if (l.anteType === "big_blind") return `BB Ante ${formatChips(l.ante || l.bigBlind)}`;
  return `Ante ${formatChips(l.ante)}`;
}

export function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/** Number of "play" levels before (and including) index i, for level numbering that skips breaks. */
export function playLevelNumber(levels: readonly Pick<LevelInput, "type">[], index: number): number {
  let n = 0;
  for (let i = 0; i <= index && i < levels.length; i++) {
    if (levels[i]!.type === "play") n++;
  }
  return n;
}
