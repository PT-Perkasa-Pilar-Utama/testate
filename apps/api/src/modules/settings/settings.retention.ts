import { rmSync } from "node:fs";
import { dirname } from "node:path";
import type { Settings } from "@testate/shared";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";
import { pruneBackups } from "./settings.backup.ts";

export type RetentionReport = {
  stashes: number;
  query_history: number;
  audit_logs: number;
  import_runs: number;
  backups: number;
};

export type RetentionDeps = {
  db: MetadataDb;
  /** Deletes one state with its blob refcounts; the states repository owns the recipe (15 §15.4). */
  removeState: (id: string) => Promise<void>;
  /** Download backups under `run/backups` expire after 24 hours (16 §16.4). */
  dataDir: string;
  now: () => Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const idRow = v.object({ id: v.string() });
const stashRow = v.object({ id: v.string(), project_id: v.string() });
const pathRow = v.object({ rejected_path: v.nullable(v.string()) });

function cutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

/** Every stash beyond the newest `keep` per project goes (05 §5.8). */
async function pruneStashes(deps: RetentionDeps, keep: number): Promise<number> {
  const rows = v.parse(
    v.array(stashRow),
    deps.db
      .query(
        `SELECT id, project_id FROM states WHERE kind = 'stash' AND status <> 'creating'
         ORDER BY project_id, created_at DESC, id DESC`
      )
      .all()
  );
  const seen = new Map<string, number>();
  let removed = 0;
  for (const row of rows) {
    const count = (seen.get(row.project_id) ?? 0) + 1;
    seen.set(row.project_id, count);
    if (count <= keep) continue;
    await deps.removeState(row.id);
    removed += 1;
  }
  return removed;
}

function pruneImportRuns(deps: RetentionDeps, before: string): number {
  const rows = v.parse(
    v.array(v.object({ ...idRow.entries, ...pathRow.entries })),
    deps.db
      .query(
        "SELECT id, rejected_path FROM import_runs WHERE created_at < ? AND finished_at IS NOT NULL"
      )
      .all(before)
  );
  for (const row of rows) {
    if (row.rejected_path !== null)
      rmSync(dirname(row.rejected_path), { recursive: true, force: true });
    deps.db.query("DELETE FROM import_runs WHERE id = ?").run(row.id);
  }
  return rows.length;
}

/** The daily sweep for the kinds settings govern (05 §5.16); jobs and diffs sweep through their own services. */
export async function runRetention(
  deps: RetentionDeps,
  retention: Settings["retention"]
): Promise<RetentionReport> {
  const now = deps.now();
  const stashes = await pruneStashes(deps, retention.stash_keep);
  const query_history = deps.db
    .query("DELETE FROM query_history WHERE created_at < ?")
    .run(cutoff(now, retention.query_history_days)).changes;
  const audit_logs = deps.db
    .query("DELETE FROM audit_logs WHERE created_at < ?")
    .run(cutoff(now, retention.audit_days)).changes;
  const import_runs = pruneImportRuns(deps, cutoff(now, retention.import_run_days));
  const backups = pruneBackups(deps.dataDir, now);
  return { stashes, query_history, audit_logs, import_runs, backups };
}
