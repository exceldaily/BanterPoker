import { describe, expect, it } from "vitest";
import { blindsInForce, clockOffset, formatClock, remainingSeconds, timerView } from "@/lib/timer";
import type { SnapshotTournament } from "@/lib/types";

const levels: SnapshotTournament["levels"] = [
  { id: "l1", sortOrder: 1, type: "play", smallBlind: 25, bigBlind: 50, ante: 0, anteType: "none", durationSeconds: 1200 },
  { id: "b1", sortOrder: 2, type: "break", smallBlind: 0, bigBlind: 0, ante: 0, anteType: "none", durationSeconds: 600 },
  { id: "l2", sortOrder: 3, type: "play", smallBlind: 50, bigBlind: 100, ante: 10, anteType: "standard", durationSeconds: 900 },
];

function t(over: Partial<SnapshotTournament>): SnapshotTournament {
  return {
    levels,
    currentLevelId: "l1",
    timerStatus: "running",
    levelStartedAt: new Date(0).toISOString(),
    pausedAt: null,
    remainingAtPause: null,
    remainingSeconds: 0,
    pendingAdvance: false,
    serverNow: new Date(0).toISOString(),
    ...over,
  };
}

describe("remainingSeconds", () => {
  it("counts down from the authoritative start timestamp", () => {
    expect(remainingSeconds(t({}), 0)).toBe(1200);
    expect(remainingSeconds(t({}), 300_000)).toBe(900);
    expect(remainingSeconds(t({}), 2_000_000)).toBe(0);
  });
  it("is frozen while paused and zero when expired", () => {
    expect(remainingSeconds(t({ timerStatus: "paused", remainingAtPause: 321 }), 999_999_999)).toBe(321);
    expect(remainingSeconds(t({ timerStatus: "expired" }), 0)).toBe(0);
    expect(remainingSeconds(t({ timerStatus: "idle" }), 0)).toBe(1200);
  });
  it("is zero with no current level", () => {
    expect(remainingSeconds(t({ currentLevelId: null }), 0)).toBe(0);
  });
});

describe("timerView", () => {
  it("numbers play levels, flags breaks and exposes the next level", () => {
    const v = timerView(t({ currentLevelId: "b1" }), 0);
    expect(v.isBreak).toBe(true);
    expect(v.levelNumber).toBe(1);
    expect(v.nextLevel?.id).toBe("l2");
    const v2 = timerView(t({ currentLevelId: "l2" }), 0);
    expect(v2.levelNumber).toBe(2);
    expect(v2.nextLevel).toBeNull();
  });
});

describe("blindsInForce", () => {
  it("keeps the previous play level's blinds during a break", () => {
    expect(blindsInForce(t({ currentLevelId: "b1" }))?.id).toBe("l1");
    expect(blindsInForce(t({ currentLevelId: "l2" }))?.id).toBe("l2");
  });
});

describe("formatting and clock offset", () => {
  it("formats mm:ss and h:mm:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(59.2)).toBe("1:00");
  });
  it("computes the server clock offset", () => {
    expect(clockOffset(new Date(10_000).toISOString(), 4_000)).toBe(6_000);
    expect(clockOffset("garbage", 4_000)).toBe(0);
  });
});
