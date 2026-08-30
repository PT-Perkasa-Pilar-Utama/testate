import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";
import { migrate } from "../../lib/db/index.ts";
import { AppError, conflict, ok, parseBody } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { SeedCounts, SeedKind } from "./ops.seeds.ts";

export const resetStateSchema = v.object({
  seed: v.optional(v.picklist(["dev", "qa"])),
  confirm: v.literal("reset"),
});

export type ResetReport = SeedCounts & {
  seed: SeedKind;
  sessions_revoked: true;
  duration_ms: number;
};

type TableRow = { name: string };

/**
 * Drops every metadata table, re-applies the migrations, and recreates the bootstrap admin.
 * Registered only outside production (07 §7.8). Every session goes with the tables, the caller's
 * included. The seed then fills the metadata (`ops.seeds.ts`).
 */
export async function resetState(
  db: MetadataDb,
  migrationsDir: string,
  seed: SeedKind,
  bootstrap: () => Promise<boolean>,
  runSeed: (kind: SeedKind) => Promise<SeedCounts>,
  resync: () => Promise<void>
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
  await bootstrap();
  const counts = await runSeed(seed);
  // The settings table went with the others, so whatever the live process is enforcing came from
  // before the reset. A security control that says one thing and does another is worse than either.
  await resync();
  return {
    seed,
    ...counts,
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
  seed: (kind: SeedKind) => Promise<SeedCounts>;
  /** Re-applies the settings the reset just recreated to whatever holds them in memory. */
  resync: () => Promise<void>;
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
      await resetState(
        deps.db,
        deps.migrationsDir,
        body.seed ?? deps.defaultSeed,
        deps.bootstrap,
        deps.seed,
        deps.resync
      )
    );
  };
}
