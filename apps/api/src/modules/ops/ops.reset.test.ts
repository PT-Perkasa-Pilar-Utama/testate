import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

import { migrate, openMetadataDb } from "../../lib/db/index.ts";
import type { AuditEntry } from "../audit/audit.service.ts";
import { createResetHandler, resetState } from "./ops.reset.ts";
import type { ResetDeps, ResetDispatcher } from "./ops.reset.ts";

const MIGRATIONS = join(import.meta.dir, "..", "..", "db", "migrations");

/** A dispatcher stub that records when it was paused and resumed. */
function trackingDispatcher(order: string[]): ResetDispatcher {
  return {
    drain: async () => {
      order.push("drain");
      return [];
    },
    start: () => order.push("start"),
  };
}

describe("reset-state", () => {
  // The settings table is dropped with the rest, so anything holding a copy in memory keeps
  // enforcing the pre-reset policy until the next restart. That is a security control quietly
  // disagreeing with what the operator is shown.
  it("re-applies the recreated settings before it answers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "testate-reset-"));
    const db = openMetadataDb(join(dir, "metadata.db"));
    migrate(db, MIGRATIONS);
    const order: string[] = [];

    const report = await resetState(
      db,
      MIGRATIONS,
      dir,
      trackingDispatcher(order),
      "qa",
      async () => {
        order.push("bootstrap");
        return true;
      },
      async () => {
        order.push("seed");
        return { users: 1, projects: 0, adapters: 0, states: 0, warnings: [] };
      },
      async () => {
        order.push("resync");
      }
    );

    expect(order).toEqual(["drain", "start", "bootstrap", "seed", "resync"]);
    expect(report.seed).toBe("qa");
  });

  // A snapshot job cannot finish while the dispatcher is paused, and `ops.seeds.ts` waits on one
  // to seed the baseline state, so the dispatcher has to be back up before the seed runs — not
  // only once the whole reset is done.
  it("pauses the dispatcher for the wipe and resumes it before the seed needs it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "testate-reset-"));
    const db = openMetadataDb(join(dir, "metadata.db"));
    migrate(db, MIGRATIONS);
    const order: string[] = [];

    await resetState(
      db,
      MIGRATIONS,
      dir,
      trackingDispatcher(order),
      "qa",
      async () => true,
      async () => {
        order.push("seed");
        return { users: 1, projects: 0, adapters: 0, states: 0, warnings: [] };
      },
      async () => {}
    );

    expect(order).toEqual(["drain", "start", "seed"]);
  });

  it("wipes blobs, uploads and import artifacts a metadata reset orphans", async () => {
    const dir = mkdtempSync(join(tmpdir(), "testate-reset-"));
    const db = openMetadataDb(join(dir, "metadata.db"));
    migrate(db, MIGRATIONS);
    for (const sub of ["blobs/ab", "uploads/upload-1", "imports/run-1"]) {
      mkdirSync(join(dir, sub), { recursive: true });
      writeFileSync(join(dir, sub, "file"), "orphaned");
    }

    await resetState(
      db,
      MIGRATIONS,
      dir,
      trackingDispatcher([]),
      "qa",
      async () => true,
      async () => ({ users: 1, projects: 0, adapters: 0, states: 0, warnings: [] }),
      async () => {}
    );

    expect(existsSync(join(dir, "blobs"))).toBe(false);
    expect(existsSync(join(dir, "uploads"))).toBe(false);
    expect(existsSync(join(dir, "imports"))).toBe(false);
  });

  it("POST /admin/reset-state records reset_state.run in the audit log", async () => {
    const dir = mkdtempSync(join(tmpdir(), "testate-reset-"));
    const db = openMetadataDb(join(dir, "metadata.db"));
    migrate(db, MIGRATIONS);
    mkdirSync(join(dir, "blobs", "ab"), { recursive: true });
    writeFileSync(join(dir, "blobs", "ab", "file"), "orphaned");

    const audited: AuditEntry[] = [];
    const deps: ResetDeps = {
      db,
      migrationsDir: MIGRATIONS,
      dataDir: dir,
      dispatcher: trackingDispatcher([]),
      defaultSeed: "qa",
      jobsRunning: () => false,
      bootstrap: async () => true,
      seed: async () => ({ users: 1, projects: 0, adapters: 0, states: 0, warnings: [] }),
      resync: async () => {},
      audit: { record: (entry) => audited.push(entry) },
      trustProxy: false,
    };
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("actor", { kind: "user", id: "u1", label: "admin", role: "admin", agent: false });
      c.set("authKind", "bearer");
      await next();
    });
    app.post("/admin/reset-state", createResetHandler(deps));

    const response = await app.request("/admin/reset-state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seed: "qa", confirm: "reset" }),
    });

    expect(response.status).toBe(200);
    expect(existsSync(join(dir, "blobs"))).toBe(false);
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      action: "reset_state.run",
      target_type: "instance",
      outcome: "succeeded",
      details: { seed: "qa" },
    });
  });
});
