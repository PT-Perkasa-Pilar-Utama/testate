import type { HttpMethod, RestRequest, RestRun } from "@testate/shared";
import { httpMethodSchema } from "@testate/shared";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";
import { isSealed } from "../../lib/sealed/index.ts";
import type { Sealed } from "../../lib/sealed/index.ts";

export type RestRequestRecord = RestRequest & { adapter_id: string; headers_sealed: Sealed | null };

export type NewRestRequest = {
  id: string;
  adapter_id: string;
  name: string;
  method: HttpMethod;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  headers_sealed: Sealed | null;
  secret_headers: string[];
  body: string | null;
  expected_status: number | null;
  created_at: string;
};

export type RestRequestPatch = Partial<Omit<NewRestRequest, "id" | "adapter_id" | "created_at">>;

export type NewRun = {
  id: string;
  request_id: string;
  job_id: string | null;
  hook_run_id: string | null;
  status_code: number | null;
  duration_ms: number;
  response_headers: Record<string, string>;
  response_body: string | null;
  truncated: boolean;
  matched_expected: boolean | null;
  error: string | null;
  created_at: string;
};

export type RunSummary = Omit<RestRun, "response_headers" | "response_body"> & {
  job_id: string | null;
  hook_run_id: string | null;
};

export type RestRepository = {
  list(adapterId: string): RestRequestRecord[];
  byId(id: string): RestRequestRecord | null;
  byName(adapterId: string, name: string): RestRequestRecord | null;
  insert(request: NewRestRequest): RestRequestRecord;
  update(id: string, patch: RestRequestPatch, at: string): void;
  remove(id: string): void;
  referencedByHook(id: string): boolean;
  insertRun(run: NewRun): RestRun;
  /** Newest first; the table keeps the last fifty per request (05 §5.12). */
  runs(requestId: string, limit: number): RunSummary[];
  run(requestId: string, runId: string): RestRun | null;
};

const KEEP_RUNS = 50;

const requestRow = v.object({
  id: v.string(),
  adapter_id: v.string(),
  name: v.string(),
  method: httpMethodSchema,
  path: v.string(),
  query: v.string(),
  headers: v.string(),
  headers_sealed: v.nullable(v.string()),
  secret_headers: v.string(),
  body: v.nullable(v.string()),
  expected_status: v.nullable(v.number()),
  created_at: v.string(),
  updated_at: v.string(),
});

const runRow = v.object({
  id: v.string(),
  request_id: v.string(),
  job_id: v.nullable(v.string()),
  hook_run_id: v.nullable(v.string()),
  status_code: v.nullable(v.number()),
  duration_ms: v.nullable(v.number()),
  response_headers: v.nullable(v.string()),
  response_body: v.nullable(v.string()),
  truncated: v.number(),
  matched_expected: v.nullable(v.number()),
  error: v.nullable(v.string()),
  created_at: v.string(),
});

const stringMap = v.record(v.string(), v.string());

function flagOf(value: boolean | null): number | null {
  if (value === null) return null;
  return value ? 1 : 0;
}

/** The column holds the envelope text itself; anything else is treated as absent. */
function sealedOf(value: string | null): Sealed | null {
  return value !== null && isSealed(value) ? value : null;
}

function toRecord(row: v.InferOutput<typeof requestRow>): RestRequestRecord {
  return {
    id: row.id,
    adapter_id: row.adapter_id,
    name: row.name,
    method: row.method,
    path: row.path,
    query: v.parse(stringMap, JSON.parse(row.query)),
    headers: v.parse(stringMap, JSON.parse(row.headers)),
    headers_sealed: sealedOf(row.headers_sealed),
    secret_headers: v.parse(v.array(v.string()), JSON.parse(row.secret_headers)),
    body: row.body,
    expected_status: row.expected_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toRun(row: v.InferOutput<typeof runRow>): RestRun {
  return {
    run_id: row.id,
    status_code: row.status_code,
    duration_ms: row.duration_ms ?? 0,
    response_headers:
      row.response_headers === null ? {} : v.parse(stringMap, JSON.parse(row.response_headers)),
    response_body: row.response_body,
    truncated: row.truncated === 1,
    matched_expected: row.matched_expected === null ? null : row.matched_expected === 1,
    error: row.error,
    created_at: row.created_at,
  };
}

export function createRestRepository(db: MetadataDb): RestRepository {
  const one = (where: string, ...params: string[]): RestRequestRecord | null => {
    const row = db.query(`SELECT * FROM rest_requests WHERE ${where}`).get(...params);
    return row === null ? null : toRecord(v.parse(requestRow, row));
  };
  return {
    list: (adapterId) =>
      v
        .parse(
          v.array(requestRow),
          db.query("SELECT * FROM rest_requests WHERE adapter_id = ? ORDER BY name").all(adapterId)
        )
        .map(toRecord),
    byId: (id) => one("id = ?", id),
    byName: (adapterId, name) => one("adapter_id = ? AND name = ?", adapterId, name),
    insert(request) {
      db.query(
        `INSERT INTO rest_requests (id, adapter_id, name, method, path, query, headers, headers_sealed, secret_headers,
           body, expected_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        request.id,
        request.adapter_id,
        request.name,
        request.method,
        request.path,
        JSON.stringify(request.query),
        JSON.stringify(request.headers),
        request.headers_sealed,
        JSON.stringify(request.secret_headers),
        request.body,
        request.expected_status,
        request.created_at,
        request.created_at
      );
      const inserted = one("id = ?", request.id);
      if (inserted === null) throw new Error("rest request insert failed");
      return inserted;
    },
    update(id, patch, at) {
      const sets = ["updated_at = ?"];
      const params: (string | number | null)[] = [at];
      const columns: [string, string | number | null | undefined][] = [
        ["name", patch.name],
        ["method", patch.method],
        ["path", patch.path],
        ["query", patch.query === undefined ? undefined : JSON.stringify(patch.query)],
        ["headers", patch.headers === undefined ? undefined : JSON.stringify(patch.headers)],
        ["headers_sealed", patch.headers_sealed],
        [
          "secret_headers",
          patch.secret_headers === undefined ? undefined : JSON.stringify(patch.secret_headers),
        ],
        ["body", patch.body],
        ["expected_status", patch.expected_status],
      ];
      for (const [column, value] of columns) {
        if (value === undefined) continue;
        sets.push(`${column} = ?`);
        params.push(value);
      }
      db.query(`UPDATE rest_requests SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
    },
    remove(id) {
      db.query("DELETE FROM rest_requests WHERE id = ?").run(id);
    },
    referencedByHook: (id) =>
      v.parse(
        v.object({ n: v.number() }),
        db.query("SELECT COUNT(*) AS n FROM hooks WHERE rest_request_id = ?").get(id)
      ).n > 0,
    insertRun(run) {
      db.query(
        `INSERT INTO rest_request_runs (id, request_id, job_id, hook_run_id, status_code, duration_ms, response_headers,
           response_body, truncated, matched_expected, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        run.id,
        run.request_id,
        run.job_id,
        run.hook_run_id,
        run.status_code,
        run.duration_ms,
        JSON.stringify(run.response_headers),
        run.response_body,
        run.truncated ? 1 : 0,
        flagOf(run.matched_expected),
        run.error,
        run.created_at
      );
      db.query(
        `DELETE FROM rest_request_runs WHERE request_id = ? AND id NOT IN
           (SELECT id FROM rest_request_runs WHERE request_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)`
      ).run(run.request_id, run.request_id, KEEP_RUNS);
      const row = db.query("SELECT * FROM rest_request_runs WHERE id = ?").get(run.id);
      return toRun(v.parse(runRow, row));
    },
    runs(requestId, limit) {
      const rows = db
        .query(
          "SELECT * FROM rest_request_runs WHERE request_id = ? ORDER BY created_at DESC, id DESC LIMIT ?"
        )
        .all(requestId, limit);
      return v.parse(v.array(runRow), rows).map((row) => {
        const { response_headers: _headers, response_body: _body, ...summary } = toRun(row);
        return { ...summary, job_id: row.job_id, hook_run_id: row.hook_run_id };
      });
    },
    run(requestId, runId) {
      const row = db
        .query("SELECT * FROM rest_request_runs WHERE request_id = ? AND id = ?")
        .get(requestId, runId);
      return row === null ? null : toRun(v.parse(runRow, row));
    },
  };
}
