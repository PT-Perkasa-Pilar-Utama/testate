import type { Db, Document } from "mongodb";
import type { Introspection, TableRef, TableSchema } from "@testate/shared";
import * as v from "valibot";

import { computeFingerprint } from "../pure/fingerprint.ts";

const collectionInfo = v.object({
  name: v.string(),
  type: v.optional(v.string()),
  options: v.optional(v.custom<Document>(() => true)),
});

export type CollectionOptions = { capped: boolean; timeseries: boolean; validator: string | null };

/** Collection options that decide whether documents fit or constraints hold (14 §14.1). */
export function optionsOf(options: Document | undefined): CollectionOptions {
  return {
    capped: options?.["capped"] === true,
    timeseries: options?.["timeseries"] !== undefined,
    validator: options?.["validator"] === undefined ? null : JSON.stringify(options["validator"]),
  };
}

/**
 * A collection is a table with one key column; its options travel as a pseudo column named
 * `$options` so the fingerprint sees a capped, time-series, or validator change (14 §14.1).
 * ponytail: index definitions are excluded on purpose (14 §14.1); document shapes are not sampled.
 */
export function collectionTable(
  name: string,
  options: CollectionOptions,
  excluded: TableRef[],
  timeSeriesDeletes: boolean
): TableSchema {
  const unsupported: TableSchema["unsupported"] = [];
  if (options.timeseries && !timeSeriesDeletes)
    unsupported.push({ column: "$timeseries", reason: "time-series deletes need MongoDB 7.0" });
  return {
    schema: null,
    name,
    kind: "table",
    row_estimate: 0,
    columns: [
      {
        name: "_id",
        type: "any",
        nullable: false,
        has_default: true,
        generated: false,
        identity: false,
        policy: { required_function: null, mask: null },
      },
      {
        name: "$options",
        type: JSON.stringify(options),
        nullable: true,
        has_default: true,
        generated: true,
        identity: false,
        policy: { required_function: null, mask: null },
      },
    ],
    primary_key: ["_id"],
    foreign_keys_out: [],
    foreign_keys_in: [],
    unique: [],
    unsupported,
    excluded: excluded.some((ref) => ref.name === name),
    display_column: null,
  };
}

/** `listCollections` with options (12 §12.2); views are listed apart and never restored. */
export async function introspect(
  db: Db,
  excluded: TableRef[],
  timeSeriesDeletes: boolean
): Promise<Introspection> {
  const raw = await db.listCollections({}, { nameOnly: false }).toArray();
  const infos = v
    .parse(v.array(collectionInfo), raw)
    .filter((item) => !item.name.startsWith("system."));
  infos.sort((a, b) => a.name.localeCompare(b.name));
  const views: TableRef[] = [];
  const tables: TableSchema[] = [];
  for (const info of infos) {
    if (info.type === "view") views.push({ schema: null, name: info.name });
    else
      tables.push(collectionTable(info.name, optionsOf(info.options), excluded, timeSeriesDeletes));
  }
  for (const table of tables) {
    table.row_estimate = await db.collection(table.name).estimatedDocumentCount();
  }
  const introspection: Introspection = {
    tier: "document",
    fingerprint: "",
    tables,
    views,
    warnings: [],
  };
  introspection.fingerprint = computeFingerprint(introspection);
  return introspection;
}
