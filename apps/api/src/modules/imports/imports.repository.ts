import type { Actor, Mapping, Upload } from "@testate/shared";
import { importModeSchema, mappingColumnSchema, parseOptionsSchema } from "@testate/shared";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";
import { RUN_SELECT, runRow, toRun } from "./imports.runs.ts";
import type { RunRecord } from "./imports.runs.ts";

export type UploadRecord = Upload & {
  project_id: string;
  path: string;
  purpose: "import" | "archive";
};

export type NewUpload = Omit<UploadRecord, "expires_at"> & {
  expires_at: string;
  created_at: string;
};

export type NewMapping = Omit<Mapping, "id" | "created_at" | "updated_at"> & {
  id: string;
  created_at: string;
};

export type MappingPatch = Partial<
  Omit<Mapping, "id" | "adapter_id" | "created_by" | "created_at" | "updated_at">
>;

export type ImportSource = { kind: "upload" | "storage" | "rejected"; ref: string };

export type NewRun = {
  id: string;
  project_id: string;
  adapter_id: string;
  mapping_id: string;
  job_id: string;
  source: ImportSource;
  dry_run: boolean;
  mode: Mapping["mode"];
  actor: Actor;
  created_at: string;
};

export type RunCounts = {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  duration_ms: number;
};

export type { RunRecord } from "./imports.runs.ts";

export type RunsFilter = { limit: number; adapter_id?: string; dry_run?: boolean };

export type ImportsRepository = {
  insertUpload(upload: NewUpload): void;
  upload(id: string): UploadRecord | null;
  removeUpload(id: string): void;
  mappings(adapterId: string): Mapping[];
  mapping(id: string): Mapping | null;
  mappingByName(adapterId: string, name: string): Mapping | null;
  insertMapping(mapping: NewMapping): Mapping;
  updateMapping(id: string, patch: MappingPatch, at: string): void;
  removeMapping(id: string): void;
  insertRun(run: NewRun): void;
  setRunJob(id: string, jobId: string): void;
  setStash(id: string, stashStateId: string): void;
  finishRun(id: string, counts: RunCounts, rejectedPath: string | null, at: string): void;
  run(projectId: string, id: string): RunRecord | null;
  runs(projectId: string, filter: RunsFilter): RunRecord[];
};

const uploadRow = v.object({
  id: v.string(),
  project_id: v.string(),
  file_name: v.string(),
  path: v.string(),
  size_bytes: v.number(),
  type: v.picklist(["csv", "xlsx", "tar"]),
  purpose: v.picklist(["import", "archive"]),
  expires_at: v.string(),
});

const mappingRow = v.object({
  id: v.string(),
  adapter_id: v.string(),
  name: v.string(),
  target: v.string(),
  columns: v.string(),
  key_columns: v.string(),
  mode: importModeSchema,
  options: v.string(),
  created_by: v.string(),
  created_at: v.string(),
  updated_at: v.string(),
});

function toUpload(row: v.InferOutput<typeof uploadRow>): UploadRecord {
  return { upload_id: row.id, ...row };
}

function toMapping(row: v.InferOutput<typeof mappingRow>): Mapping {
  return {
    ...row,
    columns: v.parse(v.array(mappingColumnSchema), JSON.parse(row.columns)),
    key_columns: v.parse(v.array(v.string()), JSON.parse(row.key_columns)),
    options: v.parse(parseOptionsSchema, JSON.parse(row.options)),
  };
}

export function createImportsRepository(db: MetadataDb): ImportsRepository {
  const oneMapping = (where: string, ...params: string[]): Mapping | null => {
    const row = db.query(`SELECT * FROM import_mappings WHERE ${where}`).get(...params);
    return row === null ? null : toMapping(v.parse(mappingRow, row));
  };
  return {
    insertUpload(upload) {
      db.query(
        `INSERT INTO uploads (id, project_id, file_name, path, size_bytes, type, purpose, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        upload.upload_id,
        upload.project_id,
        upload.file_name,
        upload.path,
        upload.size_bytes,
        upload.type,
        upload.purpose,
        upload.expires_at,
        upload.created_at
      );
    },
    upload(id) {
      const row = db.query("SELECT * FROM uploads WHERE id = ?").get(id);
      return row === null ? null : toUpload(v.parse(uploadRow, row));
    },
    removeUpload(id) {
      db.query("DELETE FROM uploads WHERE id = ?").run(id);
    },
    mappings: (adapterId) =>
      v
        .parse(
          v.array(mappingRow),
          db
            .query("SELECT * FROM import_mappings WHERE adapter_id = ? ORDER BY name")
            .all(adapterId)
        )
        .map(toMapping),
    mapping: (id) => oneMapping("id = ?", id),
    mappingByName: (adapterId, name) => oneMapping("adapter_id = ? AND name = ?", adapterId, name),
    insertMapping(mapping) {
      db.query(
        `INSERT INTO import_mappings (id, adapter_id, name, target, columns, key_columns, mode, options, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        mapping.id,
        mapping.adapter_id,
        mapping.name,
        mapping.target,
        JSON.stringify(mapping.columns),
        JSON.stringify(mapping.key_columns),
        mapping.mode,
        JSON.stringify(mapping.options),
        mapping.created_by,
        mapping.created_at,
        mapping.created_at
      );
      const inserted = oneMapping("id = ?", mapping.id);
      if (inserted === null) throw new Error("mapping insert failed");
      return inserted;
    },
    updateMapping(id, patch, at) {
      const sets = ["updated_at = ?"];
      const params: string[] = [at];
      const columns: [string, string | undefined][] = [
        ["name", patch.name],
        ["target", patch.target],
        ["columns", patch.columns === undefined ? undefined : JSON.stringify(patch.columns)],
        [
          "key_columns",
          patch.key_columns === undefined ? undefined : JSON.stringify(patch.key_columns),
        ],
        ["mode", patch.mode],
        ["options", patch.options === undefined ? undefined : JSON.stringify(patch.options)],
      ];
      for (const [column, value] of columns) {
        if (value === undefined) continue;
        sets.push(`${column} = ?`);
        params.push(value);
      }
      db.query(`UPDATE import_mappings SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
    },
    removeMapping(id) {
      db.query("DELETE FROM import_mappings WHERE id = ?").run(id);
    },
    insertRun(run) {
      db.query(
        `INSERT INTO import_runs (id, project_id, adapter_id, mapping_id, job_id, source_kind, source_ref, dry_run, mode,
           actor_user_id, actor_token_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        run.id,
        run.project_id,
        run.adapter_id,
        run.mapping_id,
        run.job_id,
        run.source.kind,
        run.source.ref,
        run.dry_run ? 1 : 0,
        run.mode,
        run.actor.kind === "user" ? run.actor.id : null,
        run.actor.kind === "token" ? run.actor.id : null,
        run.created_at
      );
    },
    setRunJob(id, jobId) {
      db.query("UPDATE import_runs SET job_id = ? WHERE id = ?").run(jobId, id);
    },
    setStash(id, stashStateId) {
      db.query("UPDATE import_runs SET stash_state_id = ? WHERE id = ?").run(stashStateId, id);
    },
    finishRun(id, counts, rejectedPath, at) {
      db.query(
        "UPDATE import_runs SET counts = ?, rejected_path = ?, finished_at = ? WHERE id = ?"
      ).run(JSON.stringify(counts), rejectedPath, at, id);
    },
    run(projectId, id) {
      const row = db.query(`${RUN_SELECT} WHERE r.project_id = ? AND r.id = ?`).get(projectId, id);
      return row === null ? null : toRun(v.parse(runRow, row));
    },
    runs(projectId, filter) {
      const where = ["r.project_id = ?"];
      const params: (string | number)[] = [projectId];
      if (filter.adapter_id !== undefined) {
        where.push("r.adapter_id = ?");
        params.push(filter.adapter_id);
      }
      if (filter.dry_run !== undefined) {
        where.push("r.dry_run = ?");
        params.push(filter.dry_run ? 1 : 0);
      }
      const rows = db
        .query(
          `${RUN_SELECT} WHERE ${where.join(" AND ")} ORDER BY r.created_at DESC, r.id DESC LIMIT ?`
        )
        .all(...params, filter.limit);
      return v.parse(v.array(runRow), rows).map(toRun);
    },
  };
}
