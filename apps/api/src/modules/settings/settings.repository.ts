import type { JsonValue } from "@testate/shared";
import { jsonValueSchema } from "@testate/shared";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";

/** Dotted keys with JSON values, per 06 §6.8. */
export type SettingsRepository = {
  all(): Map<string, JsonValue>;
  set(key: string, value: JsonValue, updatedBy: string | null, at: string): void;
};

const row = v.object({ key: v.string(), value: v.string() });

export function createSettingsRepository(db: MetadataDb): SettingsRepository {
  return {
    all() {
      const rows = v.parse(v.array(row), db.query("SELECT key, value FROM settings").all());
      return new Map(
        rows.map((item) => [item.key, v.parse(jsonValueSchema, JSON.parse(item.value))])
      );
    },
    set(key, value, updatedBy, at) {
      db.query(
        `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      ).run(key, JSON.stringify(value), updatedBy, at);
    },
  };
}
