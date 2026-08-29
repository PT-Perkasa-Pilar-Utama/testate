import type { Actor, Diff, DiffRow, Job, Project, Settings, State } from "@testate/shared";

import type { BlobStore } from "../../lib/blobstore/index.ts";
import { AppError, conflict, notFound } from "../../lib/http/index.ts";
import type { RequestMeta } from "../../lib/http/auth.ts";
import { decodeDiffRows } from "../../lib/snapshot/difflines.ts";
import type { AdaptersRepository } from "../adapters/adapters.repository.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { PoliciesRepository } from "../data/data.policies.ts";
import type { EnqueueInput, JobsService } from "../jobs/jobs.service.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import type { StatesRepository } from "../states/states.repository.ts";
import type { DiffAdapterSummary, DiffsRepository } from "./diffs.repository.ts";
import { collectPage, maskDiffRows, tableKeyOf } from "./diffs.rows.ts";
import type { MaskedDiffRows } from "./diffs.rows.ts";

export type DiffTarget = { state_id: string } | "live";

export type DiffRowsQuery = {
  adapter_id: string;
  table: string;
  op?: "added" | "removed" | "changed";
  cursor?: string;
  limit: number;
};

export type DiffRowsPage = {
  data: DiffRow[];
  next_cursor: string | null;
  masked_columns: string[];
};

export type DiffsService = {
  create(
    actor: Actor,
    slug: string,
    baseStateId: string,
    target: DiffTarget,
    adapterIds: string[] | undefined,
    meta: RequestMeta
  ): Promise<{ diff: Diff; job: Job }>;
  list(slug: string, limit: number): Promise<Diff[]>;
  get(slug: string, id: string): Promise<Diff>;
  rows(actor: Actor, slug: string, id: string, query: DiffRowsQuery): Promise<DiffRowsPage>;
  /** Every diff row of the diff, or of one adapter and table; masked per role (10 §10.4). */
  exportRows(
    actor: Actor,
    slug: string,
    id: string,
    adapterId: string | undefined,
    table: string | undefined
  ): AsyncIterable<DiffRow & { adapter_id: string; table: string }>;
  remove(actor: Actor, slug: string, id: string, meta: RequestMeta): Promise<void>;
  /** Deletes expired diffs; the daily sweep calls it (20 §20.1). */
  expire(): Promise<number>;
};

export type DiffsDeps = {
  repo: DiffsRepository;
  states: StatesRepository;
  adapters: Pick<AdaptersRepository, "byId" | "list">;
  policies: Pick<PoliciesRepository, "list">;
  projects: Pick<ProjectsRepository, "bySlug" | "byId" | "usedBytes">;
  blobs: BlobStore;
  jobs: Pick<JobsService, "enqueue">;
  settings: { get(): Promise<Settings> };
  audit: AuditService;
  now: () => Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function createDiffsService(deps: DiffsDeps): DiffsService {
  const { repo } = deps;
  const projectOf = (slug: string): Project => {
    const project = deps.projects.bySlug(slug);
    if (project === null) throw notFound("project");
    return project;
  };
  const find = (project: Project, id: string): Diff => {
    const diff = repo.byId(project.id, id);
    if (diff === null) throw notFound("diff");
    return diff;
  };
  const readyState = (project: Project, id: string): State => {
    const state = deps.states.byIdOrName(project.id, id);
    if (state === null) throw notFound("state");
    if (state.status !== "ready") throw conflict("state is not ready", { state_id: id });
    return state;
  };
  /** The intersection of both sides' adapters, restricted to the request (20 §20.1). */
  const adaptersOf = (
    base: State,
    target: State | null,
    requested: string[] | undefined
  ): DiffAdapterSummary[] => {
    const summaries: DiffAdapterSummary[] = [];
    for (const entry of base.adapters) {
      if (requested !== undefined && !requested.includes(entry.adapter_id)) continue;
      const live = deps.adapters.byId(entry.adapter_id);
      const onTarget =
        target === null
          ? live !== null && live.kind === "database"
          : target.adapters.some((item) => item.adapter_id === entry.adapter_id);
      summaries.push({
        adapter_id: entry.adapter_id,
        name: entry.adapter_name,
        compared: onTarget,
      });
    }
    if (!summaries.some((item) => item.compared)) throw conflict("the states share no adapter");
    return summaries;
  };
  const assertQuota = (project: Project): void => {
    if (
      project.quota_bytes !== null &&
      deps.projects.usedBytes(project.id) >= project.quota_bytes
    ) {
      throw new AppError("QUOTA_EXCEEDED", "the project is at its storage quota");
    }
  };
  const deleteDiff = async (id: string): Promise<void> => {
    const hashes = repo.blobsOf(id);
    const liveState = repo.liveStateOf(id);
    repo.remove(id);
    if (liveState !== null) {
      const removal = deps.states.remove(liveState);
      hashes.push(...removal.orphans);
    }
    const orphans = deps.states.unpinnedOrphans(hashes);
    for (const hash of orphans) await deps.blobs.delete(hash);
    deps.states.forgetBlobs(orphans);
  };
  const tableRows = async function* (
    diff: Diff,
    adapterId: string,
    table: string
  ): AsyncIterable<DiffRow> {
    const entry = diff.adapters
      .find((adapter) => adapter.adapter_id === adapterId)
      ?.tables.find((item) => tableKeyOf(item.schema, item.name) === table);
    if (entry === undefined) throw notFound("table");
    const hash = repo.tableBlob(diff.id, adapterId, entry.name, entry.schema);
    if (hash === null) return;
    yield* decodeDiffRows(deps.blobs.get(hash));
  };
  const mask = (actor: Actor, adapterId: string, table: string, rows: DiffRow[]): MaskedDiffRows =>
    maskDiffRows(actor, deps.policies.list(adapterId, table), rows);

  return {
    async create(actor, slug, baseStateId, target, adapterIds, meta) {
      const project = projectOf(slug);
      const base = readyState(project, baseStateId);
      const targetState = target === "live" ? null : readyState(project, target.state_id);
      const summaries = adaptersOf(base, targetState, adapterIds);
      if (target === "live") assertQuota(project);
      const ids = summaries.filter((item) => item.compared).map((item) => item.adapter_id);
      const id = Bun.randomUUIDv7();
      const at = deps.now();
      const days = (await deps.settings.get()).retention.diff_days;
      repo.insert(
        {
          id,
          project_id: project.id,
          base_state_id: base.id,
          target_state_id: targetState?.id ?? null,
          job_id: "",
          expires_at: new Date(at.getTime() + days * DAY_MS).toISOString(),
          created_at: at.toISOString(),
        },
        summaries
      );
      const request: EnqueueInput = {
        kind: "diff",
        projectId: project.id,
        adapterIds: target === "live" ? ids : [],
        payload: {
          diff_id: id,
          base_state_id: base.id,
          target_state_id: targetState?.id ?? null,
          adapter_ids: ids,
        },
        actor,
        parentRequestId: meta.request_id,
      };
      let job: Job;
      try {
        job = await deps.jobs.enqueue(request);
      } catch (cause: unknown) {
        repo.remove(id);
        throw cause;
      }
      repo.setJob(id, job.id);
      const diff = find(project, id);
      deps.audit.record({
        actor,
        action: "diff.created",
        target_type: "diff",
        target_id: id,
        project: { id: project.id, slug: project.slug },
        details: {
          base_state_id: base.id,
          target: target === "live" ? "live" : target.state_id,
          adapters: ids.length,
        },
        outcome: "succeeded",
        meta,
      });
      return { diff, job };
    },
    async list(slug, limit) {
      return repo.list(projectOf(slug).id, limit);
    },
    async get(slug, id) {
      return find(projectOf(slug), id);
    },
    async rows(actor, slug, id, query) {
      const diff = find(projectOf(slug), id);
      if (diff.status !== "ready") throw conflict("diff is not ready", { status: diff.status });
      const offset = query.cursor === undefined ? 0 : Number(query.cursor);
      if (!Number.isInteger(offset) || offset < 0) {
        throw new AppError("VALIDATION_ERROR", "invalid cursor");
      }
      // ponytail: no chunk index — the blob is read from the start on every page; fine below ~100k rows.
      const rows = tableRows(diff, query.adapter_id, query.table);
      const { page, more } = await collectPage(rows, query.op, offset, query.limit);
      const masked = mask(actor, query.adapter_id, query.table, page);
      return {
        data: masked.rows,
        next_cursor: more ? String(offset + query.limit) : null,
        masked_columns: masked.masked_columns,
      };
    },
    async *exportRows(actor, slug, id, adapterId, table) {
      const diff = find(projectOf(slug), id);
      if (diff.status !== "ready") throw conflict("diff is not ready", { status: diff.status });
      for (const adapter of diff.adapters) {
        if (adapterId !== undefined && adapter.adapter_id !== adapterId) continue;
        for (const entry of adapter.tables) {
          const key = tableKeyOf(entry.schema, entry.name);
          if (table !== undefined && key !== table) continue;
          for await (const row of tableRows(diff, adapter.adapter_id, key)) {
            const masked = mask(actor, adapter.adapter_id, key, [row]);
            yield { ...(masked.rows[0] ?? row), adapter_id: adapter.adapter_id, table: key };
          }
        }
      }
    },
    async remove(actor, slug, id, meta) {
      const project = projectOf(slug);
      const diff = find(project, id);
      if (diff.status === "running") throw conflict("diff is still running");
      await deleteDiff(diff.id);
      deps.audit.record({
        actor,
        action: "diff.deleted",
        target_type: "diff",
        target_id: id,
        project: { id: project.id, slug: project.slug },
        details: {},
        outcome: "succeeded",
        meta,
      });
    },
    async expire() {
      const expired = repo.expired(deps.now().toISOString());
      for (const diff of expired) await deleteDiff(diff.id);
      return expired.length;
    },
  };
}
