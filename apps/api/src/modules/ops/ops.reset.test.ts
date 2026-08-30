import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrate, openMetadataDb } from "../../lib/db/index.ts";
import { resetState } from "./ops.reset.ts";

const MIGRATIONS = join(import.meta.dir, "..", "..", "db", "migrations");

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

    expect(order).toEqual(["bootstrap", "seed", "resync"]);
    expect(report.seed).toBe("qa");
  });
});
