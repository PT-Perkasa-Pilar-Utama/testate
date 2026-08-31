import type { Actor, ManifestTable, TableRef, JsonObject } from "@testate/shared";
import * as v from "valibot";

import { runLanes } from "../../lib/async/lanes.ts";

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
import type { JobRunner, JobRunnerContext } from "../jobs/jobs.dispatcher.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import type { AdapterManifest, StatesRepository } from "./states.repository.ts";

export type SnapshotDeps = {
  engines: EngineRegistry;
  blobs: BlobStore;
  ring: KeyRing;
  adapters: AdaptersRepository;
  states: StatesRepository;
  projects: Pick<ProjectsRepository, "setHead" | "byId" | "usedBytes" | "instanceUsedBytes">;
  audit: AuditService;
  now: () => Date;
  /** The instance defaults a project without a quota falls back to, and the instance ceiling. */
  quota?: () => Promise<QuotaSettings>;
  /** Adapters on distinct targets run in this many lanes at once; same target stays sequential. */
  adapterLanes?: number;
};

/** Two adapters on one database share a lane (13 §13.3: never two restores on one target). */
export function laneOf(adapter: AdapterRecord): string {
  return adapter.target_hash ?? adapter.id;
}

const initPayload = v.object({ init: v.literal(true), adapter_id: v.string() });
const manualPayload = v.object({ state_id: v.string(), adapter_ids: v.array(v.string()) });
const payloadSchema = v.union([initPayload, manualPayload]);

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

export type QuotaSettings = { default_bytes: number; instance_ceiling_bytes: number | null };

/**
 * Quotas at job start (15 §15.8): a project at its own quota (or the instance default when it has
 * none) takes no new state, and neither does anyone once the instance ceiling is reached. The
 * check runs once per job; a state that starts under the line may still finish over it.
 */
async function assertQuota(deps: SnapshotDeps, projectId: string): Promise<void> {
  const project = deps.projects.byId(projectId);
  if (project === null) return;
  const settings = deps.quota === undefined ? null : await deps.quota();
  assertUnder(
    deps.projects.usedBytes(projectId),
    project.quota_bytes ?? settings?.default_bytes ?? null,
    "the project is at its storage quota",
    {}
  );
  assertUnder(
    deps.projects.instanceUsedBytes(),
    settings?.instance_ceiling_bytes ?? null,
    "the instance is at its storage ceiling",
    { reason: "instance" }
  );
}

function assertUnder(used: number, limit: number | null, message: string, extra: JsonObject): void {
  if (limit === null || used < limit) return;
  throw new AppError("QUOTA_EXCEEDED", message, { ...extra, used_bytes: used, quota_bytes: limit });
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

/** Stashes and hidden diff states never move HEAD (05 §5.8, §5.10). */
const MOVES_HEAD = new Set<Target["kind"]>(["init", "manual"]);

type Target = {
  stateId: string;
  name: string;
  kind: "init" | "manual" | "stash" | "diff";
  adapters: AdapterRecord[];
};

/** Init payloads create their protected state here; manual ones were created by the service (08 §8.3). */
function resolveTarget(deps: SnapshotDeps, job: JobRunnerContext["job"]): Target {
  const payload = v.parse(payloadSchema, job.payload);
  if ("init" in payload) {
    const adapter = deps.adapters.byId(payload.adapter_id);
    if (adapter === null) throw notFound("adapter");
    const stateId = Bun.randomUUIDv7();
    const name = initName(deps.states, adapter.project_id, adapter);
    deps.states.insert({
      id: stateId,
      project_id: adapter.project_id,
      name,
      kind: "init",
      protected: true,
      parent_state_id: null,
      job_id: job.id,
      actor: job.actor,
      created_at: deps.now().toISOString(),
    });
    return { stateId, name, kind: "init", adapters: [adapter] };
  }
  const state = deps.states.byIdOrName(job.project_id ?? "", payload.state_id);
  if (state === null) throw notFound("state");
  const adapters = payload.adapter_ids.map((id) => deps.adapters.byId(id));
  const missing = adapters.findIndex((adapter) => adapter === null);
  if (missing !== -1) throw notFound("adapter");
  return {
    stateId: state.id,
    name: state.name,
    kind: state.kind === "stash" || state.kind === "diff" ? state.kind : "manual",
    adapters: adapters.flatMap((a) => (a === null ? [] : [a])),
  };
}

/**
 * The `snapshot` job: every adapter at one instant each, blobs pinned, manifests committed in one
 * transaction, HEAD moved to the state (08 §8.3, 15 §15.3).
 * Adapters on distinct targets run in parallel up to `adapterLanes`; one target stays sequential.
 */
export function createSnapshotRunner(deps: SnapshotDeps): JobRunner {
  return async ({ job, signal, progress }) => {
    const target = resolveTarget(deps, job);
    const projectId = target.adapters[0]?.project_id ?? job.project_id ?? "";
    const actor: Actor = job.actor;
    try {
      await assertQuota(deps, projectId);
      let finished = 0;
      const manifests: AdapterManifest[] = await runLanes(
        target.adapters,
        laneOf,
        deps.adapterLanes ?? 1,
        async (adapter) => {
          const manifest = await snapshotAdapter(deps, adapter, job.id, signal, (done, table) =>
            progress({
              phase: "snapshot",
              adapter_id: adapter.id,
              adapters_done: finished,
              tables_done: done,
              table,
            })
          );
          finished += 1;
          return manifest;
        }
      );
      const size = deps.states.commitManifest(target.stateId, manifests, deps.now().toISOString());
      // A stash never moves HEAD (05 §5.8).
      if (MOVES_HEAD.has(target.kind)) {
        deps.projects.setHead(projectId, target.stateId, "at_state", deps.now().toISOString());
      }
      deps.audit.record({
        actor,
        action: "state.created",
        target_type: "state",
        target_id: target.stateId,
        project: { id: projectId, slug: deps.projects.byId(projectId)?.slug ?? "" },
        details: {
          kind: target.kind,
          name: target.name,
          adapters: manifests.length,
          size_bytes: size,
        },
        outcome: "succeeded",
      });
      return {
        status: "succeeded",
        result: {
          state_id: target.stateId,
          name: target.name,
          adapters: manifests.length,
          rows: manifests.reduce((total, manifest) => total + manifest.row_count, 0),
          size_bytes: size,
        },
      };
    } catch (cause: unknown) {
      deps.states.setStatus(target.stateId, "failed", deps.now().toISOString());
      throw cause;
    } finally {
      deps.states.releasePins(job.id);
    }
  };
}
