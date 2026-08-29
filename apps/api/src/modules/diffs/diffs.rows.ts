import type { Actor, ColumnPolicy, DiffRow } from "@testate/shared";

import { maskRows } from "../data/data.masks.ts";

export type MaskedDiffRows = { rows: DiffRow[]; masked_columns: string[] };
export type Collected = { page: DiffRow[]; more: boolean };

export function tableKeyOf(schema: string | null, name: string): string {
  return schema === null ? name : `${schema}.${name}`;
}

/** Skips to `offset`, keeps `limit` rows, and notes whether more follow (10 §10.3). */
export async function collectPage(
  rows: AsyncIterable<DiffRow>,
  op: DiffRow["op"] | undefined,
  offset: number,
  limit: number
): Promise<Collected> {
  const page: DiffRow[] = [];
  let seen = 0;
  for await (const row of rows) {
    if (op !== undefined && row.op !== op) continue;
    if (seen >= offset + limit) return { page, more: true };
    if (seen >= offset) page.push(row);
    seen += 1;
  }
  return { page, more: false };
}

/** Masks apply to both sides of a diff row for viewers and agents (20 §20.5). */
export function maskDiffRows(
  actor: Actor,
  policies: ColumnPolicy[],
  rows: DiffRow[]
): MaskedDiffRows {
  const before = maskRows(
    actor,
    rows.map((row) => row.before ?? {}),
    policies
  );
  const after = maskRows(
    actor,
    rows.map((row) => row.after ?? {}),
    policies
  );
  return {
    rows: rows.map((row, index) => ({
      ...row,
      before: row.before === null ? null : (before.rows[index] ?? null),
      after: row.after === null ? null : (after.rows[index] ?? null),
    })),
    masked_columns: before.masked_columns,
  };
}
