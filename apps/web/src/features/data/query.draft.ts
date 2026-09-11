import type { JsonObject, JsonValue, QueryRequest } from "@testate/shared";
import { jsonObjectSchema, mongoOperationSchema } from "@testate/shared";
import * as v from "valibot";

export const MONGO_OPS = [
  { value: "find", label: "find" },
  { value: "aggregate", label: "aggregate" },
] as const;

export type MongoDraft = {
  op: "find" | "aggregate";
  collection: string;
  filter: string;
  projection: string;
  sort: string;
  pipeline: string;
};

export const EMPTY_MONGO: MongoDraft = {
  op: "find",
  collection: "",
  filter: "{}",
  projection: "",
  sort: "",
  pipeline: "[]",
};

function parseJson(label: string, text: string): JsonObject | JsonObject[] | undefined {
  if (text.trim() === "") return undefined;
  try {
    const raw: unknown = JSON.parse(text);
    return Array.isArray(raw)
      ? v.parse(v.array(jsonObjectSchema), raw)
      : v.parse(jsonObjectSchema, raw);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

/** The request body for the console: SQL text, or the Mongo form parsed into an operation. */
export function buildRequest(
  isMongo: boolean,
  sql: string,
  mongo: MongoDraft,
  rowCap: string
): QueryRequest {
  const cap = Number.parseInt(rowCap, 10);
  const base: QueryRequest = { dialect: isMongo ? "mongo" : "sql", mode: "read" };
  if (Number.isInteger(cap) && cap > 0) base.row_cap = cap;
  if (!isMongo) return { ...base, text: sql };
  const operation: JsonObject = { op: mongo.op, collection: mongo.collection };
  const fields: [string, string][] =
    mongo.op === "find"
      ? [
          ["filter", mongo.filter],
          ["projection", mongo.projection],
          ["sort", mongo.sort],
        ]
      : [["pipeline", mongo.pipeline]];
  for (const [key, text] of fields) {
    const parsed = parseJson(key, text);
    if (parsed !== undefined) operation[key] = parsed;
  }
  const parsed = v.safeParse(mongoOperationSchema, operation);
  if (!parsed.success) throw new Error(parsed.issues.map((issue) => issue.message).join("; "));
  return { ...base, mongo: parsed.output };
}

export type Draft = { sql: string; mongo: MongoDraft };

/**
 * A find and an aggregate over the collection's own fields, every box filled, so the form shows
 * what each one takes. The fields come from its documents: the introspection knows a collection
 * only by `_id` and a `$options` pseudo column, which is no field to query. `_id` is never the
 * field picked: it is in every document and says nothing.
 */
export function mongoSample(collection: string, fields: string[]): MongoDraft {
  const names = fields.filter((name) => name !== "_id" && !name.startsWith("$"));
  const first = names[0] ?? "_id";
  const second = names[1] ?? first;
  const json = (value: JsonValue): string => JSON.stringify(value, null, 2);
  return {
    op: "find",
    collection,
    filter: json({ [first]: { $exists: true } }),
    projection: JSON.stringify({ _id: 1, [first]: 1, [second]: 1 }),
    sort: JSON.stringify({ [first]: 1 }),
    pipeline: json([
      { $match: { [first]: { $exists: true } } },
      { $group: { _id: `$${first}`, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
  };
}

/** History keeps a Mongo run as its operation's JSON and a SQL run as its text. */
export function draftOfText(text: string): Draft {
  try {
    return draftOf({ mongo: v.parse(jsonObjectSchema, JSON.parse(text)) });
  } catch {
    return { sql: text, mongo: EMPTY_MONGO };
  }
}

export function draftOf(body: JsonObject): Draft {
  const text = v.safeParse(v.string(), body["text"]);
  const mongo = v.safeParse(mongoOperationSchema, body["mongo"]);
  if (!mongo.success) return { sql: text.success ? text.output : "", mongo: EMPTY_MONGO };
  const json = (value: JsonValue | undefined): string =>
    value === undefined ? "" : JSON.stringify(value);
  return {
    sql: "",
    mongo: {
      op: mongo.output.op,
      collection: mongo.output.collection,
      filter: json(mongo.output.filter) || "{}",
      projection: json(mongo.output.projection),
      sort: json(mongo.output.sort),
      pipeline: json(mongo.output.pipeline) || "[]",
    },
  };
}

export function saveBlob(download: { blob: Blob; filename: string }): void {
  const url = URL.createObjectURL(download.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = download.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
