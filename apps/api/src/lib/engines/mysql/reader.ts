import type { SQL } from "bun";
import type { EngineWarning, Introspection, TableRef, TableSchema } from "@testate/shared";
import { jsonValueSchema } from "@testate/shared";
import * as v from "valibot";

import { sha256 } from "../../password/index.ts";
import { rowText } from "../types.ts";
import type {
  EncodedRow,
  ManifestEntry,
  RowChunk,
  SnapshotManifest,
  SnapshotOptions,
  SnapshotRun,
} from "../types.ts";
import { translate } from "./errors.ts";
import { introspect } from "./introspect.ts";
import { quoteIdent } from "./pool.ts";

const DEFAULT_CHUNK_ROWS = 5000;

type Reserved = Awaited<ReturnType<SQL["reserve"]>>;

const fetchRow = v.object({ j: v.string(), k: v.nullable(v.string()) });
const versionRow = v.object({ v: v.string() });

/** Numbers that a double cannot hold stay text (12 §12.4); everything else keeps its JSON type. */
function cell(column: TableSchema["columns"][number]): string {
  const name = quoteIdent(column.name);
  if (/^(bigint|decimal|numeric)/i.test(column.type)) return `CAST(t.${name} AS CHAR)`;
  if (/^(binary|varbinary|blob|tinyblob|mediumblob|longblob|bit)/i.test(column.type))
    return `HEX(t.${name})`;
  if (/^(geometry|point|linestring|polygon|multi|geometrycollection)/i.test(column.type))
    return `ST_AsText(t.${name})`;
  return `t.${name}`;
}

/** `JSON_OBJECT('c', ...)` cast to text so the row never round-trips through the driver's JSON parser. */
export function rowJson(table: TableSchema): string {
  const pairs = table.columns.map((column) => `${JSON.stringify(column.name)}, ${cell(column)}`);
  return `CAST(JSON_OBJECT(${pairs.join(", ")}) AS CHAR)`;
}

export async function swallow(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    return;
  }
}

/** The last row's key as bind parameters for the next keyset page. */
function nextKey(tail: v.InferOutput<typeof fetchRow> | undefined): string[] | null {
  if (tail === undefined || tail.k === null) return null;
  return v.parse(v.array(v.union([v.string(), v.number()])), JSON.parse(tail.k)).map(String);
}

function keyJson(pk: string[]): string {
  return `CAST(JSON_ARRAY(${pk.map((column) => `t.${quoteIdent(column)}`).join(", ")}) AS CHAR)`;
}

type Page = { text: string; params: string[] };

/** Keyset page after `last` on the primary key, or an offset page over the JSON text for PK-less tables. */
function pageStatement(
  table: TableSchema,
  pk: string[],
  last: string[] | null,
  offset: number,
  chunkRows: number
): Page {
  const keyset = pk.length > 0;
  const columns = pk.map((column) => `t.${quoteIdent(column)}`).join(", ");
  const where =
    keyset && last !== null ? `WHERE (${columns}) > (${last.map(() => "?").join(", ")})` : "";
  const order = keyset ? columns : rowJson(table);
  const key = keyset ? keyJson(pk) : "NULL";
  const tail = keyset ? "" : ` OFFSET ${offset}`;
  return {
    text: `SELECT ${rowJson(table)} AS j, ${key} AS k FROM ${quoteIdent(table.name)} t ${where} ORDER BY ${order} LIMIT ${chunkRows}${tail}`,
    params: last ?? [],
  };
}

function encodeRows(fetched: v.InferOutput<typeof fetchRow>[], keyset: boolean): EncodedRow[] {
  return fetched.map((row) => ({
    key:
      keyset && row.k !== null
        ? { by: "primary-key", value: v.parse(v.array(jsonValueSchema), JSON.parse(row.k)) }
        : { by: "row-hash", value: sha256(row.j) },
    json: rowText(row.j),
  }));
}

/** Keyset on the primary key inside the consistent snapshot; PK-less tables page by offset over the JSON text. */
async function* readTableRows(
  conn: Reserved,
  table: TableSchema,
  chunkRows: number,
  signal: AbortSignal | undefined
): AsyncGenerator<RowChunk, ManifestEntry> {
  const ref: TableRef = { schema: null, name: table.name };
  const pk = table.primary_key ?? [];
  const keyset = pk.length > 0;
  let last: string[] | null = null;
  let offset = 0;
  let rows = 0;
  let bytes = 0;
  for (;;) {
    if (signal?.aborted) throw new Error("snapshot cancelled");
    const page = pageStatement(table, pk, last, offset, chunkRows);
    const fetched = v.parse(v.array(fetchRow), [...(await conn.unsafe(page.text, page.params))]);
    if (fetched.length === 0) break;
    const encoded = encodeRows(fetched, keyset);
    const size = encoded.reduce((total, row) => total + row.json.length, 0);
    rows += encoded.length;
    bytes += size;
    offset += fetched.length;
    last = keyset ? nextKey(fetched.at(-1)) : null;
    yield { table: ref, rows: encoded, bytes: size };
    if (fetched.length < chunkRows) break;
  }
  return { ref, rows, bytes, sort: keyset ? "primary-key" : "row-hash", warnings: [] };
}

/** `START TRANSACTION WITH CONSISTENT SNAPSHOT` on a reserved connection; one instant for every InnoDB table. */
export function snapshot(sql: SQL, opts: SnapshotOptions): SnapshotRun {
  const chunkRows = opts.chunkRows ?? DEFAULT_CHUNK_ROWS;
  let resolveManifest: (manifest: SnapshotManifest) => void = () => undefined;
  let rejectManifest: (cause: unknown) => void = () => undefined;
  const manifest = new Promise<SnapshotManifest>((resolve, reject) => {
    resolveManifest = resolve;
    rejectManifest = reject;
  });
  void swallow(manifest);
  let reserved: Reserved | null = null;
  const release = async (): Promise<void> => {
    if (reserved === null) return;
    const handle = reserved;
    reserved = null;
    await swallow(handle.unsafe("ROLLBACK"));
    handle.release();
  };
  async function* chunks(): AsyncGenerator<RowChunk> {
    try {
      reserved = await sql.reserve();
      const conn = reserved;
      await conn.unsafe("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await conn.unsafe("SET SESSION time_zone = '+00:00'");
      await conn.unsafe("START TRANSACTION WITH CONSISTENT SNAPSHOT");
      const version = v.parse(versionRow, (await conn.unsafe("SELECT VERSION() AS v"))[0]).v;
      const introspection: Introspection = await introspect(conn, opts.excludeTables);
      const entries: ManifestEntry[] = [];
      const warnings: EngineWarning[] = [];
      for (const table of introspection.tables) {
        if (table.excluded) continue;
        if (table.unsupported.length > 0)
          warnings.push({
            code: "best_effort",
            table: table.name,
            message: "non-transactional table read outside the snapshot",
          });
        entries.push(yield* readTableRows(conn, table, chunkRows, opts.signal));
      }
      resolveManifest({
        introspection,
        fingerprint: introspection.fingerprint,
        engineVersion: /^(\d+\.\d+(?:\.\d+)?)/.exec(version)?.[1] ?? version,
        consistency: warnings.length === 0 ? "snapshot" : "best_effort",
        tables: entries,
        warnings,
      });
    } catch (cause: unknown) {
      const error = translate(cause, "snapshot");
      rejectManifest(error);
      throw error;
    } finally {
      await release();
    }
  }
  return { manifest, [Symbol.asyncIterator]: chunks, [Symbol.asyncDispose]: release };
}
