import { describe, expect, test } from "bun:test";

import { projectTimes, timingTable } from "./timing.ts";

describe("how long each project took", () => {
  test("wall time runs from the first start to the last end, busy time adds the tests up", () => {
    const times = projectTimes([
      { project: "flows", start: 1_000, duration: 4_000 },
      { project: "flows", start: 2_000, duration: 6_000 },
      { project: "routes", start: 0, duration: 500 },
    ]);
    expect(times).toEqual([
      { project: "flows", tests: 2, wallMs: 7_000, busyMs: 10_000 },
      { project: "routes", tests: 1, wallMs: 500, busyMs: 500 },
    ]);
  });

  test("the table puts the slowest project first and states the whole run", () => {
    const table = timingTable(
      [
        { project: "routes", tests: 1, wallMs: 500, busyMs: 500 },
        { project: "flows", tests: 2, wallMs: 7_000, busyMs: 10_000 },
      ],
      9_250
    );
    const lines = table.split("\n");
    expect(lines[4]).toBe("| flows | 2 | 7.0 | 10.0 |");
    expect(lines[5]).toBe("| routes | 1 | 0.5 | 0.5 |");
    expect(table).toContain("Whole run: 9.3 s.");
  });
});
