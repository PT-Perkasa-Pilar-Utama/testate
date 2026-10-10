import { describe, expect, it } from "bun:test";
import type { Actor, AdapterDraft, JsonValue } from "@testate/shared";
import { Hono } from "hono";

import { TEST_META } from "../../../test/accounts.ts";
import { S3, createAdaptersHarness } from "../../../test/adapters.ts";
import { PM2_LOGS } from "../../../test/logs.ts";
import { AppError, notFound } from "../../lib/http/index.ts";
import type { FileSource } from "../../lib/files/index.ts";
import { WideEvent } from "../../lib/logger/event.ts";
import { createLogsHandlers } from "./logs.handler.ts";
import { createLogsRouter } from "./logs.router.ts";
import { createLogsService, logFilesOf } from "./logs.service.ts";

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

const withSources = (sources: JsonValue): AdapterDraft => ({
  ...PM2_LOGS,
  config: { ...PM2_LOGS.config, sources },
});

/** A file source whose ranged read always fails with `cause`; nothing else is called. */
function sourceThatFails(cause: AppError): FileSource {
  const refuse = async (): Promise<never> => {
    throw cause;
  };
  return {
    list: refuse,
    stat: refuse,
    read: refuse,
    readRange: refuse,
    put: refuse,
    remove: refuse,
    move: refuse,
    makeDirectory: refuse,
    removeDirectory: refuse,
    close: async () => undefined,
  };
}

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

describe("edges of a read", () => {
  it("reads a glob with no folder from the connection's root", async () => {
    const { harness, logs } = await setup();
    const draft = withSources([{ name: "root", glob: "api-*.log", format: "pm2" }]);
    const { adapter } = await harness.adapters.create(
      harness.qa,
      "shop",
      { ...draft, name: "root-logs" },
      TEST_META
    );
    harness.trees.get("logs.sit.internal")?.set("api-out.log", {
      bytes: encoder.encode("2026-10-10T09:00:00: at the root\n"),
      modified_at: "2026-10-10T09:00:00.000Z",
    });
    const { page } = await logs.read(
      harness.qa,
      "shop",
      adapter.id,
      { source: "root", limit: 10 },
      null
    );
    expect(page.entries.map((entry) => entry.message)).toEqual(["at the root"]);
  });

  it("reads a file rotated away between the listing and the read as empty, and fails on anything else", async () => {
    const gone = logFilesOf(sourceThatFails(notFound("file")));
    const broken = logFilesOf(sourceThatFails(new AppError("ADAPTER_UNREACHABLE", "down")));
    expect((await gone.readRange("api-out.log", 0, 10)).length).toBe(0);
    await expect(broken.readRange("api-out.log", 0, 10)).rejects.toMatchObject({
      code: "ADAPTER_UNREACHABLE",
    });
  });

  it("downloads what a viewer sees, masked the same way", async () => {
    const { harness, adapter, logs } = await setup();
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("event", new WideEvent("request", () => undefined));
      c.set("actor", { ...harness.qa, role: "viewer" });
      c.set("authKind", "bearer");
      c.set("projectScope", null);
      await next();
    });
    app.route("/", createLogsRouter(createLogsHandlers(logs)));
    const response = await app.request(
      `/projects/shop/adapters/${adapter.id}/logs/download?source=api`
    );
    const lines = (await response.text()).trim().split("\n");
    expect([
      response.status,
      lines.length,
      lines[1]?.includes("Bearer ***"),
      lines[1]?.includes("abcdef"),
    ]).toEqual([200, 3, true, false]);
  });
});
