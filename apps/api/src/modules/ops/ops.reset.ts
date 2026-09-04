import { rmSync } from "node:fs";
import { join } from "node:path";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";
import { migrate } from "../../lib/db/index.ts";
import { currentActor, requestMeta } from "../../lib/http/auth.ts";
import { AppError, conflict, ok, parseBody } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { AuditService } from "../audit/audit.service.ts";
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

/** The dispatcher slice a reset needs: pause it for the wipe, then hand jobs back to the seed. */
export type ResetDispatcher = { drain(timeoutMs: number): Promise<string[]>; start(): void };

const DRAIN_TIMEOUT_MS = 5_000;

/**
 * Directories under the data dir a metadata wipe orphans (19 §19.3): the shared blob store
 * (snapshot and diff content alike), sandbox uploads, and import artifacts.
 */
const ORPHANED_DIRS = ["blobs", "uploads", "imports"] as const;

function wipeOrphanedDirs(dataDir: string): void {
  for (const dir of ORPHANED_DIRS) rmSync(join(dataDir, dir), { recursive: true, force: true });
}

/**
 * Drops every metadata table, re-applies the migrations, and recreates the bootstrap admin.
 * Registered only outside production (07 §7.8). Every session goes with the tables, the caller's
 * included. The seed then fills the metadata (`ops.seeds.ts`).
 *
 * The dispatcher pauses for the destructive phase — dropping `jobs` out from under a running tick
 * is how a reset corrupts itself — and resumes before the seed runs: `ops.seeds.ts` takes an init
 * snapshot and waits on its job, which needs a dispatcher that is back on its feet (19 §19.3).
 */
export async function resetState(
  db: MetadataDb,
  migrationsDir: string,
  dataDir: string,
  dispatcher: ResetDispatcher,
  seed: SeedKind,
  bootstrap: () => Promise<boolean>,
  runSeed: (kind: SeedKind) => Promise<SeedCounts>,
  resync: () => Promise<void>
): Promise<ResetReport> {
  const started = performance.now();
  await dispatcher.drain(DRAIN_TIMEOUT_MS);
  try {
    const tables = db
      .query<TableRow, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
      )
      .all();
    db.exec("PRAGMA foreign_keys = OFF");
    for (const table of tables)
      db.exec(`DROP TABLE IF EXISTS "${table.name.replaceAll('"', '""')}"`);
    db.exec("PRAGMA foreign_keys = ON");
    wipeOrphanedDirs(dataDir);
    migrate(db, migrationsDir);
  } finally {
    // Even a failed wipe leaves the instance able to run jobs again; a reset that half-finishes
    // and never restarts the dispatcher is a worse outage than the one it was meant to fix.
    dispatcher.start();
  }
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
  dataDir: string;
  dispatcher: ResetDispatcher;
  defaultSeed: "dev" | "qa";
  jobsRunning: () => boolean;
  /** Null when TESTATE_ADMIN_PASSWORD is unset: the reset refuses rather than leave no admin. */
  bootstrap: (() => Promise<boolean>) | null;
  seed: (kind: SeedKind) => Promise<SeedCounts>;
  /** Re-applies the settings the reset just recreated to whatever holds them in memory. */
  resync: () => Promise<void>;
  audit: Pick<AuditService, "record">;
  trustProxy: boolean;
};

export function createResetHandler(deps: ResetDeps): Handler {
  return async (c) => {
    const body = await parseBody(c, resetStateSchema);
    if (deps.jobsRunning()) throw new AppError("JOB_IN_PROGRESS", "reset needs an idle instance");
    if (deps.bootstrap === null) {
      throw conflict("TESTATE_ADMIN_PASSWORD must be set: the reset recreates the admin from it");
    }
    const report = await resetState(
      deps.db,
      deps.migrationsDir,
      deps.dataDir,
      deps.dispatcher,
      body.seed ?? deps.defaultSeed,
      deps.bootstrap,
      deps.seed,
      deps.resync
    );
    deps.audit.record({
      actor: currentActor(c),
      action: "reset_state.run",
      target_type: "instance",
      target_id: "instance",
      details: { seed: report.seed },
      outcome: "succeeded",
      meta: requestMeta(c, deps.trustProxy),
    });
    return ok(c, report);
  };
}
