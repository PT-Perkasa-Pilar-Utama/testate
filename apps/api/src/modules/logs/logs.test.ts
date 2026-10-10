import { describe, expect, it } from "bun:test";
import type { Actor } from "@testate/shared";

import { TEST_META } from "../../../test/accounts.ts";
import { S3, createAdaptersHarness } from "../../../test/adapters.ts";
import { PM2_LOGS } from "../../../test/logs.ts";
import { createLogsService } from "./logs.service.ts";

// #69 (docs/decisions/2026-10-10-logs-tier.md): one source read through the files resolver, over
// the harness's in-memory SFTP host, masked for viewers and agents (Q5).
const encoder = new TextEncoder();
const LOG =
  "2026-10-10T08:00:01: GET /orders 200\n" +
  "2026-10-10T08:00:02: login Authorization: Bearer abcdef0123456789\n" +
  "2026-10-10T08:00:03: TypeError: x is undefined\n" +
  "    at handler (server.ts:42)\n";

async function setup() {
  const harness = await createAdaptersHarness();
  const { adapter } = await harness.adapters.create(harness.qa, "shop", PM2_LOGS, TEST_META);
  const tree = harness.trees.get("logs.sit.internal") ?? new Map();
  harness.trees.set("logs.sit.internal", tree);
  tree.set(".pm2/logs/api-out.log", {
    bytes: encoder.encode(LOG),
    modified_at: "2026-10-10T08:00:03.000Z",
  });
  const logs = createLogsService({ projects: harness.projectsRepo, files: harness.files });
  const viewer: Actor = { ...harness.qa, role: "viewer" };
  return { harness, adapter, logs, viewer };
}

const query = { source: "api", limit: 200 };

describe("reading logs", () => {
  it("returns the source's entries newest first, a stack trace joined, raw for a tester", async () => {
    const { harness, adapter, logs } = await setup();
    const { page, stats } = await logs.read(harness.qa, "shop", adapter.id, query, null);
    expect(page.entries.map((entry) => entry.message)).toEqual([
      "TypeError: x is undefined\n    at handler (server.ts:42)",
      "login Authorization: Bearer abcdef0123456789",
      "GET /orders 200",
    ]);
    expect([stats.files, stats.entries, page.entries.some((entry) => entry.masked)]).toEqual([
      1,
      3,
      false,
    ]);
  });

  it("masks the token for a viewer and says so", async () => {
    const { adapter, logs, viewer } = await setup();
    const { page } = await logs.read(viewer, "shop", adapter.id, query, null);
    expect(page.entries[1]).toMatchObject({
      message: "login Authorization: Bearer ***",
      masked: true,
    });
  });

  it("refuses a source the adapter does not have, a Files adapter, and a project out of scope", async () => {
    const { harness, adapter, logs } = await setup();
    const { adapter: store } = await harness.adapters.create(harness.qa, "shop", S3, TEST_META);
    await expect(
      logs.read(harness.qa, "shop", adapter.id, { ...query, source: "nope" }, null)
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(logs.read(harness.qa, "shop", store.id, query, null)).rejects.toMatchObject({
      code: "ENGINE_UNSUPPORTED",
    });
    await expect(
      logs.read(harness.qa, "shop", adapter.id, query, ["another-project"])
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
