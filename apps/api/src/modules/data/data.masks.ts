import type { Actor, ColumnPolicy, JsonObject, JsonValue } from "@testate/shared";
import * as v from "valibot";

import { sha256 } from "../../lib/password/index.ts";

/** Viewers and every agent see masked values; `qa` and `admin` see raw (24 §24.4). */
export function masksApply(actor: Actor): boolean {
  return actor.role === "viewer" || actor.agent;
}

export function maskValue(value: JsonValue, mask: NonNullable<ColumnPolicy["mask"]>): JsonValue {
  if (value === null) return null;
  const text = v.is(v.string(), value) ? value : JSON.stringify(value);
  switch (mask) {
    case "redact":
      return "***";
    case "partial":
      return `${"*".repeat(Math.max(0, text.length - 4))}${text.slice(-4)}`;
    case "hash":
      return sha256(text).slice(0, 8);
  }
}

export type Masked = { rows: JsonObject[]; masked_columns: string[] };

/** Applies the table's masks to every row; `masked_columns` names the columns touched. */
export function maskRows(actor: Actor, rows: JsonObject[], policies: ColumnPolicy[]): Masked {
  const masks = policies.filter((policy) => policy.mask !== null);
  if (!masksApply(actor) || masks.length === 0) return { rows, masked_columns: [] };
  const masked = rows.map((row) => {
    const copy: JsonObject = { ...row };
    for (const policy of masks) {
      const value = copy[policy.column];
      if (value !== undefined && policy.mask !== null)
        copy[policy.column] = maskValue(value, policy.mask);
    }
    return copy;
  });
  return { rows: masked, masked_columns: masks.map((policy) => policy.column) };
}
