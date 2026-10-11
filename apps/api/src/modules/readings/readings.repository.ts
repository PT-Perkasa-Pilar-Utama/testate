import type { Reading } from "@testate/shared";
import { readingAdapterSchema } from "@testate/shared";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";
import { encodeCursor, keysetCondition } from "../../lib/db/keyset.ts";
import type { Keyset } from "../../lib/db/keyset.ts";

const recordSchema = v.object({
  id: v.string(),
  project_id: v.string(),
  actor_kind: v.picklist(["user", "token"]),
  actor_id: v.string(),
  actor_label: v.string(),
  body: v.string(),
  taken_at: v.string(),
});

export type NewReading = Reading & { project_id: string; actor_id: string };

export type ReadingsPage = { rows: Reading[]; nextCursor: string | null };

export type ReadingsRepository = {
  insert(reading: NewReading): void;
  byId(projectId: string, id: string): Reading | null;
  /** Newest first. */
  list(projectId: string, limit: number, cursor?: string): ReadingsPage;
  /** Deletes readings taken before `cutoff`; answers how many went. */
  sweep(cutoff: string): number;
};

const NEWEST: Keyset = {
  sort: "taken_at",
  order: "desc",
  column: "taken_at",
  id: "id",
  idOrder: "desc",
};

type ReadingRecord = v.InferOutput<typeof recordSchema>;

function toReading(record: ReadingRecord): Reading {
  return {
    id: record.id,
    taken_at: record.taken_at,
    actor: { kind: record.actor_kind, label: record.actor_label },
    adapters: v.parse(v.array(readingAdapterSchema), JSON.parse(record.body)),
  };
}

export function createReadingsRepository(db: MetadataDb): ReadingsRepository {
  return {
    insert(reading) {
      db.query(
        `INSERT INTO resource_readings
           (id, project_id, actor_kind, actor_id, actor_label, body, taken_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        reading.id,
        reading.project_id,
        reading.actor.kind,
        reading.actor_id,
        reading.actor.label,
        JSON.stringify(reading.adapters),
        reading.taken_at
      );
    },
    byId(projectId, id) {
      const row = db
        .query("SELECT * FROM resource_readings WHERE project_id = ? AND id = ?")
        .get(projectId, id);
      return row === null ? null : toReading(v.parse(recordSchema, row));
    },
    list(projectId, limit, cursor) {
      const after = keysetCondition(NEWEST, cursor);
      const where = after === null ? "" : ` AND ${after.sql}`;
      const rows = db
        .query(
          `SELECT * FROM resource_readings WHERE project_id = ?${where}
           ORDER BY taken_at DESC, id DESC LIMIT ?`
        )
        .all(projectId, ...(after?.params ?? []), limit + 1)
        .map((row) => toReading(v.parse(recordSchema, row)));
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        rows: page,
        nextCursor:
          rows.length > limit && last !== undefined
            ? encodeCursor(NEWEST, [last.taken_at, last.id])
            : null,
      };
    },
    sweep(cutoff) {
      return db.query("DELETE FROM resource_readings WHERE taken_at < ?").run(cutoff).changes;
    },
  };
}
