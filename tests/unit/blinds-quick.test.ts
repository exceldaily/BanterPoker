import { describe, expect, it } from "vitest";
import { DEFAULT_QUICK_SETUP, appendDoubledLevel, breakLevel, doubleAllBlinds, doubleBlindsFrom, quickStructure } from "@/lib/blinds";
import type { LevelInput } from "@/lib/types";

const L = (sb: number, bb: number, ante = 0, anteType: LevelInput["anteType"] = "none"): LevelInput => ({ type: "play", smallBlind: sb, bigBlind: bb, ante, anteType, durationSeconds: 1200 });

describe("quickStructure (timed intervals, blinds double)", () => {
  it("doubles exactly every level with no rounding", () => {
    const levels = quickStructure({ ...DEFAULT_QUICK_SETUP, smallBlind: 25, bigBlind: 50, levels: 5, minutes: 15 });
    expect(levels.map((l) => [l.smallBlind, l.bigBlind])).toEqual([
      [25, 50],
      [50, 100],
      [100, 200],
      [200, 400],
      [400, 800],
    ]);
    for (const l of levels) expect(l.durationSeconds).toBe(900);
  });

  it("adds big blind antes from the chosen level and breaks on schedule", () => {
    const levels = quickStructure({ ...DEFAULT_QUICK_SETUP, levels: 6, anteType: "big_blind", antesFromLevel: 3, breakEvery: 3, breakMinutes: 5 });
    const play = levels.filter((l) => l.type === "play");
    expect(play[1]!.anteType).toBe("none");
    expect(play[2]!.anteType).toBe("big_blind");
    expect(play[2]!.ante).toBe(play[2]!.bigBlind);
    expect(levels.filter((l) => l.type === "break")).toHaveLength(1);
    expect(levels[3]!.type).toBe("break");
    expect(levels[3]!.durationSeconds).toBe(300);
  });

  it("gentle growth rounds to friendly numbers", () => {
    const levels = quickStructure({ ...DEFAULT_QUICK_SETUP, growth: "gentle", levels: 4 });
    expect(levels.map((l) => l.bigBlind)).toEqual([50, 75, 100, 150]);
  });
});

describe("double buttons", () => {
  it("doubleAllBlinds doubles every play level, keeps breaks, tracks big blind antes", () => {
    const out = doubleAllBlinds([L(25, 50), breakLevel(10), L(100, 200, 200, "big_blind"), L(150, 300, 25, "standard")]);
    expect(out[0]).toMatchObject({ smallBlind: 50, bigBlind: 100, ante: 0 });
    expect(out[1]!.type).toBe("break");
    expect(out[2]).toMatchObject({ smallBlind: 200, bigBlind: 400, ante: 400 });
    expect(out[3]).toMatchObject({ smallBlind: 300, bigBlind: 600, ante: 50 });
  });

  it("doubleBlindsFrom leaves earlier levels alone", () => {
    const out = doubleBlindsFrom([L(25, 50), L(50, 100), L(100, 200)], 1);
    expect(out.map((l) => l.bigBlind)).toEqual([50, 200, 400]);
  });

  it("appendDoubledLevel adds one level at double the last play level", () => {
    const out = appendDoubledLevel([L(25, 50), breakLevel(10)]);
    expect(out).toHaveLength(3);
    expect(out[2]).toMatchObject({ type: "play", smallBlind: 50, bigBlind: 100, durationSeconds: 1200 });
    const withAnte = appendDoubledLevel([L(100, 200, 200, "big_blind")]);
    expect(withAnte[1]).toMatchObject({ bigBlind: 400, ante: 400, anteType: "big_blind" });
    expect(appendDoubledLevel([])[0]).toMatchObject({ smallBlind: 25, bigBlind: 50 });
  });
});
