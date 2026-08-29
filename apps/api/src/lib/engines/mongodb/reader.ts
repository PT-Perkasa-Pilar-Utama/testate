import type { ClientSession, Collection, Document, Filter } from "mongodb";
import type { EngineWarning, TableRef, TableSchema } from "@testate/shared";

import { swallow } from "../mysql/reader.ts";
import type {
  EncodedRow,
  ManifestEntry,
  RowChunk,
  SnapshotManifest,
  SnapshotOptions,
  SnapshotRun,
} from "../types.ts";
import { MAX_DOCUMENT_BYTES, byteLength, encodeRow } from "./codec.ts";
import type { MongoHandle } from "./client.ts";
import { translate } from "./client.ts";
import { introspect } from "./introspect.ts";
import type { Topology } from "./probe.ts";
import { topologyOf } from "./probe.ts";

const DEFAULT_CHUNK_ROWS = 5000;
const CHUNK_BYTES = 8 * 1024 * 1024;

export type ReadOpts = {
  chunkRows: number;
  signal: AbortSignal | undefined;
  session?: ClientSession;
};

/** Documents in `_id` order through the native cursor; a chunk closes at 5 000 rows or 8 MiB (12 §12.1). */
export async function* readCollection(
  collection: Collection,
  table: TableSchema,
  opts: ReadOpts
): AsyncGenerator<RowChunk, ManifestEntry> {
  const ref: TableRef = { schema: null, name: table.name };
  const warnings: EngineWarning[] = [];
  const findOptions = opts.session === undefined ? {} : { session: opts.session };
  const cursor = collection.find({}, findOptions).sort({ _id: 1 });
  let rows = 0;
  let bytes = 0;
  let batch: EncodedRow[] = [];
  let batchBytes = 0;
  const flush = (): RowChunk => {
    const chunk = { table: ref, rows: batch, bytes: batchBytes };
    batch = [];
    batchBytes = 0;
    return chunk;
  };
  try {
    for await (const document of cursor) {
      if (opts.signal?.aborted) throw new Error("snapshot cancelled");
      const encoded = encodeRow(document);
      const size = byteLength(encoded.json);
      if (size > MAX_DOCUMENT_BYTES) {
        warnings.push({
          code: "document_too_large",
          table: table.name,
          message: `document ${encoded.key.value[0]} is ${size} bytes when encoded; skipped`,
        });
        continue;
      }
      batch.push(encoded);
      batchBytes += size;
      rows += 1;
      bytes += size;
      if (batch.length >= opts.chunkRows || batchBytes >= CHUNK_BYTES) yield flush();
    }
  } finally {
    await swallow(cursor.close());
  }
  if (batch.length > 0) yield flush();
  return { ref, rows, bytes, sort: "primary-key", warnings };
}

/**
 * One instant per snapshot on a replica set through a `snapshot` read concern session; a standalone
 * server reads best effort and says so in the manifest (12 §12.1).
 */
export function snapshot(
  handle: MongoHandle,
  topology: Topology,
  opts: SnapshotOptions
): SnapshotRun {
  const chunkRows = opts.chunkRows ?? DEFAULT_CHUNK_ROWS;
  let resolveManifest: (manifest: SnapshotManifest) => void = () => undefined;
  let rejectManifest: (cause: unknown) => void = () => undefined;
  const manifest = new Promise<SnapshotManifest>((resolve, reject) => {
    resolveManifest = resolve;
    rejectManifest = reject;
  });
  void swallow(manifest);
  let session: ClientSession | null = null;
  const release = async (): Promise<void> => {
    if (session === null) return;
    const open = session;
    session = null;
    await swallow(open.endSession());
  };
  async function* chunks(): AsyncGenerator<RowChunk> {
    try {
      const warnings: EngineWarning[] = [];
      if (topology.replicaSet) {
        session = handle.client.startSession({ snapshot: true });
      } else {
        warnings.push({
          code: "best_effort",
          message: "standalone MongoDB: collections are read one after another without a snapshot",
        });
      }
      const introspection = await introspect(
        handle.db,
        opts.excludeTables,
        topology.timeSeriesDeletes
      );
      const entries: ManifestEntry[] = [];
      for (const table of introspection.tables) {
        if (table.excluded) continue;
        const readOpts: ReadOpts = { chunkRows, signal: opts.signal };
        if (session !== null) readOpts.session = session;
        const entry = yield* readCollection(handle.db.collection(table.name), table, readOpts);
        warnings.push(...entry.warnings);
        entries.push(entry);
      }
      resolveManifest({
        introspection,
        fingerprint: introspection.fingerprint,
        engineVersion: topology.version,
        consistency: topology.replicaSet ? "snapshot" : "best_effort",
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

export async function readTopology(handle: MongoHandle): Promise<Topology> {
  return topologyOf(handle);
}

export type { Filter, Document };
