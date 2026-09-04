import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import * as v from "valibot";

import { S3, createAdaptersHarness, createSettled } from "../../../test/adapters.ts";
import type { MemoryTree } from "../../lib/files/index.ts";
import { createStorageHandlers } from "./storage.handler.ts";
import { createStorageRouter } from "./storage.router.ts";
import { createStorageService } from "./storage.service.ts";

const encoder = new TextEncoder();

/** One adapter with a few files, wired to the real handler and router, not just the service. */
async function createApp(): Promise<{ app: Hono; s3: string }> {
  const harness = await createAdaptersHarness();
  const s3 = await createSettled(harness, S3);
  const tree: MemoryTree = new Map();
  for (let index = 0; index < 8; index += 1) {
    tree.set(`exports/file-${index}.txt`, {
      bytes: encoder.encode(`${index}`),
      modified_at: "2026-08-28T00:00:00.000Z",
    });
  }
  harness.trees.set("exports", tree);
  const storage = createStorageService({
    projects: harness.projectsRepo,
    files: harness.files,
    hostKeys: harness.hostKeys,
    audit: harness.audit,
    now: harness.now,
  });
  const handlers = createStorageHandlers(storage, false, 1024 * 1024);
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("actor", harness.qa);
    c.set("authKind", "bearer");
    c.set("projectScope", null);
    await next();
  });
  app.route("/", createStorageRouter(handlers));
  return { app, s3: s3.id };
}

describe("GET .../entries", () => {
  it("answers page.limit with the limit that applied, not a fixed 200", async () => {
    const { app, s3 } = await createApp();
    const response = await app.request(
      `/projects/shop/adapters/${s3}/entries?path=exports&limit=5`
    );
    expect(response.status).toBe(200);
    const body = v.parse(
      v.object({ page: v.object({ limit: v.number() }) }),
      await response.json()
    );
    expect(body.page.limit).toBe(5);
  });
});
