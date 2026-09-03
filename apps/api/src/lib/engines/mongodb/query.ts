import { BSON } from "mongodb";
import type { Document, Filter, Sort } from "mongodb";
import { mongoOperationSchema } from "@testate/shared";
import type { JsonObject, JsonValue } from "@testate/shared";
import * as v from "valibot";

import { EngineError, rowText } from "../types.ts";
import type {
  EngineQuery,
  PageQuery,
  QueryOptions,
  QueryResult,
  RowFilter,
  RowText,
  RowsPageResult,
  RunningQuery,
  TerminateResult,
} from "../types.ts";
import type { MongoHandle } from "./client.ts";
import { byteLength, decodeDocument, encodeDocument } from "./codec.ts";

const COMMENT_PREFIX = "testate:";

const currentOp = v.object({
  inprog: v.array(
    v.object({
      opid: v.union([v.number(), v.string()]),
      currentOpTime: v.optional(v.string()),
      command: v.optional(v.record(v.string(), v.unknown())),
      op: v.optional(v.string()),
      ns: v.optional(v.string()),
    })
  ),
});

/** The query text is the `mongo` operation as JSON (06 §6.7); SQL text has no meaning here. */
export function parseOperation(text: string): v.InferOutput<typeof mongoOperationSchema> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new EngineError("unsupported", "a MongoDB query is a JSON operation, not SQL text");
  }
  const parsed = v.safeParse(mongoOperationSchema, raw);
  if (!parsed.success) throw new EngineError("unsupported", "invalid mongo operation");
  return parsed.output;
}

/** Filters and pipelines arrive as JSON; Extended JSON in them becomes BSON (ObjectId, Date). */
function toBson(value: JsonValue | undefined): Document {
  return value === undefined ? {} : decodeDocument(JSON.stringify(value));
}

function sortOf(sort: JsonValue | undefined): Sort {
  // SAFETY: mongoOperationSchema validated `sort` as a JSON object; the driver accepts any such document.
  return toBson(sort) as Sort;
}

function columnsOf(documents: Document[]): string[] {
  const names = new Set<string>();
  for (const document of documents) for (const key of Object.keys(document)) names.add(key);
  return [...names];
}

/** find or aggregate under the row, byte, and time budgets; write stages are refused (12 §12.1). */
export async function runQuery(
  handle: MongoHandle,
  query: EngineQuery,
  opts: QueryOptions
): Promise<QueryResult> {
  if (opts.mode === "write")
    throw new EngineError("unsupported", "the Document tier has no write queries", {
      reason: "tier",
    });
  const operation = parseOperation(query.text);
  const started = Date.now();
  const collection = handle.db.collection(operation.collection);
  const comment = `${COMMENT_PREFIX}${opts.queryId}`;
  const limit = Math.min(operation.limit ?? opts.rowCap, opts.rowCap) + 1;
  const cursor =
    operation.op === "find"
      ? collection
          .find(toBson(operation.filter), { comment, maxTimeMS: opts.timeBudgetMs })
          .project(toBson(operation.projection))
          .sort(sortOf(operation.sort))
          .skip(operation.skip ?? 0)
          .limit(limit)
      : collection.aggregate(
          [
            ...(operation.pipeline ?? []).map((stage) => {
              const bson = toBson(stage);
              const key = Object.keys(bson)[0] ?? "";
              if (["$out", "$merge"].includes(key))
                throw new EngineError(
                  "unsupported",
                  `${key} writes; the Document tier is read-only`
                );
              return bson;
            }),
            { $limit: limit },
          ],
          { comment, maxTimeMS: opts.timeBudgetMs }
        );
  const rows: RowText[] = [];
  const documents: Document[] = [];
  let bytes = 0;
  let truncated = false;
  for await (const document of cursor) {
    if (rows.length >= limit - 1) {
      truncated = true;
      break;
    }
    const text = encodeDocument(document);
    bytes += byteLength(text);
    if (bytes > opts.byteBudget) {
      truncated = true;
      break;
    }
    rows.push(rowText(text));
    documents.push(document);
  }
  await cursor.close();
  return {
    columns: columnsOf(documents),
    rows,
    rowsAffected: null,
    truncated,
    durationMs: Date.now() - started,
  };
}

export async function listRunningQueries(handle: MongoHandle): Promise<RunningQuery[]> {
  const ops = v.parse(currentOp, await handle.db.admin().command({ currentOp: 1, active: true }));
  return ops.inprog
    .filter((op) => String(op.command?.["comment"] ?? "").startsWith(COMMENT_PREFIX))
    .map((op) => ({
      pid: String(op.opid),
      startedAt: op.currentOpTime ?? "",
      text: JSON.stringify(op.command ?? {}),
      state: op.op ?? "",
    }));
}

/** `killOp` per operation id (13 §13.6); an id the server rejects is reported as failed. */
export async function terminateSessions(
  handle: MongoHandle,
  ids: string[]
): Promise<TerminateResult> {
  const result: TerminateResult = { terminated: [], failed: [] };
  for (const id of ids) {
    const op = /^\d+$/.test(id) ? Number(id) : id;
    try {
      await handle.db.admin().command({ killOp: 1, op });
      result.terminated.push(id);
    } catch {
      result.failed.push(id);
    }
  }
  return result;
}

/** `killOp` on the operation tagged with the query id; nothing to kill is not an error. */
export async function cancelQuery(handle: MongoHandle, queryId: string): Promise<void> {
  const ops = v.parse(currentOp, await handle.db.admin().command({ currentOp: 1, active: true }));
  const target = ops.inprog.find((op) => op.command?.["comment"] === `${COMMENT_PREFIX}${queryId}`);
  if (target === undefined) return;
  await handle.db.admin().command({ killOp: 1, op: target.opid });
}

type BsonValue = JsonValue | BSON.ObjectId | BSON.Long | Date;

/**
 * Grid filters arrive as text, and the grid shows an ObjectId, a Long, and a Date as plain text,
 * so a person types back what they see. Every form the text can mean is matched, the typed one
 * first: a string never equals an ObjectId in a Mongo comparison.
 */
function forms(text: string): BsonValue[] {
  if (/^[0-9a-f]{24}$/i.test(text)) return [new BSON.ObjectId(text), text];
  if (/^-?\d+$/.test(text) && !Number.isSafeInteger(Number(text)))
    return [BSON.Long.fromString(text), text];
  if (/^-?\d+(\.\d+)?$/.test(text)) return [Number(text)];
  if (text === "true" || text === "false") return [text === "true"];
  if (/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(text) && !Number.isNaN(Date.parse(text)))
    return [new Date(text), text];
  return [text];
}

function anyOf(column: string, values: BsonValue[], negated: boolean): Document {
  if (values.length === 1 && !negated) return { [column]: values[0] };
  return { [column]: { [negated ? "$nin" : "$in"]: values } };
}

const COMPARISONS = { lt: "$lt", le: "$lte", gt: "$gt", ge: "$gte" } as const;

function filterOf(filter: RowFilter): Document {
  switch (filter.op) {
    case "eq":
      return anyOf(filter.column, forms(filter.value), false);
    case "ne":
      return anyOf(filter.column, forms(filter.value), true);
    case "like":
      return { [filter.column]: { $regex: filter.value.replaceAll("%", ".*"), $options: "i" } };
    case "in":
      return anyOf(filter.column, filter.value.split(",").flatMap(forms), false);
    case "null":
      return { [filter.column]: null };
    case "notnull":
      return { [filter.column]: { $ne: null } };
    default:
      return { [filter.column]: { [COMPARISONS[filter.op]]: forms(filter.value)[0] } };
  }
}

type CursorPlan = { filter: Document | null; offset: number };

/** A keyset cursor is the last `_id` as Extended JSON; an offset cursor is a number. */
function cursorFilter(query: PageQuery, keyset: boolean): CursorPlan {
  if (query.cursor === undefined) return { filter: null, offset: 0 };
  if (!keyset) return { filter: null, offset: Number.parseInt(query.cursor, 10) || 0 };
  const last = decodeDocument(query.cursor)["_id"];
  return { filter: { _id: query.order === "asc" ? { $gt: last } : { $lt: last } }, offset: 0 };
}

function nextCursorOf(
  page: Document[],
  more: boolean,
  keyset: boolean,
  offset: number
): string | null {
  const tail = page.at(-1);
  if (!more || tail === undefined) return null;
  return keyset ? encodeDocument({ _id: tail["_id"] }) : String(offset + page.length);
}

/** Grid pages: keyset on `_id` when unsorted, else offset; string filters compare as strings. */
export async function pageRows(handle: MongoHandle, query: PageQuery): Promise<RowsPageResult> {
  const collection = handle.db.collection(query.table.name);
  const keyset = query.sort === undefined;
  const cursor = cursorFilter(query, keyset);
  const filters: Document[] = query.filters.map(filterOf);
  if (cursor.filter !== null) filters.push(cursor.filter);
  const filter: Filter<Document> = filters.length === 0 ? {} : { $and: filters };
  const direction = query.order === "asc" ? 1 : -1;
  const sort: Sort = { [query.sort ?? "_id"]: direction, _id: direction };
  const documents = await collection
    .find(filter)
    .sort(sort)
    .skip(cursor.offset)
    .limit(query.limit + 1)
    .toArray();
  const page = documents.slice(0, query.limit);
  return {
    rows: page.map((document) => rowText(encodeDocument(document))),
    columns: columnsOf(page).map((name) => ({ name, type: "any" })),
    nextCursor: nextCursorOf(page, documents.length > query.limit, keyset, cursor.offset),
    kind: keyset ? "keyset" : "offset",
  };
}

export type { JsonObject };
