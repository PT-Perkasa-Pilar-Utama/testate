import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Actor, JsonObject, Mapping, TableSchema } from "@testate/shared";
import { importModeSchema, parseOptionsSchema } from "@testate/shared";
import * as v from "valibot";

import { toConnectionConfig } from "../../lib/engines/connection.ts";
import { sameTable } from "../../lib/engines/index.ts";
import type { ImportOptions, RowValues } from "../../lib/engines/index.ts";
import { AppError, notFound } from "../../lib/http/index.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import { CONFIG_COLUMN, openSecrets } from "../adapters/adapters.secrets.ts";
import type { PoliciesRepository } from "../data/data.policies.ts";
import { HookAbort, hookResultsJson } from "../hooks/hooks.service.ts";
import type { HookRunResult, HookRunner } from "../hooks/hooks.service.ts";
import type { JobRunner } from "../jobs/jobs.dispatcher.ts";
import type { SnapshotDeps } from "../states/states.snapshot.ts";
import { takeStash } from "../states/states.stash.ts";
import { csvLine, readCsv } from "./imports.csv.ts";
import { classify, readOptionsOf, toValues } from "./imports.rowmap.ts";
import type { Rejected } from "./imports.rowmap.ts";
import type { ImportsRepository, RunCounts } from "./imports.repository.ts";
import { validateMapping } from "./imports.validate.ts";

export type ImportJobDeps = SnapshotDeps & {
  imports: ImportsRepository;
  policies: Pick<PoliciesRepository, "list">;
  hooks: HookRunner;
  dataDir: string;
};

export const importPayloadSchema = v.object({
  run_id: v.string(),
  adapter_id: v.string(),
  mapping_id: v.string(),
  source_path: v.string(),
  source_upload_id: v.nullable(v.string()),
  mode: importModeSchema,
  dry_run: v.boolean(),
  stash_first: v.boolean(),
  foreign_key_checks: v.boolean(),
  options: parseOptionsSchema,
});

const BATCH_ROWS = 1000;
const ERRORS_PREVIEW = 100;

type Prepared = {
  adapter: AdapterRecord;
  mapping: Mapping;
  table: TableSchema;
  keyColumns: string[];
};

async function prepare(
  deps: ImportJobDeps,
  payload: v.InferOutput<typeof importPayloadSchema>
): Promise<Prepared> {
  const adapter = deps.adapters.byId(payload.adapter_id);
  const mapping = deps.imports.mapping(payload.mapping_id);
  if (adapter === null || mapping === null) throw notFound("mapping");
  const secrets = await openSecrets(deps.ring, adapter.id, CONFIG_COLUMN, adapter.config_sealed);
  const config = toConnectionConfig(adapter.engine, adapter.config, secrets);
  const live = await deps.engines
    .require(adapter.engine)
    .introspect({ connectionId: adapter.id, config }, []);
  const dot = mapping.target.indexOf(".");
  const ref =
    dot === -1
      ? { schema: null, name: mapping.target }
      : { schema: mapping.target.slice(0, dot), name: mapping.target.slice(dot + 1) };
  const table = live.tables.find((item) => sameTable(item, ref));
  if (table === undefined)
    throw new AppError("VALIDATION_ERROR", `target table ${mapping.target} not found`);
  validateMapping(
    { ...mapping, mode: payload.mode },
    table,
    deps.policies.list(adapter.id, mapping.target)
  );
  return { adapter, mapping, table, keyColumns: mapping.key_columns };
}

function writeRejected(
  deps: ImportJobDeps,
  runId: string,
  columns: string[],
  rejected: Rejected[]
): string | null {
  if (rejected.length === 0) return null;
  const path = join(deps.dataDir, "imports", runId, "rejected.csv");
  mkdirSync(dirname(path), { recursive: true });
  const lines = [
    csvLine([...columns, "row_number", "reason"]),
    ...rejected.map((item) => csvLine([...item.source, item.row_number, item.reason])),
  ];
  // ponytail: written at the end in one go — stream per batch when a run rejects millions of rows.
  void Bun.write(path, `${lines.join("\n")}\n`);
  return path;
}

type Batch = { rows: RowValues[]; numbers: number[]; sources: string[][] };

async function flush(
  deps: ImportJobDeps,
  prepared: Prepared,
  payload: v.InferOutput<typeof importPayloadSchema>,
  batch: Batch,
  first: boolean,
  counts: RunCounts,
  rejected: Rejected[]
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
    rejected.push({
      row_number: batch.numbers[failure.index] ?? 0,
      reason: failure.message,
      source: batch.sources[failure.index] ?? [],
    });
  }
}

/** Parses, transforms, validates, and writes in batches; a dry run stops before any write. */
async function process(
  deps: ImportJobDeps,
  prepared: Prepared,
  payload: v.InferOutput<typeof importPayloadSchema>,
  text: string,
  progress: (value: JsonObject) => void
): Promise<{ counts: RunCounts; rejected: Rejected[]; columns: string[] }> {
  const parsed = readCsv(text, readOptionsOf(payload.options, prepared.mapping.options));
  const counts: RunCounts = { inserted: 0, updated: 0, skipped: 0, failed: 0, duration_ms: 0 };
  const rejected: Rejected[] = [];
  let batch: Batch = { rows: [], numbers: [], sources: [] };
  let first = true;
  for (const [index, source] of parsed.rows.entries()) {
    const rowNumber = parsed.headerRow + index + 1;
    const outcome = await classify(prepared, parsed.columns, source, rowNumber);
    if ("rejected" in outcome) {
      counts.failed += 1;
      rejected.push(outcome.rejected);
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
      await flush(deps, prepared, payload, batch, first, counts, rejected);
      first = false;
      batch = { rows: [], numbers: [], sources: [] };
      progress({ phase: "write", rows: index + 1, total: parsed.rows.length });
    }
  }
  await flush(deps, prepared, payload, batch, first, counts, rejected);
  return { counts, rejected, columns: parsed.columns };
}

type AfterImport = { hooks: HookRunResult[]; aborted: boolean };

async function afterImport(
  deps: ImportJobDeps,
  projectId: string,
  jobId: string,
  actor: Actor
): Promise<AfterImport> {
  try {
    return {
      hooks: await deps.hooks.run("after_import", { projectId, jobId, actor }),
      aborted: false,
    };
  } catch (cause: unknown) {
    if (!(cause instanceof HookAbort)) throw cause;
    return { hooks: [], aborted: true };
  }
}

function cleanup(
  deps: ImportJobDeps,
  payload: v.InferOutput<typeof importPayloadSchema>,
  jobId: string
): void {
  deps.states.releasePins(jobId);
  if (payload.source_upload_id !== null) deps.imports.removeUpload(payload.source_upload_id);
  if (payload.source_upload_id !== null || isFetchedSource(payload.source_path))
    rmSync(dirname(payload.source_path), { recursive: true, force: true });
}

/** Storage-adapter sources are copied under `imports/sources/<id>/` and deleted with the run. */
export function isFetchedSource(path: string): boolean {
  return /[/\\]imports[/\\]sources[/\\]/.test(path);
}

/** The `import` job (19 §19.3): stash, policy check, parse and transform, batches, report, hooks, cleanup. */
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
      const text = await Bun.file(payload.source_path).text();
      const { counts, rejected, columns } = await process(deps, prepared, payload, text, progress);
      counts.duration_ms = Date.now() - startedAt;
      const rejectedPath = payload.dry_run
        ? null
        : writeRejected(deps, payload.run_id, columns, rejected);
      deps.imports.finishRun(payload.run_id, counts, rejectedPath, deps.now().toISOString());
      const { hooks, aborted } = payload.dry_run
        ? { hooks: [], aborted: false }
        : await afterImport(deps, projectId, job.id, job.actor);
      return {
        status: aborted ? "partial" : "succeeded",
        result: {
          run_id: payload.run_id,
          dry_run: payload.dry_run,
          ...counts,
          errors_preview: rejected
            .slice(0, ERRORS_PREVIEW)
            .map((item) => ({ row_number: item.row_number, reason: item.reason })),
          rejected_available: rejectedPath !== null,
          stash_state_id: deps.imports.run(projectId, payload.run_id)?.stash_state_id ?? null,
          hooks: hookResultsJson(hooks),
        },
      };
    } finally {
      cleanup(deps, payload, job.id);
    }
  };
}
