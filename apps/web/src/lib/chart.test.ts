import { describe, expect, it } from "bun:test";

import { fractionOf, nearest, niceMax, niceMaxBytes, pathOf } from "./chart.ts";

const SCALE = { from: 0, to: 600_000, max: 100 };

describe("chart geometry (#101)", () => {
  it("ends the value axis on a round number at or above the highest value", () => {
    expect([0, 0.3, 7, 12, 26, 99, 100, 101, 4200].map(niceMax)).toEqual([
      1, 0.5, 10, 20, 50, 100, 100, 200, 5000,
    ]);
  });

  it("ends a byte axis on a round count of KB, MB or GB", () => {
    expect([500, 9_961_472, 200_000].map(niceMaxBytes)).toEqual([500, 10_485_760, 204_800]);
  });

  it("draws one line through samples a step apart, and lifts the pen over a gap", () => {
    const points = [
      { t: 0, v: 0 },
      { t: 60_000, v: 50 },
      { t: 120_000, v: 100 },
      { t: 480_000, v: 50 },
    ];
    expect(pathOf(points, SCALE, 60_000)).toBe("M0.0,160.0L60.0,80.0L120.0,0.0M480.0,80.0");
  });

  it("keeps a value past the axis inside the chart", () => {
    expect(pathOf([{ t: 0, v: 250 }], SCALE, 60_000)).toBe("M0.0,0.0");
  });

  it("finds the sample nearest the pointer, and where it sits across the chart", () => {
    const points = [
      { t: 0, v: 1 },
      { t: 60_000, v: 2 },
      { t: 120_000, v: 3 },
    ];
    expect(nearest(points, 80_000)).toEqual({ t: 60_000, v: 2 });
    expect(nearest([], 80_000)).toBeNull();
    expect(fractionOf(300_000, SCALE)).toBe(0.5);
  });
});
