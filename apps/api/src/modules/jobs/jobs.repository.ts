import type { Actor, Job, JobKind, JobStatus, JsonObject } from "@testate/shared";
import {
  TERMINAL_JOB_STATUSES,
  actorSchema,
  jobErrorSchema,
  jobKindSchema,
  jobStatusSchema,
  jsonObjectSchema,
} from "@testate/shared";
import * as v from "valibot";

import { encodeCursor } from "../../lib/db/keyset.ts";
import type { MetadataDb } from "../../lib/db/index.ts";
import { conditions, cursorCondition, keysetOf } from "./jobs.query.ts";

const rowSchema = v.object({
  id: v.string(),
  project_id: v.nullable(v.string()),
  adapter_ids: v.string(),
  kind: jobKindSchema,
  status: jobStatusSchema,
  payload: v.string(),
  result: v.nullable(v.string()),
  error: v.nullable(v.string()),
  progress: v.nullable(v.string()),
  cancel_requested: v.number(),
  parent_request_id: v.nullable(v.string()),
  actor: v.string(),
  created_at: v.string(),
  started_at: v.nullable(v.string()),
  finished_at: v.nullable(v.string()),
  queue_position: v.optional(v.nullable(v.number())),
});
type JobRow = v.InferOutput<typeof rowSchema>;

/** A job with its payload; the API shape (`Job`) never carries the payload. */
export type JobRecord = Job & { payload: JsonObject };

export type JobError = v.InferOutput<typeof jobErrorSchema>;

export type NewJob = {
  id: string;
  kind: JobKind;
  project_id: string | null;
  adapter_ids: string[];
  payload: JsonObject;
  actor: Actor;
  parent_request_id: string | null;
  created_at: string;
};

export type JobSort = "created_at" | "kind" | "status";

export type JobsListQuery = {
  limit: number;
  cursor?: string;
  sort: JobSort;
  order: "asc" | "desc";
  q?: string;
  project_id?: string;
  adapter_id?: string;
  kind?: JobKind;
  status?: JobStatus;
  /** Project ids a scoped token may see; null means every project. */
  scope: string[] | null;
  /** Instance-level jobs (no project) show for admins only. */
  includeInstance: boolean;
};

export type Interrupted = {
  id: string;
  kind: JobKind;
  project_id: string | null;
  payload: JsonObject;
  progress: JsonObject | null;
};

export type IdempotencyRecord = { job_id: string; body_hash: string; expires_at: string };

export type JobsRepository = {
  /** How many rows the filter matches, ignoring the page. */
  total(query: JobsListQuery): number;
  insert(job: NewJob): JobRecord;
  byId(id: string): JobRecord | null;
  list(query: JobsListQuery): { rows: Job[]; nextCursor: string | null };
  queued(): JobRecord[];
  countQueued(): number;
  /** Adapter ids named by any queued or running job (exclusivity, 16 §16.1). */
  claimedAdapterIds(): Set<string>;
  markRunning(id: string, at: string): void;
  setProgress(id: string, progress: JsonObject): void;
  requestCancel(id: string): void;
  finish(
    id: string,
    status: JobStatus,
    result: JsonObject | null,
    error: JobError | null,
    at: string
  ): void;
  interruptRunning(at: string): Interrupted[];
  findIdempotency(keyHash: string, tokenId: string): IdempotencyRecord | null;
  insertIdempotency(
    keyHash: string,
    tokenId: string,
    jobId: string,
    bodyHash: string,
    expiresAt: string
  ): void;
  deleteIdempotency(keyHash: string, tokenId: string): void;
  /** Retention (16 §16.1): drops old terminal jobs; referenced ones keep a stub row. */
  sweep(cutoff: string): { deleted: number; stubbed: number };
};

const REFERENCED = `id IN (SELECT job_id FROM checkouts) OR id IN (SELECT job_id FROM states)
  OR id IN (SELECT job_id FROM diffs) OR id IN (SELECT job_id FROM import_runs)`;

function parseJson(text: string | null): JsonObject | null {
  return text === null ? null : v.parse(jsonObjectSchema, JSON.parse(text));
}

function toRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    queue_position: row.queue_position ?? null,
    project_id: row.project_id,
    adapter_ids: v.parse(v.array(v.string()), JSON.parse(row.adapter_ids)),
    progress: parseJson(row.progress),
    result: parseJson(row.result),
    error: row.error === null ? null : v.parse(jobErrorSchema, JSON.parse(row.error)),
    cancel_requested: row.cancel_requested === 1,
    actor: v.parse(actorSchema, JSON.parse(row.actor)),
    parent_request_id: row.parent_request_id,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    payload: v.parse(jsonObjectSchema, JSON.parse(row.payload)),
  };
}

function toJob(record: JobRecord): Job {
  const { payload: _payload, ...job } = record;
  return job;
}

/** Queue position: earlier queued jobs plus one; null once the job runs (16 §16.1). */
const SELECT = `SELECT j.*, CASE WHEN j.status = 'queued'
    THEN (SELECT COUNT(*) + 1 FROM jobs q WHERE q.status = 'queued'
      AND (q.created_at < j.created_at OR (q.created_at = j.created_at AND q.id < j.id)))
    ELSE NULL END AS queue_position
  FROM jobs j`;

export function createJobsRepository(db: MetadataDb): JobsRepository {
  const one = (where: string, ...params: string[]): JobRecord | null => {
    const row = db.query(`${SELECT} WHERE ${where}`).get(...params);
    return row === null ? null : toRecord(v.parse(rowSchema, row));
  };
  const many = (sql: string, ...params: (string | number)[]): JobRecord[] =>
    v.parse(v.array(rowSchema), db.query(sql).all(...params)).map(toRecord);
  const count = (sql: string, ...params: string[]): number =>
    v.parse(v.object({ n: v.number() }), db.query(sql).get(...params)).n;
  return {
    insert(job) {
      db.query(
        `INSERT INTO jobs (id, project_id, adapter_ids, kind, status, payload, parent_request_id, actor,
           actor_user_id, actor_token_id, created_at)
         VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`
      ).run(
        job.id,
        job.project_id,
        JSON.stringify(job.adapter_ids),
        job.kind,
        JSON.stringify(job.payload),
        job.parent_request_id,
        JSON.stringify(job.actor),
        job.actor.kind === "user" ? job.actor.id : null,
        job.actor.kind === "token" ? job.actor.id : null,
        job.created_at
      );
      const inserted = one("j.id = ?", job.id);
      if (inserted === null) throw new Error("inserted job vanished");
      return inserted;
    },
    byId: (id) => one("j.id = ?", id),
    total(query) {
      // The same conditions as `list` without the cursor: counting from the cursor would answer
      // "how many are left", not "how many match".
      const found = conditions(query);
      const where =
        found.length === 0 ? "" : ` WHERE ${found.map((item) => item.sql).join(" AND ")}`;
      return count(
        `SELECT COUNT(*) AS n FROM jobs j${where}`,
        ...found.flatMap((item) => item.params)
      );
    },
    list(query) {
      const keyset = keysetOf(query);
      const found = conditions(query);
      const after = cursorCondition(query);
      if (after !== null) found.push(after);
      const where =
        found.length === 0 ? "" : ` WHERE ${found.map((item) => item.sql).join(" AND ")}`;
      const dir = query.order === "asc" ? "ASC" : "DESC";
      // One row past the page, so "is there more" is an answer rather than a guess about a full page.
      const rows = many(
        `${SELECT}${where} ORDER BY ${keyset.column} ${dir}, j.id ${dir} LIMIT ?`,
        ...found.flatMap((item) => item.params),
        query.limit + 1
      );
      const page = rows.slice(0, query.limit).map(toJob);
      const last = page.at(-1);
      const more = rows.length > query.limit && last !== undefined;
      return {
        rows: page,
        nextCursor:
          more && last !== undefined ? encodeCursor(keyset, [last[query.sort], last.id]) : null,
      };
    },
    queued: () => many(`${SELECT} WHERE j.status = 'queued' ORDER BY j.created_at ASC, j.id ASC`),
    countQueued: () => count("SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued'"),
    claimedAdapterIds() {
      const rows = v.parse(
        v.array(v.object({ adapter_ids: v.string() })),
        db.query("SELECT adapter_ids FROM jobs WHERE status IN ('queued', 'running')").all()
      );
      return new Set(
        rows.flatMap((row) => v.parse(v.array(v.string()), JSON.parse(row.adapter_ids)))
      );
    },
    markRunning(id, at) {
      db.query("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?").run(at, id);
    },
    setProgress(id, progress) {
      db.query("UPDATE jobs SET progress = ? WHERE id = ?").run(JSON.stringify(progress), id);
    },
    requestCancel(id) {
      db.query("UPDATE jobs SET cancel_requested = 1 WHERE id = ?").run(id);
    },
    finish(id, status, result, error, at) {
      if (!TERMINAL_JOB_STATUSES.includes(status)) throw new Error(`${status} is not terminal`);
      db.query(
        "UPDATE jobs SET status = ?, result = ?, error = ?, finished_at = ? WHERE id = ?"
      ).run(
        status,
        result === null ? null : JSON.stringify(result),
        error === null ? null : JSON.stringify(error),
        at,
        id
      );
    },
    interruptRunning(at) {
      const rows = many(`${SELECT} WHERE j.status = 'running'`);
      db.query(
        `UPDATE jobs SET status = 'interrupted', finished_at = ?, error = '{"code":"INTERNAL","message":"interrupted by a restart"}'
         WHERE status = 'running'`
      ).run(at);
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        project_id: row.project_id,
        payload: row.payload,
        progress: row.progress,
      }));
    },
    findIdempotency(keyHash, tokenId) {
      const row = db
        .query(
          "SELECT job_id, body_hash, expires_at FROM idempotency_keys WHERE key_hash = ? AND token_id = ?"
        )
        .get(keyHash, tokenId);
      return row === null
        ? null
        : v.parse(
            v.object({ job_id: v.string(), body_hash: v.string(), expires_at: v.string() }),
            row
          );
    },
    insertIdempotency(keyHash, tokenId, jobId, bodyHash, expiresAt) {
      db.query(
        "INSERT INTO idempotency_keys (key_hash, token_id, job_id, body_hash, expires_at) VALUES (?, ?, ?, ?, ?)"
      ).run(keyHash, tokenId, jobId, bodyHash, expiresAt);
    },
    deleteIdempotency(keyHash, tokenId) {
      db.query("DELETE FROM idempotency_keys WHERE key_hash = ? AND token_id = ?").run(
        keyHash,
        tokenId
      );
    },
    sweep(cutoff) {
      const terminal = TERMINAL_JOB_STATUSES.map((status) => `'${status}'`).join(",");
      const stubbed = db
        .query(
          `UPDATE jobs SET payload = '{}', progress = NULL WHERE status IN (${terminal}) AND finished_at < ? AND (${REFERENCED}) AND payload <> '{}'`
        )
        .run(cutoff).changes;
      const deleted = db
        .query(
          `DELETE FROM jobs WHERE status IN (${terminal}) AND finished_at < ? AND NOT (${REFERENCED})`
        )
        .run(cutoff).changes;
      return { deleted, stubbed };
    },
  };
}

export { toJob };
