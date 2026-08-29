import type { JsonValue } from "@testate/shared";
import { jsonValueSchema } from "@testate/shared";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";

/** Dotted keys with JSON values, per 06 §6.8. */
export type SettingsRepository = {
  all(): Map<string, JsonValue>;
  set(key: string, value: JsonValue, updatedBy: string | null, at: string): void;
  /** Every key in one transaction: a concurrent reader never sees half of a multi-key write. */
  setMany(entries: [string, JsonValue][], updatedBy: string | null, at: string): void;
};

const row = v.object({ key: v.string(), value: v.string() });

function write(
  db: MetadataDb,
  key: string,
  value: JsonValue,
  updatedBy: string | null,
  at: string
): void {
  db.query(
    `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(value), updatedBy, at);
}

export function createSettingsRepository(db: MetadataDb): SettingsRepository {
  return {
    all() {
      const rows = v.parse(v.array(row), db.query("SELECT key, value FROM settings").all());
      return new Map(
        rows.map((item) => [item.key, v.parse(jsonValueSchema, JSON.parse(item.value))])
      );
    },
    set(key, value, updatedBy, at) {
      write(db, key, value, updatedBy, at);
    },
    setMany(entries, updatedBy, at) {
      db.transaction(() => {
        for (const [key, value] of entries) write(db, key, value, updatedBy, at);
      })();
    },
  };
}
