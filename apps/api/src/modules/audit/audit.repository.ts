import { createdRangeConditions } from "../../lib/db/date-range.ts";
import { likeTerm } from "../../lib/db/like.ts";
import type { AuditRow, JsonObject } from "@testate/shared";
import { jsonObjectSchema } from "@testate/shared";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";

const auditRecordSchema = v.object({
  id: v.string(),
  actor_user_id: v.nullable(v.string()),
  actor_token_id: v.nullable(v.string()),
  actor_label: v.string(),
  action: v.string(),
  target_type: v.string(),
  target_id: v.string(),
  target_label: v.nullable(v.string()),
  project_id: v.nullable(v.string()),
  project_slug: v.nullable(v.string()),
  adapter_id: v.nullable(v.string()),
  adapter_name: v.nullable(v.string()),
  details: v.string(),
  outcome: v.nullable(v.picklist(["succeeded", "failed", "partial"])),
  ip: v.nullable(v.string()),
  user_agent: v.nullable(v.string()),
  request_id: v.nullable(v.string()),
  created_at: v.string(),
});
type AuditRecord = v.InferOutput<typeof auditRecordSchema>;

export type AuditInsert = {
  id: string;
  actor_user_id: string | null;
  actor_token_id: string | null;
  actor_label: string;
  action: string;
  target_type: string;
  target_id: string;
  target_label: string | null;
  project_id: string | null;
  project_slug: string | null;
  adapter_id: string | null;
  adapter_name: string | null;
  details: JsonObject;
  outcome: "succeeded" | "failed" | "partial" | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: string;
};

export type AuditListQuery = {
  limit: number;
  cursor?: string;
  project_id?: string;
  /** One substring over the actor, the action and the target's name. */
  q?: string;
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  outcome?: "succeeded" | "failed" | "partial";
  /** Rows limited to these project ids for scoped tokens; null means every row (09 §9.5). */
  scope?: string[] | null;
  /**
   * Whether rows with no project (boot, settings, users, keys) are in: the admin's, as the jobs
   * list already holds; absent means yes, which is what the service's own callers expect.
   */
  includeInstance?: boolean;
};

export type AuditPage = { rows: AuditRow[]; nextCursor: string | null };

export type AuditRepository = {
  insert(row: AuditInsert): void;
  /** One row by id, under the same scope as the list; null when it is not there or not yours. */
  find(id: string, query: Pick<AuditListQuery, "scope" | "includeInstance">): AuditRow | null;
  list(query: AuditListQuery): AuditPage;
  /** How many rows the filter matches, ignoring the page. */
  total(query: AuditListQuery): number;
};

function actorOf(record: AuditRecord): AuditRow["actor"] {
  if (record.actor_user_id !== null) {
    return { kind: "user", id: record.actor_user_id, label: record.actor_label };
  }
  if (record.actor_token_id !== null) {
    return { kind: "token", id: record.actor_token_id, label: record.actor_label };
  }
  return { kind: "system", id: null, label: record.actor_label };
}

function toRow(record: AuditRecord): AuditRow {
  return {
    id: record.id,
    actor: actorOf(record),
    action: record.action,
    target_type: record.target_type,
    target_id: record.target_id,
    target_label: record.target_label,
    project:
      record.project_slug === null ? null : { id: record.project_id, slug: record.project_slug },
    adapter:
      record.adapter_name === null ? null : { id: record.adapter_id, name: record.adapter_name },
    details: v.parse(jsonObjectSchema, JSON.parse(record.details)),
    outcome: record.outcome,
    ip: record.ip,
    user_agent: record.user_agent,
    request_id: record.request_id,
    created_at: record.created_at,
  };
}

const cursorSchema = v.object({ created_at: v.string(), id: v.string() });

export function encodeCursor(created_at: string, id: string): string {
  return Buffer.from(JSON.stringify({ created_at, id })).toString("base64url");
}

export function decodeCursor(cursor: string): { created_at: string; id: string } {
  return v.parse(cursorSchema, JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
}

type Condition = { sql: string; params: string[] };

/**
 * `actor` matched the label exactly and `action` matched a prefix, so "adm" found nothing at all
 * and "login" never found "auth.login". Both are substrings now, which is what a person typing part
 * of a name means, and `q` is the one box that looks in all three places at once.
 */
const EXACT: readonly { key: keyof AuditListQuery; sql: string }[] = [
  { key: "project_id", sql: "project_id = ?" },
  { key: "outcome", sql: "outcome = ?" },
];

const SUBSTRING: readonly { key: keyof AuditListQuery; column: string }[] = [
  { key: "actor", column: "actor_label" },
  { key: "action", column: "action" },
];

/** The label if the row has one, else the id, so a search still reaches rows written before it. */
const TARGET = "COALESCE(target_label, target_id)";

/** The named boxes: an exact match where the value is one of a set, a substring where it is typed. */
function namedFilters(query: AuditListQuery): Condition[] {
  const found: Condition[] = [];
  for (const filter of EXACT) {
    const value = query[filter.key];
    if (value !== undefined && value !== "")
      found.push({ sql: filter.sql, params: [String(value)] });
  }
  for (const filter of SUBSTRING) {
    const value = query[filter.key];
    if (value === undefined || value === "") continue;
    found.push({ sql: `${filter.column} LIKE ? ESCAPE '\\'`, params: [likeTerm(String(value))] });
  }
  return found;
}

/** Everything that narrows the list. The cursor is added by `list` alone, so `total` can share this. */
function conditions(query: AuditListQuery): Condition[] {
  const found: Condition[] = namedFilters(query);
  if (query.q !== undefined && query.q !== "") {
    const like = likeTerm(query.q);
    found.push({
      sql: `(actor_label LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\' OR ${TARGET} LIKE ? ESCAPE '\\')`,
      params: [like, like, like],
    });
  }
  // A bare "2026-08-30" as the upper bound compares less than every timestamp on that day, so a
  // to-bound silently dropped the whole day it named.
  found.push(...createdRangeConditions("created_at", query.from, query.to));
  if (query.scope !== undefined && query.scope !== null) {
    const marks = query.scope.map(() => "?").join(",");
    found.push({ sql: `project_id IN (${marks === "" ? "NULL" : marks})`, params: query.scope });
  } else if (query.includeInstance === false) {
    found.push({ sql: "project_id IS NOT NULL", params: [] });
  }
  return found;
}

/** The page's own condition. Counting from the cursor answers "how many are left", not "how many". */
function afterCursor(query: AuditListQuery): Condition | null {
  if (query.cursor === undefined) return null;
  const after = decodeCursor(query.cursor);
  return {
    sql: "(created_at < ? OR (created_at = ? AND id < ?))",
    params: [after.created_at, after.created_at, after.id],
  };
}

export function createAuditRepository(db: MetadataDb): AuditRepository {
  const insert = db.query(
    `INSERT INTO audit_logs (id, actor_user_id, actor_token_id, actor_label, action, target_type, target_id, target_label,
       project_id, project_slug, adapter_id, adapter_name, details, outcome, ip, user_agent, request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  return {
    insert(row) {
      insert.run(
        row.id,
        row.actor_user_id,
        row.actor_token_id,
        row.actor_label,
        row.action,
        row.target_type,
        row.target_id,
        row.target_label,
        row.project_id,
        row.project_slug,
        row.adapter_id,
        row.adapter_name,
        JSON.stringify(row.details),
        row.outcome,
        row.ip,
        row.user_agent,
        row.request_id,
        row.created_at
      );
    },
    find(id, query) {
      const found = conditions({ limit: 1, ...query });
      found.push({ sql: "id = ?", params: [id] });
      const record = db
        .query(`SELECT * FROM audit_logs WHERE ${found.map((item) => item.sql).join(" AND ")}`)
        .get(...found.flatMap((item) => item.params));
      return record === null ? null : toRow(v.parse(auditRecordSchema, record));
    },
    total(query) {
      const found = conditions(query);
      const where =
        found.length === 0 ? "" : ` WHERE ${found.map((item) => item.sql).join(" AND ")}`;
      const row = db
        .query(`SELECT COUNT(*) AS n FROM audit_logs${where}`)
        .get(...found.flatMap((item) => item.params));
      return v.parse(v.object({ n: v.number() }), row).n;
    },
    list(query) {
      const found = conditions(query);
      const after = afterCursor(query);
      if (after !== null) found.push(after);
      const where =
        found.length === 0 ? "" : ` WHERE ${found.map((item) => item.sql).join(" AND ")}`;
      const params = found.flatMap((item) => item.params);
      const records = db
        .query(`SELECT * FROM audit_logs${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
        .all(...params, query.limit + 1);
      const rows = v.parse(v.array(auditRecordSchema), records).map(toRow);
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor =
        rows.length > query.limit && last !== undefined
          ? encodeCursor(last.created_at, last.id)
          : null;
      return { rows: page, nextCursor };
    },
  };
}
