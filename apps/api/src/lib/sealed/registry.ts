import * as v from "valibot";

import type { MetadataDb } from "../db/index.ts";
import { isSealed, kidOfSealed, reseal } from "./index.ts";
import type { KeyRing, Sealed } from "./index.ts";

/**
 * Every sealed column (17 §17.4). Adding a `*_sealed` column updates this list and the spec table
 * in the same change. The sealed `settings` keys live in `SEALED_SETTINGS_KEYS` and sweep below.
 */
export const SEALED_COLUMNS = [
  { table: "adapters", column: "config_sealed", owner: "adapter" },
  { table: "adapters", column: "readonly_config_sealed", owner: "adapter" },
  { table: "rest_requests", column: "headers_sealed", owner: "rest_request" },
] as const;

export type SealedColumn = (typeof SEALED_COLUMNS)[number];

export type Unreadable = { table: string; column: string; rowId: string; kid: string };

export type SweepReport = { reSealed: number; unreadable: Unreadable[]; skipped: number };

/** The additional data that binds a ciphertext to its cell, so a value cannot be moved. */
export function aadFor(table: string, column: string, rowId: string): string {
  return `${table}:${column}:${rowId}`;
}

const rowSchema = v.object({ id: v.string(), value: v.string() });

async function sweepColumn(
  ring: KeyRing,
  db: MetadataDb,
  entry: SealedColumn,
  report: SweepReport
): Promise<void> {
  const rows = v.parse(
    v.array(rowSchema),
    db
      .query(
        `SELECT id, ${entry.column} AS value FROM ${entry.table} WHERE ${entry.column} IS NOT NULL`
      )
      .all()
  );
  for (const row of rows) {
    if (!isSealed(row.value)) {
      report.unreadable.push({
        table: entry.table,
        column: entry.column,
        rowId: row.id,
        kid: "malformed",
      });
      continue;
    }
    // SAFETY: isSealed validated the envelope format on the line above.
    const sealed = row.value as Sealed;
    const kid = kidOfSealed(sealed);
    if (kid === ring.activeKid) {
      report.skipped += 1;
      continue;
    }
    if (!ring.all.has(kid)) {
      report.unreadable.push({ table: entry.table, column: entry.column, rowId: row.id, kid });
      continue;
    }
    const next = await reseal(ring, sealed, aadFor(entry.table, entry.column, row.id));
    if (next === null) continue;
    db.query(`UPDATE ${entry.table} SET ${entry.column} = ? WHERE id = ?`).run(next, row.id);
    report.reSealed += 1;
  }
}

const SEALED_SETTINGS_KEYS = ["store.s3.access_key_id", "store.s3.secret_access_key"];
const settingRow = v.object({ key: v.string(), value: v.string() });

/** Settings keep the sealed S3 keys as JSON strings under dotted keys, bound to `settings:<key>:global`. */
async function sweepSettings(ring: KeyRing, db: MetadataDb, report: SweepReport): Promise<void> {
  const rows = v.parse(
    v.array(settingRow),
    db
      .query(
        `SELECT key, value FROM settings WHERE key IN (${SEALED_SETTINGS_KEYS.map(() => "?").join(", ")})`
      )
      .all(...SEALED_SETTINGS_KEYS)
  );
  for (const row of rows) {
    const value = v.safeParse(v.string(), JSON.parse(row.value));
    if (!value.success || !isSealed(value.output)) {
      report.unreadable.push({
        table: "settings",
        column: row.key,
        rowId: "global",
        kid: "malformed",
      });
      continue;
    }
    // SAFETY: isSealed validated the envelope format on the line above.
    const sealed = value.output as Sealed;
    const kid = kidOfSealed(sealed);
    if (kid === ring.activeKid) {
      report.skipped += 1;
      continue;
    }
    if (!ring.all.has(kid)) {
      report.unreadable.push({ table: "settings", column: row.key, rowId: "global", kid });
      continue;
    }
    const next = await reseal(ring, sealed, aadFor("settings", row.key, "global"));
    if (next === null) continue;
    db.query("UPDATE settings SET value = ? WHERE key = ?").run(JSON.stringify(next), row.key);
    report.reSealed += 1;
  }
}

/** Re-seals every stored value under the active key and lists what no configured key opens (17 §17.3). */
export async function sweep(ring: KeyRing, db: MetadataDb): Promise<SweepReport> {
  const report: SweepReport = { reSealed: 0, unreadable: [], skipped: 0 };
  for (const entry of SEALED_COLUMNS) await sweepColumn(ring, db, entry, report);
  await sweepSettings(ring, db, report);
  return report;
}

/** The framed boot message, or null when one key is configured and nothing changed. */
export function banner(report: SweepReport, ring: KeyRing): string | null {
  if (report.reSealed > 0 && report.unreadable.length === 0) return "SECRET KEY ROTATION COMPLETE";
  if (ring.all.size > 1 && report.reSealed === 0 && report.unreadable.length === 0) {
    return "EXTRA VALUE STILL CONFIGURED";
  }
  return null;
}

/** Declared loss (17 §17.6): owners of unreadable values are disabled until a credential is re-entered. */
export function disableUnreadableOwners(db: MetadataDb, report: SweepReport, at: string): number {
  let disabled = 0;
  for (const item of report.unreadable) {
    if (item.table === "adapters") {
      db.query(
        "UPDATE adapters SET status = 'disabled', status_message = 'credential_unreadable', updated_at = ? WHERE id = ?"
      ).run(at, item.rowId);
      disabled += 1;
    }
  }
  return disabled;
}
