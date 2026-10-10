import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRetention } from "./boot.ts";
import { createLogger } from "./lib/logger/index.ts";

// 16 §16.1: every retention the settings name runs once a day. The settings sweep (stashes, query
// history, audit rows, import runs, download backups) had no caller in production.
describe("the daily retention", () => {
  it("runs the settings and ingest sweeps with the jobs and diffs, from the first start", async () => {
    const dir = mkdtempSync(join(tmpdir(), "testate-retention-"));
    const logger = createLogger({
      dir,
      retentionDays: 1,
      stdout: false,
      service: { name: "testate", version: "test", boot_id: "test", base_path: "/" },
      sampleRate: 1,
      slowMs: 1000,
      stacks: false,
    });
    const ran: string[] = [];
    const retention = createRetention(logger, {
      sweepJobs: () => () => {
        ran.push("jobs");
        return { deleted: 0, stubbed: 0 };
      },
      historyDays: async () => 30,
      expireDiffs: async () => {
        ran.push("diffs");
        return 0;
      },
      settings: async () => {
        ran.push("settings");
        return {
          stashes: 0,
          query_history: 0,
          audit_logs: 0,
          audit_payloads: 0,
          import_runs: 0,
          backups: 0,
        };
      },
      ingest: async () => {
        ran.push("ingest");
        return 0;
      },
    });
    retention.start();
    retention.stop();
    await Bun.sleep(0);
    expect(ran).toEqual(["jobs", "diffs", "settings", "ingest"]);
  });
});
