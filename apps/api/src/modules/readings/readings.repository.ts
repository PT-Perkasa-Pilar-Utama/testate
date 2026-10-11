import type { Reading, ReadingSource, SeriesLine } from "@testate/shared";
import { readingAdapterSchema, resourceUnitSchema } from "@testate/shared";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";
import { encodeCursor, keysetCondition } from "../../lib/db/keyset.ts";
import type { Keyset } from "../../lib/db/keyset.ts";

const recordSchema = v.object({
  id: v.string(),
  project_id: v.string(),
  source: v.picklist(["manual", "poll"]),
  actor_kind: v.picklist(["user", "token", "system"]),
  actor_id: v.nullable(v.string()),
  actor_label: v.string(),
  body: v.string(),
  taken_at: v.string(),
});

const bucketSchema = v.object({
  bucket: v.number(),
  adapter_id: v.string(),
  name: v.string(),
  source: v.picklist(["host", "server"]),
  value_key: v.string(),
  unit: resourceUnitSchema,
  min: v.number(),
  avg: v.number(),
  max: v.number(),
});

const targetSchema = v.object({ id: v.string(), project_id: v.string() });

/** `actor_id` is null exactly when the monitor took it. */
export type NewReading = Reading & { project_id: string; actor_id: string | null };

/** `from` and `to` as `toISOString()` writes them, so they compare with `taken_at` as text. */
export type SeriesWindow = { from: string; to: string; stepSeconds: number };

export type ReadingsPage = { rows: Reading[]; nextCursor: string | null };

export type ReadingsRepository = {
  insert(reading: NewReading): void;
  byId(projectId: string, id: string): Reading | null;
  /** Newest first. */
  list(projectId: string, limit: number, cursor?: string): ReadingsPage;
  /** Deletes readings of `source` taken before `cutoff`; answers how many went. */
  sweep(source: ReadingSource, cutoff: string): number;
  /** Every adapter and its project: who the monitor polls, and which kept logins stay open. */
  targets(): { id: string; project_id: string }[];
  /** Every value in the window, bucketed by `stepSeconds`: min, mean and max per bucket. */
  series(projectId: string, window: SeriesWindow): SeriesLine[];
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
    source: record.source,
    actor: { kind: record.actor_kind, label: record.actor_label },
    adapters: v.parse(v.array(readingAdapterSchema), JSON.parse(record.body)),
  };
}

export function createReadingsRepository(db: MetadataDb): ReadingsRepository {
  return {
    insert(reading) {
      db.query(
        `INSERT INTO resource_readings
           (id, project_id, source, actor_kind, actor_id, actor_label, body, taken_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        reading.id,
        reading.project_id,
        reading.source,
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
    sweep(source, cutoff) {
      return db
        .query("DELETE FROM resource_readings WHERE source = ? AND taken_at < ?")
        .run(source, cutoff).changes;
    },
    targets() {
      return db
        .query("SELECT id, project_id FROM adapters ORDER BY project_id, id")
        .all()
        .map((row) => v.parse(targetSchema, row));
    },
    series(projectId, window) {
      const rows = db
        .query(SERIES_SQL)
        .all(Date.parse(window.from) / 1000, window.stepSeconds, projectId, window.from, window.to)
        .map((row) => v.parse(bucketSchema, row));
      return linesOf(rows, window);
    },
  };
}

/** One row per adapter, value and bucket; the body is JSON, so SQLite's json_each opens it. */
const SERIES_SQL = `
  SELECT
    CAST((unixepoch(r.taken_at, 'subsec') - ?1) / ?2 AS INTEGER) AS bucket,
    json_extract(a.value, '$.adapter_id') AS adapter_id,
    MAX(json_extract(a.value, '$.name')) AS name,
    json_extract(a.value, '$.source') AS source,
    json_extract(x.value, '$.key') AS value_key,
    MAX(json_extract(x.value, '$.unit')) AS unit,
    MIN(json_extract(x.value, '$.value')) AS min,
    AVG(json_extract(x.value, '$.value')) AS avg,
    MAX(json_extract(x.value, '$.value')) AS max
  FROM resource_readings r, json_each(r.body) a, json_each(a.value, '$.values') x
  WHERE r.project_id = ?3 AND r.taken_at >= ?4 AND r.taken_at <= ?5
  GROUP BY adapter_id, source, value_key, bucket
  ORDER BY adapter_id, source, value_key, bucket`;

type Bucket = v.InferOutput<typeof bucketSchema>;

function linesOf(rows: Bucket[], window: SeriesWindow): SeriesLine[] {
  const from = Date.parse(window.from);
  const lines = new Map<string, SeriesLine>();
  for (const row of rows) {
    const id = `${row.adapter_id}\u0000${row.source}\u0000${row.value_key}`;
    const line = lines.get(id) ?? {
      adapter_id: row.adapter_id,
      name: row.name,
      source: row.source,
      key: row.value_key,
      unit: row.unit,
      points: [],
    };
    const t = new Date(from + row.bucket * window.stepSeconds * 1000).toISOString();
    line.points.push({ t, min: row.min, avg: row.avg, max: row.max });
    lines.set(id, line);
  }
  return [...lines.values()];
}
