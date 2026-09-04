import { describe, expect, it } from "vitest";
import { anteLabel, formatDuration, generateStructure, levelLabel, playLevelNumber, presetLevels, roundBlind } from "@/lib/blinds";

describe("roundBlind", () => {
  it("rounds to poker-friendly amounts", () => {
    expect(roundBlind(37)).toBe(40);
    expect(roundBlind(75)).toBe(75);
    expect(roundBlind(112)).toBe(100);
    expect(roundBlind(140)).toBe(150);
    expect(roundBlind(0)).toBe(0);
  });
});

describe("presets", () => {
  it("every preset has valid, increasing play levels and per-level durations", () => {
    for (const key of ["casual", "slow", "standard", "turbo"] as const) {
      const levels = presetLevels(key);
      expect(levels.length).toBeGreaterThan(5);
      let lastBb = 0;
      for (const l of levels) {
        expect(l.durationSeconds).toBeGreaterThanOrEqual(60);
        if (l.type === "play") {
          expect(l.bigBlind).toBeGreaterThan(lastBb);
          expect(l.smallBlind).toBeLessThanOrEqual(l.bigBlind);
          if (l.anteType === "none") expect(l.ante).toBe(0);
          if (l.anteType === "big_blind") expect(l.ante).toBe(l.bigBlind);
          lastBb = l.bigBlind;
        }
      }
    }
  });
  it("custom starts with one editable level", () => {
    expect(presetLevels("custom")).toHaveLength(1);
  });
});

describe("generateStructure", () => {
  it("grows blinds, inserts breaks and starts antes at the requested level", () => {
    const levels = generateStructure({ startingSmallBlind: 25, startingBigBlind: 50, levelMinutes: 15, levels: 6, growth: 2, breakEvery: 3, breakMinutes: 5, anteType: "standard", antesFromLevel: 4 });
    const play = levels.filter((l) => l.type === "play");
    expect(play).toHaveLength(6);
    expect(levels.filter((l) => l.type === "break")).toHaveLength(1);
    expect(play[0]).toMatchObject({ smallBlind: 25, bigBlind: 50, ante: 0, anteType: "none", durationSeconds: 900 });
    expect(play[1]!.bigBlind).toBe(100);
    expect(play[3]!.anteType).toBe("standard");
    expect(play[3]!.ante).toBeGreaterThan(0);
    expect(play[2]!.anteType).toBe("none");
  });
  it("supports big blind antes", () => {
    const levels = generateStructure({ startingSmallBlind: 100, startingBigBlind: 200, levelMinutes: 20, levels: 3, anteType: "big_blind", antesFromLevel: 1 });
    for (const l of levels) expect(l.ante).toBe(l.bigBlind);
  });
});

describe("labels", () => {
  it("formats blinds, antes and durations", () => {
    expect(levelLabel({ type: "play", smallBlind: 1000, bigBlind: 2000 })).toBe("1,000 / 2,000");
    expect(levelLabel({ type: "break", smallBlind: 0, bigBlind: 0 })).toBe("Break");
    expect(anteLabel({ type: "play", ante: 25, anteType: "standard", bigBlind: 200 })).toBe("Ante 25");
    expect(anteLabel({ type: "play", ante: 200, anteType: "big_blind", bigBlind: 200 })).toBe("BB Ante 200");
    expect(anteLabel({ type: "play", ante: 0, anteType: "none", bigBlind: 200 })).toBe("");
    expect(formatDuration(1200)).toBe("20m");
    expect(formatDuration(5400)).toBe("1h 30m");
  });
  it("numbers play levels while skipping breaks", () => {
    const levels = [{ type: "play" }, { type: "break" }, { type: "play" }, { type: "play" }] as const;
    expect(playLevelNumber(levels, 0)).toBe(1);
    expect(playLevelNumber(levels, 2)).toBe(2);
    expect(playLevelNumber(levels, 3)).toBe(3);
  });
});
