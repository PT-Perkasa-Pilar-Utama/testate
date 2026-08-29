import { BSON } from "mongodb";
import type { Document } from "mongodb";
import { jsonObjectSchema } from "@testate/shared";
import * as v from "valibot";

import { rowText } from "../types.ts";
import type { DisplayRow, EncodedRow, RowText } from "../types.ts";

/** A document over this size when encoded cannot be inserted back; the snapshot skips it (12 §12.4). */
export const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;

/** Canonical Extended JSON: ObjectId, Date, Decimal128, Binary, Long, and Regex survive the round trip. */
export function encodeDocument(document: Document): string {
  return BSON.EJSON.stringify(document, { relaxed: false });
}

export function decodeDocument(text: string): Document {
  const parsed: unknown = BSON.EJSON.parse(text, { relaxed: false });
  return v.parse(v.record(v.string(), v.unknown()), parsed);
}

/** The `_id` in canonical form is the sort key, so equal documents sort equally across snapshots. */
export function encodeRow(document: Document): EncodedRow {
  const json = encodeDocument(document);
  return {
    key: { by: "primary-key", value: [BSON.EJSON.stringify(document["_id"], { relaxed: false })] },
    json: rowText(json),
  };
}

/** The grid shows the canonical form (`{"$oid": ...}`), never a JavaScript number for a Long or Decimal. */
export function decodeRow(row: RowText): DisplayRow {
  return v.parse(jsonObjectSchema, JSON.parse(row));
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
