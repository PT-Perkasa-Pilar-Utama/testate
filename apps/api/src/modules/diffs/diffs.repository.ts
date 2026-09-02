import type { Diff } from "@testate/shared";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";

export type NewDiff = {
  id: string;
  project_id: string;
  base_state_id: string;
  target_state_id: string | null;
  job_id: string;
  expires_at: string;
  created_at: string;
};

export type DiffTableRow = {
  adapter_id: string;
  schema: string | null;
  name: string;
  compare: "primary-key" | "row-hash";
  added: number;
  removed: number;
  changed: number;
  blob_hash: string | null;
  schema_changed: string[] | null;
};

/** Which adapters the diff covers; `compared: false` marks adapters on one side only (20 §20.1). */
export type DiffAdapterSummary = { adapter_id: string; name: string; compared: boolean };

export type DiffsRepository = {
  insert(diff: NewDiff, adapters: DiffAdapterSummary[]): void;
  byId(projectId: string, id: string): Diff | null;
  list(projectId: string, limit: number): Diff[];
  setJob(id: string, jobId: string): void;
  setLiveState(id: string, stateId: string): void;
  insertTable(diffId: string, table: DiffTableRow): void;
  finish(id: string, status: "ready" | "failed"): void;
  /** Whether any compared table has a row added, removed or changed, or a schema change. */
  hasChanges(id: string): boolean;
  /** The blob hashes the diff references plus its hidden state, for deletion (20 §20.1). */
  blobsOf(id: string): string[];
  liveStateOf(id: string): string | null;
  tableBlob(diffId: string, adapterId: string, table: string, schema: string | null): string | null;
  remove(id: string): void;
  expired(now: string): { id: string; project_id: string }[];
};

const diffRow = v.object({
  id: v.string(),
  project_id: v.string(),
  base_state_id: v.string(),
  base_name: v.nullable(v.string()),
  target_state_id: v.nullable(v.string()),
  target_name: v.nullable(v.string()),
  live_state_id: v.nullable(v.string()),
  job_id: v.string(),
  status: v.picklist(["running", "ready", "failed"]),
  summary: v.nullable(v.string()),
  expires_at: v.string(),
  created_at: v.string(),
});

const tableRow = v.object({
  diff_id: v.string(),
  adapter_id: v.string(),
  schema_name: v.nullable(v.string()),
  table_name: v.string(),
  added: v.number(),
  removed: v.number(),
  changed: v.number(),
  compare: v.picklist(["primary-key", "row-hash"]),
  blob_hash: v.nullable(v.string()),
  schema_changed: v.nullable(v.string()),
});

const summarySchema = v.array(
  v.object({ adapter_id: v.string(), name: v.string(), compared: v.boolean() })
);

const SELECT = `
  SELECT d.*, b.name AS base_name, t.name AS target_name FROM diffs d
  LEFT JOIN states b ON b.id = d.base_state_id
  LEFT JOIN states t ON t.id = d.target_state_id`;

function toDiff(
  row: v.InferOutput<typeof diffRow>,
  tables: v.InferOutput<typeof tableRow>[]
): Diff {
  const adapters = v.parse(summarySchema, JSON.parse(row.summary ?? "[]"));
  const target: Diff["target"] =
    row.target_state_id === null
      ? { live: true, snapshot_state_id: row.live_state_id ?? null }
      : { id: row.target_state_id, name: row.target_name ?? "deleted state" };
  return {
    id: row.id,
    status: row.status,
    base: { id: row.base_state_id, name: row.base_name ?? "deleted state" },
    target,
    expires_at: row.expires_at,
    adapters: adapters.map((adapter) => ({
      ...adapter,
      tables: tables
        .filter((table) => table.adapter_id === adapter.adapter_id)
        .map((table) => ({
          schema: table.schema_name,
          name: table.table_name,
          compare: table.compare,
          added: table.added,
          removed: table.removed,
          changed: table.changed,
          unchanged: table.blob_hash === null,
          schema_changed:
            table.schema_changed === null
              ? null
              : v.parse(v.array(v.string()), JSON.parse(table.schema_changed)),
        })),
    })),
    created_at: row.created_at,
  };
}

export function createDiffsRepository(db: MetadataDb): DiffsRepository {
  const tablesOf = (ids: string[]): Map<string, v.InferOutput<typeof tableRow>[]> => {
    const map = new Map<string, v.InferOutput<typeof tableRow>[]>();
    if (ids.length === 0) return map;
    const rows = v.parse(
      v.array(tableRow),
      db
        .query(
          `SELECT * FROM diff_tables WHERE diff_id IN (${ids.map(() => "?").join(", ")}) ORDER BY schema_name, table_name`
        )
        .all(...ids)
    );
    for (const row of rows) map.set(row.diff_id, [...(map.get(row.diff_id) ?? []), row]);
    return map;
  };
  return {
    insert(diff, adapters) {
      db.query(
        `INSERT INTO diffs (id, project_id, base_state_id, target_state_id, live_state_id, job_id, status, summary, expires_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, 'running', ?, ?, ?)`
      ).run(
        diff.id,
        diff.project_id,
        diff.base_state_id,
        diff.target_state_id,
        diff.job_id,
        JSON.stringify(adapters),
        diff.expires_at,
        diff.created_at
      );
    },
    byId(projectId, id) {
      const row = db.query(`${SELECT} WHERE d.project_id = ? AND d.id = ?`).get(projectId, id);
      if (row === null) return null;
      const parsed = v.parse(diffRow, row);
      return toDiff(parsed, tablesOf([parsed.id]).get(parsed.id) ?? []);
    },
    list(projectId, limit) {
      const rows = v.parse(
        v.array(diffRow),
        db
          .query(`${SELECT} WHERE d.project_id = ? ORDER BY d.created_at DESC, d.id DESC LIMIT ?`)
          .all(projectId, limit)
      );
      const tables = tablesOf(rows.map((row) => row.id));
      return rows.map((row) => toDiff(row, tables.get(row.id) ?? []));
    },
    setJob(id, jobId) {
      db.query("UPDATE diffs SET job_id = ? WHERE id = ?").run(jobId, id);
    },
    setLiveState(id, stateId) {
      db.query("UPDATE diffs SET live_state_id = ? WHERE id = ?").run(stateId, id);
    },
    insertTable(diffId, table) {
      db.query(
        `INSERT INTO diff_tables (diff_id, adapter_id, schema_name, table_name, added, removed, changed, compare, blob_hash, schema_changed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        diffId,
        table.adapter_id,
        table.schema,
        table.name,
        table.added,
        table.removed,
        table.changed,
        table.compare,
        table.blob_hash,
        table.schema_changed === null ? null : JSON.stringify(table.schema_changed)
      );
      if (table.blob_hash !== null) {
        db.query("UPDATE blobs SET ref_count = ref_count + 1 WHERE hash = ?").run(table.blob_hash);
      }
    },
    finish(id, status) {
      db.query("UPDATE diffs SET status = ? WHERE id = ?").run(status, id);
    },
    hasChanges(id) {
      const row = db
        .query(
          "SELECT COUNT(*) AS n FROM diff_tables WHERE diff_id = ? AND (added > 0 OR removed > 0 OR changed > 0 OR schema_changed IS NOT NULL)"
        )
        .get(id);
      return v.parse(v.object({ n: v.number() }), row).n > 0;
    },
    blobsOf(id) {
      const rows = db
        .query("SELECT blob_hash FROM diff_tables WHERE diff_id = ? AND blob_hash IS NOT NULL")
        .all(id);
      return v
        .parse(v.array(v.object({ blob_hash: v.string() })), rows)
        .map((row) => row.blob_hash);
    },
    tableBlob(diffId, adapterId, table, schema) {
      const row = db
        .query(
          "SELECT blob_hash FROM diff_tables WHERE diff_id = ? AND adapter_id = ? AND table_name = ? AND schema_name IS ?"
        )
        .get(diffId, adapterId, table, schema);
      return row === null
        ? null
        : v.parse(v.object({ blob_hash: v.nullable(v.string()) }), row).blob_hash;
    },
    liveStateOf(id) {
      const row = db.query("SELECT live_state_id FROM diffs WHERE id = ?").get(id);
      return row === null
        ? null
        : v.parse(v.object({ live_state_id: v.nullable(v.string()) }), row).live_state_id;
    },
    remove(id) {
      db.transaction(() => {
        for (const hash of this.blobsOf(id)) {
          db.query("UPDATE blobs SET ref_count = MAX(ref_count - 1, 0) WHERE hash = ?").run(hash);
        }
        db.query("DELETE FROM diffs WHERE id = ?").run(id);
      })();
    },
    expired(now) {
      const rows = db
        .query("SELECT id, project_id FROM diffs WHERE expires_at <= ? AND status <> 'running'")
        .all(now);
      return v.parse(v.array(v.object({ id: v.string(), project_id: v.string() })), rows);
    },
  };
}
