import { describe, expect, test } from "bun:test";

import { describeCapacity, workersFor } from "./capacity.ts";

describe("how many browser tabs the suite runs at once", () => {
  test("a CI runner takes one per core, four at most", () => {
    expect(workersFor({ cpus: 2, load1: 0, totalGiB: 7, ci: true })).toBe(2);
    expect(workersFor({ cpus: 16, load1: 0, totalGiB: 64, ci: true })).toBe(4);
  });

  test("a laptop takes half its cores, less when busy or short of memory, never none", () => {
    expect(workersFor({ cpus: 8, load1: 1, totalGiB: 16, ci: false })).toBe(4);
    // The engines and Vite already running: load over 70% of the cores costs one.
    expect(workersFor({ cpus: 8, load1: 6, totalGiB: 16, ci: false })).toBe(3);
    // 8 GiB holds five engines and Chromium both: two tabs at most, one when busy as well.
    expect(workersFor({ cpus: 8, load1: 1, totalGiB: 8, ci: false })).toBe(2);
    expect(workersFor({ cpus: 8, load1: 6, totalGiB: 8, ci: false })).toBe(2);
    expect(workersFor({ cpus: 2, load1: 3, totalGiB: 4, ci: false })).toBe(1);
  });

  test("E2E_WORKERS wins when it is a whole number from 1 to 8, and is ignored otherwise", () => {
    expect(workersFor({ cpus: 8, load1: 0, totalGiB: 16, ci: false, override: "1" })).toBe(1);
    expect(workersFor({ cpus: 2, load1: 0, totalGiB: 4, ci: true, override: "6" })).toBe(6);
    expect(workersFor({ cpus: 8, load1: 0, totalGiB: 16, ci: false, override: "lots" })).toBe(4);
    expect(workersFor({ cpus: 8, load1: 0, totalGiB: 16, ci: false, override: "0" })).toBe(4);
  });

  test("the console line names every input and the answer", () => {
    expect(describeCapacity({ cpus: 8, load1: 2.33, totalGiB: 8, ci: false }, 2)).toBe(
      "e2e: 8 cores, load 2.3, 8 GiB, ci=no → 2 workers"
    );
    expect(
      describeCapacity({ cpus: 8, load1: 0, totalGiB: 8, ci: false, override: "3" }, 3)
    ).toContain("(E2E_WORKERS)");
  });
});
