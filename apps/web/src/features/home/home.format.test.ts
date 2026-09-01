import { describe, expect, test } from "bun:test";
import type { HealthAdmin } from "@testate/shared";

import { attention, greeting, since, uptime } from "./home.format.ts";

const check = (status: "ok" | "degraded" | "down") => ({ status });
// SAFETY: the literal below carries every field `healthAdminSchema` parses; the assertion only
// lets one test spread a partial `checks` over it without restating the other five.
const health = (overrides: Partial<HealthAdmin["checks"]>): HealthAdmin =>
  ({
    status: "ok",
    version: "1.1.0",
    boot_id: "b",
    uptime_s: 10,
    env: "development",
    checks: {
      metadata_db: { ...check("ok"), latency_ms: 1 },
      data_dir: { ...check("ok"), free_bytes: 1 },
      snapshot_store: { ...check("ok"), driver: "local", latency_ms: 1 },
      dispatcher: { ...check("ok"), running: 0, queued: 0, last_tick_at: null },
      log_sink: check("ok"),
      sealed_keys: { ...check("ok"), active_fingerprint: "f", extra_values: 0 },
      ...overrides,
    },
  }) as HealthAdmin;

describe("what the home page has to work out for itself", () => {
  test("the window is a day back from now, as a full timestamp and not a bare day", () => {
    // A bare local day against UTC timestamps is off by the reader's own timezone.
    const now = new Date("2026-09-02T03:00:00.000Z");
    expect(since(now)).toBe("2026-09-01T03:00:00.000Z");
    expect(since(now, 1)).toBe("2026-09-02T02:00:00.000Z");
  });

  test("the greeting follows the clock on the reader's machine", () => {
    expect(greeting(new Date(2026, 8, 2, 9))).toBe("Good morning");
    expect(greeting(new Date(2026, 8, 2, 13))).toBe("Good afternoon");
    expect(greeting(new Date(2026, 8, 2, 21))).toBe("Good evening");
  });

  test("nothing wrong means nothing to say, so the card can stay quiet", () => {
    expect(attention(0, null)).toEqual([]);
    expect(attention(0, health({}))).toEqual([]);
  });

  test("failed jobs come first, then every check that is not ok, in the reader's words", () => {
    const found = attention(
      2,
      health({ snapshot_store: { status: "down", driver: "s3", latency_ms: 9 } })
    );
    expect(found).toEqual([
      { label: "2 jobs failed in the last day", tone: "error" },
      { label: "The snapshot store is down", tone: "error" },
    ]);
  });

  test("one failed job is not 1 jobs, and a degraded check is a warning not an error", () => {
    const found = attention(1, health({ log_sink: { status: "degraded" } }));
    expect(found[0]).toEqual({ label: "1 job failed in the last day", tone: "error" });
    expect(found[1]).toEqual({ label: "The log sink is degraded", tone: "warning" });
  });

  test("uptime is said the way an operator says it", () => {
    expect(uptime(45)).toBe("1 minute");
    expect(uptime(60 * 9)).toBe("9 minutes");
    expect(uptime(3600 * 5)).toBe("5 hours");
    expect(uptime(86400 * 3)).toBe("3 days");
    expect(uptime(86400)).toBe("1 day");
  });
});
