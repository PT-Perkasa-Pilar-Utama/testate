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
import { quoteIdent, quoteTable } from "./pool.ts";

const DEFAULT_CHUNK_ROWS = 5000;

/** Awaits a promise whose failure is reported elsewhere, so it never surfaces as unhandled. */
export async function swallow(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    return;
  }
}
const CHUNK_BYTES = 8 * 1024 * 1024;

type Reserved = Awaited<ReturnType<SQL["reserve"]>>;

const fetchRow = v.object({ j: v.string(), k: v.nullable(v.string()) });
const versionRow = v.object({ text: v.string() });

/** `SELECT to_jsonb(t)::text ... ORDER BY <pk>` with the key alongside; row-hash tables sort by the JSON text. */
type Select = { sql: string; sort: ManifestEntry["sort"] };

function selectFor(table: TableSchema): Select {
  const from = `FROM ONLY ${quoteTable(table.schema, table.name)} t`;
  const pk = table.primary_key;
  if (pk !== null && pk.length > 0) {
    const key = `jsonb_build_array(${pk.map((column) => `t.${quoteIdent(column)}`).join(", ")})::text`;
    const order = pk.map((column) => `t.${quoteIdent(column)}`).join(", ");
    return {
      sql: `SELECT to_jsonb(t)::text AS j, ${key} AS k ${from} ORDER BY ${order}`,
      sort: "primary-key",
    };
  }
  return {
    sql: `SELECT to_jsonb(t)::text AS j, NULL::text AS k ${from} ORDER BY to_jsonb(t)::text`,
    sort: "row-hash",
  };
}

function encode(row: v.InferOutput<typeof fetchRow>, sort: ManifestEntry["sort"]): EncodedRow {
  const json = rowText(row.j);
  if (sort === "primary-key" && row.k !== null) {
    return {
      key: { by: "primary-key", value: v.parse(v.array(jsonValueSchema), JSON.parse(row.k)) },
      json,
    };
  }
  return { key: { by: "row-hash", value: sha256(row.j) }, json };
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("snapshot cancelled");
}

/** One table through a server-side cursor; returns the manifest entry once the cursor is drained. */
async function* readCursor(
  conn: Reserved,
  table: TableSchema,
  index: number,
  chunkRows: number,
  signal: AbortSignal | undefined,
  warnings: EngineWarning[]
): AsyncGenerator<RowChunk, ManifestEntry> {
  const ref: TableRef = { schema: table.schema, name: table.name };
  const { sql: select, sort } = selectFor(table);
  const cursor = `testate_c${index}`;
  await conn.unsafe(`DECLARE ${cursor} NO SCROLL CURSOR FOR ${select}`);
  let rows = 0;
  let bytes = 0;
  for (;;) {
    const fetched = v.parse(v.array(fetchRow), [
      ...(await conn.unsafe(`FETCH FORWARD ${chunkRows} FROM ${cursor}`)),
    ]);
    if (fetched.length === 0) break;
    const encoded = fetched.map((row) => encode(row, sort));
    const size = encoded.reduce((total, row) => total + row.json.length, 0);
    rows += encoded.length;
    bytes += size;
    yield { table: ref, rows: encoded, bytes: size };
    if (size > CHUNK_BYTES)
      warnings.push({ code: "wide_rows", table: table.name, message: "a chunk exceeded 8 MiB" });
    assertNotCancelled(signal);
  }
  await conn.unsafe(`CLOSE ${cursor}`);
  return { ref, rows, bytes, sort, warnings: [] };
}

/**
 * One repeatable-read, read-only transaction on a reserved connection; one server-side cursor per
 * table, drained in chunks (ADR 0001 implementation rules). Dispose rolls back and releases.
 */
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
      await conn.unsafe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await conn.unsafe("SET LOCAL TIME ZONE 'UTC'");
      const version = v.parse(versionRow, (await conn.unsafe("SELECT version() AS text"))[0]).text;
      const introspection: Introspection = await introspect(conn, opts.excludeTables, opts.schemas);
      const entries: ManifestEntry[] = [];
      const warnings: EngineWarning[] = [];
      for (const [index, table] of introspection.tables.entries()) {
        if (table.excluded) continue;
        assertNotCancelled(opts.signal);
        // A state that holds an unsupported column says so, every time (73).
        for (const item of table.unsupported) {
          warnings.push({
            code: "unsupported_column",
            table: table.name,
            column: item.column,
            message: item.reason,
          });
        }
        entries.push(yield* readCursor(conn, table, index, chunkRows, opts.signal, warnings));
      }
      resolveManifest({
        introspection,
        fingerprint: introspection.fingerprint,
        engineVersion: /PostgreSQL (\S+)/.exec(version)?.[1] ?? version,
        consistency: "snapshot",
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

  return {
    manifest,
    [Symbol.asyncIterator]: chunks,
    [Symbol.asyncDispose]: release,
  };
}

/** One table, same read path, no manifest; the grid and diffs use it. */
export async function* readTable(
  sql: SQL,
  table: TableSchema,
  chunkRows = DEFAULT_CHUNK_ROWS
): AsyncIterable<RowChunk> {
  const run = snapshot(sql, { excludeTables: [], chunkRows });
  const wanted: TableRef = { schema: table.schema, name: table.name };
  for await (const chunk of run) {
    if (chunk.table.schema === wanted.schema && chunk.table.name === wanted.name) yield chunk;
  }
}
