import { createdRangeConditions } from "../../lib/db/date-range.ts";
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
  project_id: v.nullable(v.string()),
  project_slug: v.nullable(v.string()),
  adapter_id: v.nullable(v.string()),
  adapter_name: v.nullable(v.string()),
  details: v.string(),
  outcome: v.nullable(v.picklist(["succeeded", "failed", "partial"])),
  ip: v.nullable(v.string()),
  user_agent: v.nullable(v.string()),
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
  project_id: string | null;
  project_slug: string | null;
  adapter_id: string | null;
  adapter_name: string | null;
  details: JsonObject;
  outcome: "succeeded" | "failed" | "partial" | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
};

export type AuditListQuery = {
  limit: number;
  cursor?: string;
  project_id?: string;
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  outcome?: "succeeded" | "failed" | "partial";
  /** Rows limited to these project ids for scoped tokens; null means every row (09 §9.5). */
  scope?: string[] | null;
};

export type AuditPage = { rows: AuditRow[]; nextCursor: string | null };

export type AuditRepository = {
  insert(row: AuditInsert): void;
  list(query: AuditListQuery): AuditPage;
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
    project:
      record.project_slug === null ? null : { id: record.project_id, slug: record.project_slug },
    adapter:
      record.adapter_name === null ? null : { id: record.adapter_id, name: record.adapter_name },
    details: v.parse(jsonObjectSchema, JSON.parse(record.details)),
    outcome: record.outcome,
    ip: record.ip,
    user_agent: record.user_agent,
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

const FILTERS: readonly { key: keyof AuditListQuery; sql: string; like?: boolean }[] = [
  { key: "project_id", sql: "project_id = ?" },
  { key: "actor", sql: "actor_label = ?" },
  { key: "action", sql: "action LIKE ?", like: true },
  { key: "outcome", sql: "outcome = ?" },
];

/** Equality filters plus a prefix match on action; the cursor is a keyset on (created_at, id). */
function conditions(query: AuditListQuery): Condition[] {
  const found: Condition[] = [];
  for (const filter of FILTERS) {
    const value = query[filter.key];
    if (value === undefined || value === "") continue;
    found.push({ sql: filter.sql, params: [filter.like === true ? `${value}%` : String(value)] });
  }
  // Not in FILTERS above: a bare "2026-08-30" as the upper bound compares less than every timestamp
  // on that day, so a to-bound silently dropped the whole day it named.
  found.push(...createdRangeConditions("created_at", query.from, query.to));
  if (query.scope !== undefined && query.scope !== null) {
    const marks = query.scope.map(() => "?").join(",");
    found.push({ sql: `project_id IN (${marks === "" ? "NULL" : marks})`, params: query.scope });
  }
  if (query.cursor !== undefined) {
    const after = decodeCursor(query.cursor);
    found.push({
      sql: "(created_at < ? OR (created_at = ? AND id < ?))",
      params: [after.created_at, after.created_at, after.id],
    });
  }
  return found;
}

export function createAuditRepository(db: MetadataDb): AuditRepository {
  const insert = db.query(
    `INSERT INTO audit_logs (id, actor_user_id, actor_token_id, actor_label, action, target_type, target_id,
       project_id, project_slug, adapter_id, adapter_name, details, outcome, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        row.project_id,
        row.project_slug,
        row.adapter_id,
        row.adapter_name,
        JSON.stringify(row.details),
        row.outcome,
        row.ip,
        row.user_agent,
        row.created_at
      );
    },
    list(query) {
      const found = conditions(query);
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
