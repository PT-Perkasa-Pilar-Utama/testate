import type { Actor, ManifestTable } from "@testate/shared";
import * as v from "valibot";

import { sameTable } from "../../lib/engines/index.ts";
import { notFound } from "../../lib/http/index.ts";
import { decodeChunks } from "../../lib/snapshot/codec.ts";
import { encodeDiffRows } from "../../lib/snapshot/difflines.ts";
import { mergeRows } from "../../lib/snapshot/merge.ts";
import type { MergeStats } from "../../lib/snapshot/merge.ts";
import type { JobRunner } from "../jobs/jobs.dispatcher.ts";
import type { AdapterManifest } from "../states/states.repository.ts";
import { snapshotAdapter } from "../states/states.snapshot.ts";
import type { SnapshotDeps } from "../states/states.snapshot.ts";
import type { DiffTableRow, DiffsRepository } from "./diffs.repository.ts";

export type DiffJobDeps = SnapshotDeps & { diffs: DiffsRepository };

export const diffPayloadSchema = v.object({
  diff_id: v.string(),
  base_state_id: v.string(),
  target_state_id: v.nullable(v.string()),
  adapter_ids: v.array(v.string()),
});

type TableSide = { manifest: AdapterManifest; table: ManifestTable };

function columnsOf(side: TableSide): string[] {
  const table = side.manifest.introspection.tables.find((item) => sameTable(item, side.table));
  return (table?.columns ?? []).map((column) => column.name).sort();
}

/** Columns on one side only explain why every shared row counts as changed (20 §20.1). */
function schemaChanged(base: TableSide, target: TableSide): string[] | null {
  const left = columnsOf(base);
  const right = new Set(columnsOf(target));
  const changed = [
    ...left.filter((name) => !right.has(name)),
    ...[...right].filter((name) => !left.includes(name)),
  ];
  return changed.length === 0 ? null : changed.sort();
}

/**
 * Adding or dropping a primary key changes how the rows are keyed, and rows keyed two different
 * ways cannot be matched at all. Naming that beats a row diff made of nothing.
 */
function keyChanged(base: TableSide, target: TableSide): string | null {
  return base.table.sort === target.table.sort
    ? null
    : `key changed: ${base.table.sort} to ${target.table.sort}`;
}

/** One table on both sides: equal blobs cost nothing; otherwise merge and store the diff blob. */
async function diffTable(
  deps: DiffJobDeps,
  jobId: string,
  base: TableSide,
  target: TableSide
): Promise<DiffTableRow> {
  const row: DiffTableRow = {
    adapter_id: base.manifest.adapter_id,
    schema: base.table.schema,
    name: base.table.name,
    compare: base.table.sort,
    added: 0,
    removed: 0,
    changed: 0,
    blob_hash: null,
    schema_changed: schemaChanged(base, target),
  };
  const rekeyed = keyChanged(base, target);
  if (rekeyed !== null) return { ...row, schema_changed: [rekeyed, ...(row.schema_changed ?? [])] };
  if (base.table.blob_hash === target.table.blob_hash) return row;
  const stats: MergeStats = { added: 0, removed: 0, changed: 0 };
  const merged = mergeRows(
    decodeChunks(deps.blobs.get(base.table.blob_hash)),
    decodeChunks(deps.blobs.get(target.table.blob_hash)),
    stats
  );
  const put = await deps.blobs.put(encodeDiffRows(merged), {});
  deps.states.recordBlob(put.hash, put.size, jobId, deps.now().toISOString());
  return { ...row, ...stats, blob_hash: put.hash };
}

/** Tables on one side only are added or removed wholesale. */
function oneSided(
  manifest: AdapterManifest,
  table: ManifestTable,
  op: "added" | "removed"
): DiffTableRow {
  return {
    adapter_id: manifest.adapter_id,
    schema: table.schema,
    name: table.name,
    compare: table.sort,
    added: op === "added" ? table.rows : 0,
    removed: op === "removed" ? table.rows : 0,
    changed: 0,
    blob_hash: null,
    schema_changed: [op === "added" ? "table added" : "table removed"],
  };
}

async function diffAdapter(
  deps: DiffJobDeps,
  diffId: string,
  jobId: string,
  base: AdapterManifest,
  target: AdapterManifest
): Promise<void> {
  for (const table of base.tables) {
    const other = target.tables.find((item) => sameTable(item, table));
    const row =
      other === undefined
        ? oneSided(base, table, "removed")
        : await diffTable(
            deps,
            jobId,
            { manifest: base, table },
            { manifest: target, table: other }
          );
    deps.diffs.insertTable(diffId, row);
  }
  for (const table of target.tables) {
    if (!base.tables.some((item) => sameTable(item, table)))
      deps.diffs.insertTable(diffId, oneSided(base, table, "added"));
  }
}

/** A hidden `diff` state for the live side: consistent read, owned by the diff, never listed (05 §5.10). */
async function snapshotLive(
  deps: DiffJobDeps,
  diffId: string,
  projectId: string,
  adapterIds: string[],
  jobId: string,
  actor: Actor,
  signal: AbortSignal
): Promise<string> {
  const stateId = Bun.randomUUIDv7();
  deps.states.insert({
    id: stateId,
    project_id: projectId,
    name: `diff-${diffId.slice(-8)}-${stateId.slice(-4)}`,
    kind: "diff",
    protected: false,
    parent_state_id: null,
    job_id: jobId,
    actor,
    created_at: deps.now().toISOString(),
  });
  const manifests: AdapterManifest[] = [];
  for (const adapterId of adapterIds) {
    const adapter = deps.adapters.byId(adapterId);
    if (adapter === null) throw notFound("adapter");
    manifests.push(await snapshotAdapter(deps, adapter, jobId, signal, () => undefined));
  }
  deps.states.commitManifest(stateId, manifests, deps.now().toISOString());
  deps.diffs.setLiveState(diffId, stateId);
  return stateId;
}

/** The `diff` job (20 §20.1): hidden live snapshot when needed, then table by table per shared adapter. */
export function createDiffRunner(deps: DiffJobDeps): JobRunner {
  return async ({ job, signal, progress }) => {
    const payload = v.parse(diffPayloadSchema, job.payload);
    const projectId = job.project_id ?? "";
    try {
      let targetStateId = payload.target_state_id;
      if (targetStateId === null) {
        progress({ phase: "snapshot" });
        targetStateId = await snapshotLive(
          deps,
          payload.diff_id,
          projectId,
          payload.adapter_ids,
          job.id,
          job.actor,
          signal
        );
      }
      const base = new Map(
        deps.states
          .manifestsOf(payload.base_state_id)
          .map((manifest) => [manifest.adapter_id, manifest])
      );
      const target = new Map(
        deps.states.manifestsOf(targetStateId).map((manifest) => [manifest.adapter_id, manifest])
      );
      let done = 0;
      for (const adapterId of payload.adapter_ids) {
        const left = base.get(adapterId);
        const right = target.get(adapterId);
        if (left !== undefined && right !== undefined)
          await diffAdapter(deps, payload.diff_id, job.id, left, right);
        done += 1;
        progress({ phase: "merge", done, total: payload.adapter_ids.length });
      }
      deps.diffs.finish(payload.diff_id, "ready");
      return { status: "succeeded", result: { diff_id: payload.diff_id, adapters: done } };
    } catch (cause: unknown) {
      deps.diffs.finish(payload.diff_id, "failed");
      throw cause;
    } finally {
      deps.states.releasePins(job.id);
    }
  };
}
