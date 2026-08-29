import type { Actor, ColumnPolicy } from "@testate/shared";
import { maskSchema, requiredFunctionSchema } from "@testate/shared";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";
import { forbidden, notFound } from "../../lib/http/index.ts";

export type PolicyInput = Omit<ColumnPolicy, "locked" | "updated_at">;

export type PoliciesRepository = {
  list(adapterId: string, table?: string): ColumnPolicy[];
  byColumn(adapterId: string, table: string, column: string): ColumnPolicy | null;
  upsert(adapterId: string, input: PolicyInput, userId: string, at: string): ColumnPolicy;
  setLocked(adapterId: string, table: string, column: string, locked: boolean, at: string): void;
  remove(adapterId: string, table: string, column: string): void;
};

const policyRow = v.object({
  table_name: v.string(),
  column_name: v.string(),
  required_function: v.nullable(v.string()),
  mask: v.nullable(maskSchema),
  display: v.number(),
  locked: v.number(),
  updated_at: v.string(),
});

function toPolicy(row: v.InferOutput<typeof policyRow>): ColumnPolicy {
  return {
    table: row.table_name,
    column: row.column_name,
    required_function:
      row.required_function === null
        ? null
        : v.parse(requiredFunctionSchema, JSON.parse(row.required_function)),
    mask: row.mask,
    display: row.display === 1,
    locked: row.locked === 1,
    updated_at: row.updated_at,
  };
}

export function createPoliciesRepository(db: MetadataDb): PoliciesRepository {
  const one = (adapterId: string, table: string, column: string): ColumnPolicy | null => {
    const row = db
      .query(
        "SELECT * FROM column_policies WHERE adapter_id = ? AND table_name = ? AND column_name = ?"
      )
      .get(adapterId, table, column);
    return row === null ? null : toPolicy(v.parse(policyRow, row));
  };
  return {
    list(adapterId, table) {
      const rows =
        table === undefined
          ? db
              .query(
                "SELECT * FROM column_policies WHERE adapter_id = ? ORDER BY table_name, column_name"
              )
              .all(adapterId)
          : db
              .query(
                "SELECT * FROM column_policies WHERE adapter_id = ? AND table_name = ? ORDER BY column_name"
              )
              .all(adapterId, table);
      return v.parse(v.array(policyRow), rows).map(toPolicy);
    },
    byColumn: one,
    upsert(adapterId, input, userId, at) {
      db.transaction(() => {
        // One display column per table (06 §6.12).
        if (input.display) {
          db.query(
            "UPDATE column_policies SET display = 0 WHERE adapter_id = ? AND table_name = ?"
          ).run(adapterId, input.table);
        }
        db.query(
          `INSERT INTO column_policies (id, adapter_id, table_name, column_name, required_function, mask, display, locked, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
           ON CONFLICT (adapter_id, table_name, column_name) DO UPDATE SET
             required_function = excluded.required_function, mask = excluded.mask, display = excluded.display, updated_at = excluded.updated_at`
        ).run(
          Bun.randomUUIDv7(),
          adapterId,
          input.table,
          input.column,
          input.required_function === null ? null : JSON.stringify(input.required_function),
          input.mask,
          input.display ? 1 : 0,
          userId,
          at,
          at
        );
      })();
      const saved = one(adapterId, input.table, input.column);
      if (saved === null) throw new Error("policy upsert failed");
      return saved;
    },
    setLocked(adapterId, table, column, locked, at) {
      db.query(
        "UPDATE column_policies SET locked = ?, updated_at = ? WHERE adapter_id = ? AND table_name = ? AND column_name = ?"
      ).run(locked ? 1 : 0, at, adapterId, table, column);
    },
    remove(adapterId, table, column) {
      db.query(
        "DELETE FROM column_policies WHERE adapter_id = ? AND table_name = ? AND column_name = ?"
      ).run(adapterId, table, column);
    },
  };
}

/** A locked policy answers `FORBIDDEN` to anyone below admin (06 §6.12). */
export function assertEditable(actor: Actor, existing: ColumnPolicy | null): void {
  if (existing?.locked === true && actor.role !== "admin") throw forbidden("policy is locked");
}

export function requirePolicy(existing: ColumnPolicy | null): ColumnPolicy {
  if (existing === null) throw notFound("policy");
  return existing;
}
