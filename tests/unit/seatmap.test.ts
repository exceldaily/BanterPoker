import { describe, expect, it } from "vitest";
import { seatPositions } from "@/components/SeatMap";

describe("oval table seat positions", () => {
  it("places n seats inside the box, clockwise from the top-left, symmetrically", () => {
    for (let n = 2; n <= 12; n++) {
      const pts = seatPositions(n);
      expect(pts).toHaveLength(n);
      for (const p of pts) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(100);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(100);
      }
      // Seat 1 is the first chair left of top centre; seat 2 mirrors it on the right.
      expect(pts[0]!.x).toBeLessThan(50);
      expect(pts[1]!.x).toBeGreaterThan(50);
      expect(Math.abs(pts[0]!.y - pts[1]!.y)).toBeLessThan(0.5);
      // Left-right symmetry: mirror seat i across the vertical axis lands on another seat.
      for (const p of pts) {
        const mirror = pts.find((q) => Math.abs(q.x - (100 - p.x)) < 0.5 && Math.abs(q.y - p.y) < 0.5);
        expect(mirror).toBeDefined();
      }
    }
  });

  it("orders seats clockwise (angle around the centre increases monotonically)", () => {
    const pts = seatPositions(9);
    const angles = pts.map((p) => Math.atan2(p.y - 50, (p.x - 50) * 2));
    let wraps = 0;
    for (let i = 1; i < angles.length; i++) {
      if (angles[i]! < angles[i - 1]!) wraps++;
    }
    expect(wraps).toBeLessThanOrEqual(1);
  });
});
