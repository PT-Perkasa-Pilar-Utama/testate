import { rmSync } from "node:fs";
import { dirname } from "node:path";
import type { JsonObject, Normalizer, TableSchema } from "@testate/shared";
import { importModeSchema, parseOptionsSchema } from "@testate/shared";
import * as v from "valibot";

import { toConnectionConfig } from "../../lib/engines/connection.ts";
import { sameTable } from "../../lib/engines/index.ts";
import type { ImportOptions, RowValues } from "../../lib/engines/index.ts";
import { AppError, notFound } from "../../lib/http/index.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import { CONFIG_COLUMN, openSecrets } from "../adapters/adapters.secrets.ts";
import type { PoliciesRepository } from "../data/data.policies.ts";
import type { JobRunner } from "../jobs/jobs.dispatcher.ts";
import type { SnapshotDeps } from "../states/states.snapshot.ts";
import { takeStash } from "../states/states.stash.ts";
import { readTable } from "./imports.table.ts";
import { createRejectedSink } from "./imports.rejected.ts";
import type { RejectedPreview, RejectedSink } from "./imports.rejected.ts";
import { classify, readOptionsOf, toValues } from "./imports.rowmap.ts";
import type { ImportsRepository, RunCounts } from "./imports.repository.ts";
import { validateNormalizer } from "./imports.validate.ts";

export type ImportJobDeps = SnapshotDeps & {
  imports: ImportsRepository;
  policies: Pick<PoliciesRepository, "list">;
  dataDir: string;
};

export const importPayloadSchema = v.object({
  run_id: v.string(),
  adapter_id: v.string(),
  normalizer_id: v.string(),
  source_path: v.string(),
  source_upload_id: v.nullable(v.string()),
  mode: importModeSchema,
  dry_run: v.boolean(),
  stash_first: v.boolean(),
  foreign_key_checks: v.boolean(),
  options: parseOptionsSchema,
});

const BATCH_ROWS = 1000;

type Prepared = {
  adapter: AdapterRecord;
  normalizer: Normalizer;
  table: TableSchema;
  keyColumns: string[];
};

async function prepare(
  deps: ImportJobDeps,
  payload: v.InferOutput<typeof importPayloadSchema>
): Promise<Prepared> {
  const adapter = deps.adapters.byId(payload.adapter_id);
  const normalizer = deps.imports.normalizer(payload.normalizer_id);
  if (adapter === null || normalizer === null) throw notFound("normalizer");
  const secrets = await openSecrets(deps.ring, adapter.id, CONFIG_COLUMN, adapter.config_sealed);
  const config = toConnectionConfig(adapter.engine, adapter.config, secrets);
  const live = await deps.engines
    .require(adapter.engine)
    .introspect({ connectionId: adapter.id, config }, []);
  const dot = normalizer.target.indexOf(".");
  const ref =
    dot === -1
      ? { schema: null, name: normalizer.target }
      : { schema: normalizer.target.slice(0, dot), name: normalizer.target.slice(dot + 1) };
  const table = live.tables.find((item) => sameTable(item, ref));
  if (table === undefined)
    throw new AppError("VALIDATION_ERROR", `target table ${normalizer.target} not found`);
  validateNormalizer(
    { ...normalizer, mode: payload.mode },
    table,
    deps.policies.list(adapter.id, normalizer.target)
  );
  return { adapter, normalizer, table, keyColumns: normalizer.key_columns };
}

type Batch = { rows: RowValues[]; numbers: number[]; sources: string[][] };

async function flush(
  deps: ImportJobDeps,
  prepared: Prepared,
  payload: v.InferOutput<typeof importPayloadSchema>,
  batch: Batch,
  first: boolean,
  counts: RunCounts,
  sink: RejectedSink
): Promise<void> {
  if (batch.rows.length === 0) return;
  const secrets = await openSecrets(
    deps.ring,
    prepared.adapter.id,
    CONFIG_COLUMN,
    prepared.adapter.config_sealed
  );
  const config = toConnectionConfig(prepared.adapter.engine, prepared.adapter.config, secrets);
  const opts: ImportOptions = {
    mode: payload.mode,
    keyColumns: prepared.keyColumns,
    foreignKeyChecks: payload.foreign_key_checks,
    firstBatch: first,
  };
  const result = await deps.engines
    .require(prepared.adapter.engine)
    .importRows(
      { connectionId: prepared.adapter.id, config },
      { schema: prepared.table.schema, name: prepared.table.name },
      batch.rows,
      opts
    );
  counts.inserted += result.inserted;
  counts.updated += result.updated;
  counts.failed += result.failures.length;
  for (const failure of result.failures) {
    sink.add({
      row_number: batch.numbers[failure.index] ?? 0,
      reason: failure.message,
      source: batch.sources[failure.index] ?? [],
    });
  }
}

type Processed = { counts: RunCounts; preview: RejectedPreview[]; rejectedPath: string | null };

/** Parses, transforms, validates, and writes in batches; a dry run stops before any write. */
async function process(
  deps: ImportJobDeps,
  prepared: Prepared,
  payload: v.InferOutput<typeof importPayloadSchema>,
  bytes: Uint8Array,
  progress: (value: JsonObject) => void
): Promise<Processed> {
  const parsed = readTable(bytes, readOptionsOf(payload.options, prepared.normalizer.options));
  const counts: RunCounts = { inserted: 0, updated: 0, skipped: 0, failed: 0, duration_ms: 0 };
  const sink = createRejectedSink({
    dataDir: deps.dataDir,
    runId: payload.run_id,
    columns: parsed.columns,
    fileBacked: !payload.dry_run,
  });
  let batch: Batch = { rows: [], numbers: [], sources: [] };
  let first = true;
  try {
    for (const [index, source] of parsed.rows.entries()) {
      const rowNumber = parsed.headerRow + index + 1;
      const outcome = await classify(prepared, parsed.columns, source, rowNumber);
      if ("rejected" in outcome) {
        counts.failed += 1;
        sink.add(outcome.rejected);
        continue;
      }
      if (payload.dry_run) {
        counts.skipped += 1;
        continue;
      }
      batch.rows.push(toValues(outcome.row));
      batch.numbers.push(rowNumber);
      batch.sources.push(source);
      if (batch.rows.length >= BATCH_ROWS) {
        await flush(deps, prepared, payload, batch, first, counts, sink);
        first = false;
        batch = { rows: [], numbers: [], sources: [] };
        progress({ phase: "write", rows: index + 1, total: parsed.rows.length });
      }
    }
    await flush(deps, prepared, payload, batch, first, counts, sink);
  } catch (cause: unknown) {
    // A failed run leaves no half-written rejected.csv: nothing records its path, so nothing sweeps it.
    await sink.discard();
    throw cause;
  }
  return { counts, preview: sink.preview, rejectedPath: await sink.close() };
}

function cleanup(
  deps: ImportJobDeps,
  payload: v.InferOutput<typeof importPayloadSchema>,
  jobId: string
): void {
  deps.states.releasePins(jobId);
  // A dry run keeps its upload so the real import can follow on the same file (story 56).
  if (payload.dry_run && payload.source_upload_id !== null) return;
  if (payload.source_upload_id !== null) deps.imports.removeUpload(payload.source_upload_id);
  if (payload.source_upload_id !== null || isFetchedSource(payload.source_path))
    rmSync(dirname(payload.source_path), { recursive: true, force: true });
}

/** Storage-adapter sources are copied under `imports/sources/<id>/` and deleted with the run. */
export function isFetchedSource(path: string): boolean {
  return /[/\\]imports[/\\]sources[/\\]/.test(path);
}

/** The `import` job (19 §19.3): stash, policy check, parse and transform, batches, report, cleanup. */
export function createImportRunner(deps: ImportJobDeps): JobRunner {
  return async ({ job, signal, progress }) => {
    const payload = v.parse(importPayloadSchema, job.payload);
    const projectId = job.project_id ?? "";
    const startedAt = Date.now();
    try {
      const prepared = await prepare(deps, payload);
      if (!payload.dry_run && payload.stash_first) {
        progress({ phase: "stash" });
        const stashId = await takeStash(deps, {
          projectId,
          adapters: [prepared.adapter],
          reason: "import",
          jobId: job.id,
          actor: job.actor,
          signal,
        });
        deps.imports.setStash(payload.run_id, stashId);
      }
      const bytes = new Uint8Array(await Bun.file(payload.source_path).arrayBuffer());
      const { counts, preview, rejectedPath } = await process(
        deps,
        prepared,
        payload,
        bytes,
        progress
      );
      counts.duration_ms = Date.now() - startedAt;
      deps.imports.finishRun(payload.run_id, counts, rejectedPath, deps.now().toISOString());
      // A real run wrote rows, so the databases no longer hold the state HEAD names.
      if (!payload.dry_run) deps.projects.markHeadDirty(projectId, true, deps.now().toISOString());
      return {
        status: "succeeded",
        result: {
          run_id: payload.run_id,
          dry_run: payload.dry_run,
          ...counts,
          errors_preview: preview,
          rejected_available: rejectedPath !== null,
          stash_state_id: deps.imports.run(projectId, payload.run_id)?.stash_state_id ?? null,
        },
      };
    } finally {
      cleanup(deps, payload, job.id);
    }
  };
}
