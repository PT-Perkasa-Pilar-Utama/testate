import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as v from "valibot";
import { healthAdminSchema } from "@testate/shared";

import { createMemoryBlobStore } from "../../lib/blobstore/index.ts";
import { migrate, openMetadataDb } from "../../lib/db/index.ts";
import { health } from "./ops.service.ts";
import type { HealthDeps } from "./ops.service.ts";

function deps(overrides: Partial<HealthDeps> = {}): HealthDeps {
  const dir = mkdtempSync(join(tmpdir(), "testate-ops-"));
  const db = openMetadataDb(join(dir, "metadata.db"));
  migrate(db);
  return {
    db,
    dataDir: dir,
    env: "test",
    version: "0.1.0",
    bootId: "01J-boot",
    bootedAt: Date.now() - 5000,
    storeDriver: "local",
    store: createMemoryBlobStore(),
    activeKid: "9f3c1a2b",
    extraKeys: 0,
    sinkDegraded: () => false,
    dispatcher: () => ({ alive: true, running: 0, queued: 0, lastTickAt: null }),
    ...overrides,
  };
}

describe("health", () => {
  it("reports ok with a migrated metadata database and a writable data dir", async () => {
    const report = await health(deps());

    expect(report.status).toBe("ok");
    expect(report.checks.metadata_db.status).toBe("ok");
    expect(report.checks.data_dir.free_bytes).toBeGreaterThan(0);
    expect(v.safeParse(healthAdminSchema, report).success).toBe(true);
  });

  it("degrades when the dispatcher is not alive", async () => {
    const report = await health(
      deps({ dispatcher: () => ({ alive: false, running: 0, queued: 3, lastTickAt: null }) })
    );

    expect(report.status).toBe("degraded");
    expect(report.checks.dispatcher.queued).toBe(3);
  });

  // The store used to report "ok" without anyone asking it anything.
  it("degrades when the snapshot store cannot be reached", async () => {
    const unreachable = {
      ...createMemoryBlobStore(),
      has: () => Promise.reject(new Error("s3: connection refused")),
    };
    const report = await health(deps({ store: unreachable, storeDriver: "s3" }));

    expect(report.checks.snapshot_store.status).toBe("down");
    expect(report.checks.snapshot_store.driver).toBe("s3");
    expect(report.status).toBe("degraded");
  });

  it("goes down when the data dir is not writable", async () => {
    const report = await health(deps({ dataDir: "/nonexistent/testate" }));

    expect(report.status).toBe("down");
    expect(report.checks.data_dir.status).toBe("down");
  });
});

describe("migrate", () => {
  it("applies every migration once and skips them all on the second run", () => {
    const dir = mkdtempSync(join(tmpdir(), "testate-migrate-"));
    const db = openMetadataDb(join(dir, "metadata.db"));

    const first = migrate(db);
    const second = migrate(db);

    expect(first.applied).toStrictEqual([
      "0001_init.sql",
      "0002_drop_hooks_and_rest.sql",
      "0003_audit_target_label.sql",
      "0004_write_sessions_by_token.sql",
      "0005_normalizers_per_table.sql",
    ]);
    expect(second.applied).toStrictEqual([]);
    expect(second.skipped).toBe(5);
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
      )
      .all()
      .map((row) => row.name);
    expect(tables).toContain("states");
    expect(tables).toContain("audit_logs");
  });
});
