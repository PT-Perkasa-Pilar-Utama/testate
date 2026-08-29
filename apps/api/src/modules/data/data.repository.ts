import type { JsonObject } from "@testate/shared";
import { jsonObjectSchema } from "@testate/shared";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";

export type WriteSessionRecord = {
  id: string;
  adapter_id: string;
  user_id: string;
  started_at: string;
  last_write_at: string | null;
  ended_at: string | null;
  stash_state_id: string | null;
  write_count: number;
  foreign_key_checks: boolean;
};

export type HistoryRow = {
  id: string;
  adapter_id: string;
  user_id: string | null;
  token_id: string | null;
  query_hash: string;
  query_text: string;
  mode: "read" | "write";
  duration_ms: number | null;
  row_count: number | null;
  error: string | null;
  created_at: string;
};

export type SavedQueryRecord = {
  id: string;
  adapter_id: string;
  name: string;
  body: JsonObject;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type HistoryFilter = {
  limit: number;
  mode?: "read" | "write";
  /** Null lists every caller's rows (admin); otherwise the user's own. */
  userId: string | null;
};

export type DataRepository = {
  openSession(adapterId: string, userId: string): WriteSessionRecord | null;
  sessionById(id: string): WriteSessionRecord | null;
  insertSession(
    session: Omit<
      WriteSessionRecord,
      "last_write_at" | "ended_at" | "stash_state_id" | "write_count"
    >
  ): WriteSessionRecord;
  setForeignKeyChecks(id: string, enabled: boolean): void;
  /** One more write; the first one records the stash the session took (06 §6.4). */
  recordWrite(id: string, at: string, stashStateId: string | null): void;
  endSession(id: string, at: string): void;
  insertHistory(row: HistoryRow): void;
  history(adapterId: string, filter: HistoryFilter): HistoryRow[];
  savedQueries(adapterId: string): SavedQueryRecord[];
  savedQuery(id: string): SavedQueryRecord | null;
  savedQueryByName(adapterId: string, name: string): SavedQueryRecord | null;
  insertSavedQuery(query: SavedQueryRecord): void;
  updateSavedQuery(id: string, patch: { name?: string; body?: JsonObject }, at: string): void;
  removeSavedQuery(id: string): void;
};

const sessionRow = v.object({
  id: v.string(),
  adapter_id: v.string(),
  user_id: v.string(),
  started_at: v.string(),
  last_write_at: v.nullable(v.string()),
  ended_at: v.nullable(v.string()),
  stash_state_id: v.nullable(v.string()),
  write_count: v.number(),
  foreign_key_checks: v.number(),
});

const historyRow = v.object({
  id: v.string(),
  adapter_id: v.string(),
  user_id: v.nullable(v.string()),
  token_id: v.nullable(v.string()),
  query_hash: v.string(),
  query_text: v.string(),
  mode: v.picklist(["read", "write"]),
  duration_ms: v.nullable(v.number()),
  row_count: v.nullable(v.number()),
  error: v.nullable(v.string()),
  created_at: v.string(),
});

const savedRow = v.object({
  id: v.string(),
  adapter_id: v.string(),
  name: v.string(),
  body: v.string(),
  created_by: v.string(),
  created_at: v.string(),
  updated_at: v.string(),
});

function toSession(row: v.InferOutput<typeof sessionRow>): WriteSessionRecord {
  return { ...row, foreign_key_checks: row.foreign_key_checks === 1 };
}

function toSaved(row: v.InferOutput<typeof savedRow>): SavedQueryRecord {
  return { ...row, body: v.parse(jsonObjectSchema, JSON.parse(row.body)) };
}

export function createDataRepository(db: MetadataDb): DataRepository {
  const session = (where: string, ...params: string[]): WriteSessionRecord | null => {
    const row = db.query(`SELECT * FROM write_sessions WHERE ${where}`).get(...params);
    return row === null ? null : toSession(v.parse(sessionRow, row));
  };
  const saved = (where: string, ...params: string[]): SavedQueryRecord | null => {
    const row = db.query(`SELECT * FROM saved_queries WHERE ${where}`).get(...params);
    return row === null ? null : toSaved(v.parse(savedRow, row));
  };
  return {
    openSession: (adapterId, userId) =>
      session("adapter_id = ? AND user_id = ? AND ended_at IS NULL", adapterId, userId),
    sessionById: (id) => session("id = ?", id),
    insertSession(input) {
      db.query(
        `INSERT INTO write_sessions (id, adapter_id, user_id, started_at, foreign_key_checks)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        input.id,
        input.adapter_id,
        input.user_id,
        input.started_at,
        input.foreign_key_checks ? 1 : 0
      );
      const inserted = session("id = ?", input.id);
      if (inserted === null) throw new Error("write session insert failed");
      return inserted;
    },
    setForeignKeyChecks(id, enabled) {
      db.query("UPDATE write_sessions SET foreign_key_checks = ? WHERE id = ?").run(
        enabled ? 1 : 0,
        id
      );
    },
    recordWrite(id, at, stashStateId) {
      db.query(
        `UPDATE write_sessions SET write_count = write_count + 1, last_write_at = ?,
           stash_state_id = COALESCE(stash_state_id, ?) WHERE id = ?`
      ).run(at, stashStateId, id);
    },
    endSession(id, at) {
      db.query("UPDATE write_sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL").run(
        at,
        id
      );
    },
    insertHistory(row) {
      db.query(
        `INSERT INTO query_history (id, adapter_id, user_id, token_id, query_hash, query_text, mode, duration_ms,
           row_count, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        row.id,
        row.adapter_id,
        row.user_id,
        row.token_id,
        row.query_hash,
        row.query_text,
        row.mode,
        row.duration_ms,
        row.row_count,
        row.error,
        row.created_at
      );
    },
    history(adapterId, filter) {
      const where = ["adapter_id = ?"];
      const params: (string | number)[] = [adapterId];
      if (filter.userId !== null) {
        where.push("user_id = ?");
        params.push(filter.userId);
      }
      if (filter.mode !== undefined) {
        where.push("mode = ?");
        params.push(filter.mode);
      }
      const rows = db
        .query(
          `SELECT * FROM query_history WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`
        )
        .all(...params, filter.limit);
      return v.parse(v.array(historyRow), rows);
    },
    savedQueries: (adapterId) =>
      v
        .parse(
          v.array(savedRow),
          db.query("SELECT * FROM saved_queries WHERE adapter_id = ? ORDER BY name").all(adapterId)
        )
        .map(toSaved),
    savedQuery: (id) => saved("id = ?", id),
    savedQueryByName: (adapterId, name) => saved("adapter_id = ? AND name = ?", adapterId, name),
    insertSavedQuery(query) {
      db.query(
        `INSERT INTO saved_queries (id, adapter_id, name, body, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        query.id,
        query.adapter_id,
        query.name,
        JSON.stringify(query.body),
        query.created_by,
        query.created_at,
        query.updated_at
      );
    },
    updateSavedQuery(id, patch, at) {
      const sets = ["updated_at = ?"];
      const params: string[] = [at];
      if (patch.name !== undefined) {
        sets.push("name = ?");
        params.push(patch.name);
      }
      if (patch.body !== undefined) {
        sets.push("body = ?");
        params.push(JSON.stringify(patch.body));
      }
      db.query(`UPDATE saved_queries SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
    },
    removeSavedQuery(id) {
      db.query("DELETE FROM saved_queries WHERE id = ?").run(id);
    },
  };
}
