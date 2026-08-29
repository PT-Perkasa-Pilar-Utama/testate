import type { Actor, ManifestTable, TableRef } from "@testate/shared";
import * as v from "valibot";

import type { BlobStore } from "../../lib/blobstore/index.ts";
import { toConnectionConfig } from "../../lib/engines/connection.ts";
import { sameTable } from "../../lib/engines/index.ts";
import type { EncodedRow, EngineRegistry, RowChunk, SnapshotRun } from "../../lib/engines/index.ts";
import { AppError, notFound } from "../../lib/http/index.ts";
import type { KeyRing } from "../../lib/sealed/index.ts";
import { encodeChunks } from "../../lib/snapshot/codec.ts";
import type { AdaptersRepository } from "../adapters/adapters.repository.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import { CONFIG_COLUMN, openSecrets } from "../adapters/adapters.secrets.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { JobRunner } from "../jobs/jobs.dispatcher.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import type { AdapterManifest, StatesRepository } from "./states.repository.ts";

export type SnapshotDeps = {
  engines: EngineRegistry;
  blobs: BlobStore;
  ring: KeyRing;
  adapters: AdaptersRepository;
  states: StatesRepository;
  projects: Pick<ProjectsRepository, "setHead" | "byId">;
  audit: AuditService;
  now: () => Date;
};

const initPayload = v.object({ init: v.literal(true), adapter_id: v.string() });

type TableStream = { table: TableRef; rows: AsyncIterable<EncodedRow> };
type Cursor = { next: IteratorResult<RowChunk> };

/** Rows of one table, pulled from the shared cursor until the next chunk names another table. */
async function* rowsOf(
  iterator: AsyncIterator<RowChunk>,
  cursor: Cursor,
  table: TableRef
): AsyncIterable<EncodedRow> {
  while (!cursor.next.done && sameTable(cursor.next.value.table, table)) {
    yield* cursor.next.value.rows;
    cursor.next = await iterator.next();
  }
}

/** Splits the engine's chunk stream into one row stream per table; the engine emits tables contiguously. */
async function* tableStreams(chunks: AsyncIterable<RowChunk>): AsyncIterable<TableStream> {
  const iterator = chunks[Symbol.asyncIterator]();
  const cursor: Cursor = { next: await iterator.next() };
  const seen = new Set<string>();
  while (!cursor.next.done) {
    const table = cursor.next.value.table;
    const key = `${table.schema ?? ""}.${table.name}`;
    if (seen.has(key)) throw new Error(`engine emitted table ${key} twice`);
    seen.add(key);
    yield { table, rows: rowsOf(iterator, cursor, table) };
  }
}

/** Every table blob written and pinned; returns the manifest tables (15 §15.3). */
async function writeBlobs(
  deps: SnapshotDeps,
  run: SnapshotRun,
  jobId: string,
  progress: (done: number, table: string) => void
): Promise<ManifestTable[]> {
  const tables: ManifestTable[] = [];
  for await (const stream of tableStreams(run)) {
    let rows = 0;
    let bytes = 0;
    const counted = (async function* (): AsyncIterable<EncodedRow> {
      for await (const row of stream.rows) {
        rows += 1;
        bytes += row.json.length;
        yield row;
      }
    })();
    const put = await deps.blobs.put(encodeChunks(counted), {});
    deps.states.recordBlob(put.hash, put.size, jobId, deps.now().toISOString());
    tables.push({
      schema: stream.table.schema,
      name: stream.table.name,
      rows,
      bytes,
      blob_hash: put.hash,
      sort: "primary-key",
      warnings: [],
    });
    progress(tables.length, stream.table.name);
  }
  return tables;
}

/** Runs one adapter's snapshot to completion and returns its manifest row. */
export async function snapshotAdapter(
  deps: SnapshotDeps,
  adapter: AdapterRecord,
  jobId: string,
  signal: AbortSignal,
  progress: (done: number, table: string) => void
): Promise<AdapterManifest> {
  const secrets = await openSecrets(deps.ring, adapter.id, CONFIG_COLUMN, adapter.config_sealed);
  const config = toConnectionConfig(adapter.engine, adapter.config, secrets);
  const engine = deps.engines.require(adapter.engine);
  const run = engine.snapshot({ connectionId: adapter.id, config }, { excludeTables: [], signal });
  try {
    const tables = await writeBlobs(deps, run, jobId, progress);
    const manifest = await run.manifest;
    for (const table of tables) {
      const entry = manifest.tables.find((item) => sameTable(item.ref, table));
      if (entry === undefined) continue;
      table.sort = entry.sort;
      table.warnings = entry.warnings;
    }
    return {
      adapter_id: adapter.id,
      adapter_name: adapter.name,
      engine: adapter.engine,
      engine_version: manifest.engineVersion,
      fingerprint: manifest.fingerprint,
      consistency: manifest.consistency,
      tables,
      introspection: manifest.introspection,
      row_count: tables.reduce((total, table) => total + table.rows, 0),
      byte_count: tables.reduce((total, table) => total + table.bytes, 0),
      warnings: manifest.warnings,
    };
  } finally {
    await run[Symbol.asyncDispose]();
    await engine.evict(adapter.id);
  }
}

/** `init`, then `init-<adapter>`, then a suffixed name, so a re-created adapter never collides (05 §5.8). */
function initName(states: StatesRepository, projectId: string, adapter: AdapterRecord): string {
  const candidates = [
    "init",
    `init-${adapter.name}`,
    `init-${adapter.name}-${adapter.id.slice(-6)}`,
  ];
  const free = candidates.find((name) => !states.nameTaken(projectId, name));
  if (free === undefined)
    throw new AppError("CONFLICT", "no free init state name", { adapter_id: adapter.id });
  return free;
}

/** The `snapshot` job for `{ init: true }` payloads: one adapter, protected, HEAD moves to it (08 §8.4). */
export function createInitSnapshotRunner(deps: SnapshotDeps): JobRunner {
  return async ({ job, signal, progress }) => {
    const payload = v.parse(initPayload, job.payload);
    const adapter = deps.adapters.byId(payload.adapter_id);
    if (adapter === null) throw notFound("adapter");
    const actor: Actor = job.actor;
    const stateId = Bun.randomUUIDv7();
    const name = initName(deps.states, adapter.project_id, adapter);
    const at = deps.now().toISOString();
    deps.states.insert({
      id: stateId,
      project_id: adapter.project_id,
      name,
      kind: "init",
      protected: true,
      parent_state_id: null,
      job_id: job.id,
      actor,
      created_at: at,
    });
    try {
      const manifest = await snapshotAdapter(deps, adapter, job.id, signal, (done, table) =>
        progress({ phase: "snapshot", adapter_id: adapter.id, tables_done: done, table })
      );
      const size = deps.states.commitManifest(stateId, [manifest], deps.now().toISOString());
      deps.projects.setHead(adapter.project_id, stateId, "at_state", deps.now().toISOString());
      deps.audit.record({
        actor,
        action: "state.created",
        target_type: "state",
        target_id: stateId,
        project: {
          id: adapter.project_id,
          slug: deps.projects.byId(adapter.project_id)?.slug ?? "",
        },
        adapter: { id: adapter.id, name: adapter.name },
        details: { kind: "init", name, tables: manifest.tables.length, size_bytes: size },
        outcome: "succeeded",
      });
      return {
        status: "succeeded",
        result: {
          state_id: stateId,
          name,
          tables: manifest.tables.length,
          rows: manifest.row_count,
          size_bytes: size,
        },
      };
    } catch (cause: unknown) {
      deps.states.setStatus(stateId, "failed", deps.now().toISOString());
      throw cause;
    } finally {
      deps.states.releasePins(job.id);
    }
  };
}
