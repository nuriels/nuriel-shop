import { describe, expect, it } from "vitest";
import {
  SIGNATURE_HEIGHT,
  SIGNATURE_WIDTH,
  padPoint,
  pathPoints,
  validSignaturePaths,
} from "@/engines/hospitality/contracts/signature";

// לוח החתימה: מיפוי המסך לתחום 600×200 שהמסד בודק — בכל צורת לוח (3:1 במחשב, 3:2 בטלפון)
const xy = (s: string) => s.split(",").map(Number) as [number, number];

describe("padPoint — the signature pad mapping", () => {
  it("a 3:1 pad maps exactly as before (x/w·600, y/h·200)", () => {
    for (const [w, h] of [
      [600, 200],
      [900, 300],
      [330, 110],
    ] as const)
      for (const [x, y] of [
        [0, 0],
        [w / 2, h / 2],
        [w, h],
        [w * 0.13, h * 0.77],
      ] as [number, number][])
        expect(padPoint(x, y, w, h)).toBe(
          `${Math.round((x / w) * SIGNATURE_WIDTH)},${Math.round((y / h) * SIGNATURE_HEIGHT)}`,
        );
  });

  it("a taller phone pad (3:2) fills the full height, centered across — proportions kept", () => {
    const [w, h] = [330, 220]; // k = 200/220, the visible band is x 150..450
    expect(padPoint(0, 0, w, h)).toBe("150,0");
    expect(padPoint(w, h, w, h)).toBe("450,200");
    expect(padPoint(w / 2, h / 2, w, h)).toBe("300,100");
    // a 100×100 px square stays a square
    const [ax, ay] = xy(padPoint(50, 50, w, h));
    const [bx, by] = xy(padPoint(150, 150, w, h));
    expect(Math.abs(bx - ax - (by - ay))).toBeLessThanOrEqual(1);
  });

  it("a finger that leaves the pad is held at its edge — no ink outside what the signer sees", () => {
    const [w, h] = [302, 201];
    const k = Math.min(SIGNATURE_WIDTH / w, SIGNATURE_HEIGHT / h);
    const [left, right] = [(SIGNATURE_WIDTH - w * k) / 2, (SIGNATURE_WIDTH + w * k) / 2];
    for (const [x, y] of [
      [-80, 300],
      [999, -40],
      [-1, -1],
      [w + 30, h / 2],
    ] as [number, number][]) {
      const [px, py] = xy(padPoint(x, y, w, h));
      expect(px).toBeGreaterThanOrEqual(Math.floor(left));
      expect(px).toBeLessThanOrEqual(Math.ceil(right));
      expect(py).toBeGreaterThanOrEqual(0);
      expect(py).toBeLessThanOrEqual(SIGNATURE_HEIGHT);
    }
  });

  it("every mapped stroke is a path the database accepts", () => {
    for (const [w, h] of [
      [360, 240],
      [302, 201],
      [1200, 400],
      [280, 256],
    ] as const) {
      const pts = Array.from({ length: 40 }, (_, i) =>
        padPoint((i / 39) * w * 1.4 - w * 0.2, Math.sin(i) * h, w, h),
      );
      const path = `M${pts[0]} ${pts
        .slice(1)
        .map((p) => `L${p}`)
        .join(" ")}`;
      expect(validSignaturePaths([path]), `${w}×${h}`).toBe(true);
      for (const [x, y] of pathPoints(path)) {
        expect(x).toBeLessThanOrEqual(SIGNATURE_WIDTH);
        expect(y).toBeLessThanOrEqual(SIGNATURE_HEIGHT);
      }
    }
  });
});
