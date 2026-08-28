import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";
import { migrate } from "../../lib/db/index.ts";
import { AppError, ok, parseBody } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";

export const resetStateSchema = v.object({
  seed: v.optional(v.picklist(["dev", "qa"])),
  confirm: v.literal("reset"),
});

export type ResetReport = {
  seed: "dev" | "qa";
  users: number;
  projects: number;
  adapters: number;
  states: number;
  duration_ms: number;
};

type TableRow = { name: string };

/**
 * Drops every metadata table and re-applies the migrations. Registered only outside
 * production (07 §7.8). SCAFFOLD: seeds are empty until the users and projects cards land.
 */
export function resetState(db: MetadataDb, migrationsDir: string, seed: "dev" | "qa"): ResetReport {
  const started = performance.now();
  const tables = db
    .query<TableRow, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    )
    .all();
  db.exec("PRAGMA foreign_keys = OFF");
  for (const table of tables) db.exec(`DROP TABLE IF EXISTS "${table.name.replaceAll('"', '""')}"`);
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db, migrationsDir);
  return {
    seed,
    users: 0,
    projects: 0,
    adapters: 0,
    states: 0,
    duration_ms: Math.round(performance.now() - started),
  };
}

export function createResetHandler(
  db: MetadataDb,
  migrationsDir: string,
  defaultSeed: "dev" | "qa",
  jobsRunning: () => boolean
): Handler {
  return async (c) => {
    const body = await parseBody(c, resetStateSchema);
    if (jobsRunning()) throw new AppError("JOB_IN_PROGRESS", "reset needs an idle instance");
    return ok(c, resetState(db, migrationsDir, body.seed ?? defaultSeed));
  };
}
