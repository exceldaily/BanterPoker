import type { SnapshotLevel, SnapshotTournament } from "@/lib/types";

// Client-side countdown math. The server stores authoritative timestamps
// (level_started_at, paused state); every device derives the visible clock
// from those plus a measured clock offset, so nothing ticks over the network.

export interface TimerView {
  level: SnapshotLevel | null;
  levelIndex: number;
  /** 1-based number counting only play levels (breaks do not count). */
  levelNumber: number;
  nextLevel: SnapshotLevel | null;
  remainingSeconds: number;
  status: SnapshotTournament["timerStatus"];
  isBreak: boolean;
  pendingAdvance: boolean;
}

/** Milliseconds to add to Date.now() to approximate the server clock. */
export function clockOffset(serverNowIso: string, receivedAt = Date.now()): number {
  const server = Date.parse(serverNowIso);
  if (Number.isNaN(server)) return 0;
  return server - receivedAt;
}

export function remainingSeconds(t: SnapshotTournament, nowMs: number): number {
  const level = t.levels.find((l) => l.id === t.currentLevelId) ?? null;
  if (!level) return 0;
  switch (t.timerStatus) {
    case "running": {
      const started = t.levelStartedAt ? Date.parse(t.levelStartedAt) : nowMs;
      const elapsed = (nowMs - started) / 1000;
      return Math.max(0, level.durationSeconds - elapsed);
    }
    case "paused":
      return t.remainingAtPause ?? level.durationSeconds;
    case "expired":
      return 0;
    case "idle":
    default:
      return level.durationSeconds;
  }
}

export function timerView(t: SnapshotTournament, nowMs: number): TimerView {
  const idx = t.levels.findIndex((l) => l.id === t.currentLevelId);
  const level = idx >= 0 ? t.levels[idx]! : null;
  let levelNumber = 0;
  for (let i = 0; i <= idx; i++) if (t.levels[i]!.type === "play") levelNumber++;
  return {
    level,
    levelIndex: idx,
    levelNumber,
    nextLevel: idx >= 0 && idx + 1 < t.levels.length ? t.levels[idx + 1]! : null,
    remainingSeconds: remainingSeconds(t, nowMs),
    status: t.timerStatus,
    isBreak: level?.type === "break",
    pendingAdvance: t.pendingAdvance,
  };
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0 ? `${h}:${mm}:${String(sec).padStart(2, "0")}` : `${mm}:${String(sec).padStart(2, "0")}`;
}

/** Blinds currently in force: the last play level at or before the current index (breaks keep blinds). */
export function blindsInForce(t: SnapshotTournament): SnapshotLevel | null {
  const idx = t.levels.findIndex((l) => l.id === t.currentLevelId);
  for (let i = idx; i >= 0; i--) {
    if (t.levels[i]!.type === "play") return t.levels[i]!;
  }
  return null;
}
