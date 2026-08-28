import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";
import { migrate } from "../../lib/db/index.ts";
import { AppError, conflict, ok, parseBody } from "../../lib/http/index.ts";
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
  sessions_revoked: true;
  duration_ms: number;
};

type TableRow = { name: string };

/**
 * Drops every metadata table, re-applies the migrations, and recreates the bootstrap admin.
 * Registered only outside production (07 §7.8). Every session goes with the tables, the caller's
 * included. SCAFFOLD: project and adapter seeds land with their cards.
 */
export async function resetState(
  db: MetadataDb,
  migrationsDir: string,
  seed: "dev" | "qa",
  bootstrap: () => Promise<boolean>
): Promise<ResetReport> {
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
  const users = (await bootstrap()) ? 1 : 0;
  return {
    seed,
    users,
    projects: 0,
    adapters: 0,
    states: 0,
    sessions_revoked: true,
    duration_ms: Math.round(performance.now() - started),
  };
}

export type ResetDeps = {
  db: MetadataDb;
  migrationsDir: string;
  defaultSeed: "dev" | "qa";
  jobsRunning: () => boolean;
  /** Null when TESTATE_ADMIN_PASSWORD is unset: the reset refuses rather than leave no admin. */
  bootstrap: (() => Promise<boolean>) | null;
};

export function createResetHandler(deps: ResetDeps): Handler {
  return async (c) => {
    const body = await parseBody(c, resetStateSchema);
    if (deps.jobsRunning()) throw new AppError("JOB_IN_PROGRESS", "reset needs an idle instance");
    if (deps.bootstrap === null) {
      throw conflict("TESTATE_ADMIN_PASSWORD must be set so the reset can recreate the admin");
    }
    return ok(
      c,
      await resetState(deps.db, deps.migrationsDir, body.seed ?? deps.defaultSeed, deps.bootstrap)
    );
  };
}
