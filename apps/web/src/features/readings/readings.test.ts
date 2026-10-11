import { describe, expect, test } from "bun:test";
import type { Reading } from "@testate/shared";

import { changeOf, compareReadings, formatValue } from "./readings.compare.ts";
import { nextPicked, pickedReadings } from "./readings.presenter.ts";

const reading = (id: string, at: string, adapters: Reading["adapters"]): Reading => ({
  id,
  taken_at: at,
  actor: { kind: "user", label: "tina" },
  adapters,
});
const HOST = {
  adapter_id: "01991f00-0000-7000-8000-000000000020",
  name: "app-host",
  engine: "sftp",
  source: "host",
} as const;

const BEFORE = reading("r1", "2026-10-11T09:00:00.000Z", [
  {
    ...HOST,
    values: [
      { key: "load_1m", value: 0.5, unit: "load" },
      { key: "disk_free", value: 2 * 1024 ** 3, unit: "bytes" },
    ],
    unavailable: [{ key: "memory_total", reason: "/proc/meminfo has no MemTotal" }],
  },
]);
const AFTER = reading("r2", "2026-10-11T10:00:00.000Z", [
  {
    ...HOST,
    values: [
      { key: "load_1m", value: 3.25, unit: "load" },
      { key: "disk_free", value: 1024 ** 3, unit: "bytes" },
      { key: "memory_total", value: 4 * 1024 ** 3, unit: "bytes" },
    ],
    unavailable: [],
  },
]);

describe("two readings side by side (#38)", () => {
  test("lines up each value, and says not read where one side has none", () => {
    expect(compareReadings(BEFORE, AFTER)).toEqual([
      { adapter: "app-host", key: "load_1m", unit: "load", older: 0.5, newer: 3.25 },
      {
        adapter: "app-host",
        key: "disk_free",
        unit: "bytes",
        older: 2 * 1024 ** 3,
        newer: 1024 ** 3,
      },
      {
        adapter: "app-host",
        key: "memory_total",
        unit: "bytes",
        older: null,
        newer: 4 * 1024 ** 3,
      },
    ]);
  });

  test("states the change in the value's own unit", () => {
    expect(changeOf(0.5, 3.25, "load")).toBe("+2.75");
    expect(changeOf(10, 10, "count")).toBe("no change");
    expect(changeOf(null, 3, "count")).toBeNull();
    expect(changeOf(0.9, 0.95, "ratio")).toBe("+5.0%");
  });

  test("formats a duration a person reads at a glance", () => {
    expect(formatValue(915301, "seconds")).toBe("10 d 14 h");
    expect(formatValue(3720, "seconds")).toBe("1 h 2 min");
    // Two readings a few seconds apart: the uptime moved by seconds, not by "0 min".
    expect(changeOf(1860, 1891, "seconds")).toBe("+31 s");
  });
});

describe("picking readings", () => {
  test("keeps the last two, and a second click unpicks", () => {
    expect(nextPicked(["a", "b"], "c")).toEqual(["b", "c"]);
    expect(nextPicked(["a", "b"], "a")).toEqual(["b"]);
  });

  test("puts the older reading first, whatever order they were picked in", () => {
    expect(pickedReadings([AFTER, BEFORE], ["r2", "r1"]).map((item) => item.id)).toEqual([
      "r1",
      "r2",
    ]);
  });
});
