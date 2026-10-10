import { describe, expect, it } from "bun:test";
import { logsPageSchema } from "@testate/shared";
import * as v from "valibot";

import { TEST_META } from "../../../test/accounts.ts";
import { PM2_LOGS } from "../../../test/logs.ts";
import { createLogsService } from "../logs/logs.service.ts";
import { call, createHarness } from "./agent.harness.ts";
import { logsDepsOf } from "../../../test/logs.ts";

// #69, Q9 (docs/decisions/2026-10-10-logs-tier.md): an agent reads a log source, always masked,
// once a person has trusted the host the way storage requires.
const LOG =
  "2026-10-10T08:00:01: GET /orders 200\n" +
  "2026-10-10T08:00:02: ERROR refund failed for token=abc123secret\n";

async function withLogs() {
  const h = await createHarness();
  const { adapter } = await h.harness.adapters.create(h.harness.qa, "shop", PM2_LOGS, TEST_META);
  h.harness.trees.set(
    "logs.sit.internal",
    new Map([
      [
        ".pm2/logs/api-out.log",
        { bytes: new TextEncoder().encode(LOG), modified_at: "2026-10-10T08:00:02.000Z" },
      ],
    ])
  );
  // A person trusts the SFTP host key on first read; an agent token never may (05 §5.11).
  const logs = createLogsService(logsDepsOf(h.harness));
  await logs.read(h.harness.qa, "shop", adapter.id, { source: "api", limit: 1 }, null);
  return { h, adapter };
}

describe("read_logs", () => {
  it("returns the source's entries newest first, filtered, with the secret masked", async () => {
    const { h, adapter } = await withLogs();
    const all = v.parse(
      logsPageSchema,
      await call(h, "read_logs", { project: "shop", adapter: adapter.name, source: "api" })
    );
    const errors = v.parse(
      logsPageSchema,
      await call(h, "read_logs", {
        project: "shop",
        adapter: adapter.id,
        source: "api",
        level: "error",
      })
    );
    expect(all.entries.map((entry) => entry.message)).toEqual([
      "refund failed for token=***",
      "GET /orders 200",
    ]);
    expect([errors.entries.length, errors.entries[0]?.masked]).toEqual([1, true]);
  });

  it("masks for a tester agent too, since every agent is masked", async () => {
    const { h, adapter } = await withLogs();
    const page = v.parse(
      logsPageSchema,
      await call(h, "read_logs", { project: "shop", adapter: adapter.id, source: "api" }, h.tester)
    );
    expect(page.entries[0]?.message).toBe("refund failed for token=***");
  });
});
