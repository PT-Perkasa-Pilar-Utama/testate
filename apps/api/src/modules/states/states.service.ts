import type {
  Actor,
  ArchiveManifest,
  CreateStateInput,
  Job,
  Project,
  State,
  StateListItem,
  StateDetail,
  StateTreeNode,
  UpdateStateInput,
} from "@testate/shared";

import type { BlobStore } from "../../lib/blobstore/index.ts";
import { AppError, conflict, notFound } from "../../lib/http/index.ts";
import type { RequestMeta } from "../../lib/http/auth.ts";
import type { AdaptersRepository } from "../adapters/adapters.repository.ts";
import type { AuditService } from "../audit/audit.service.ts";
import { idempotentRequest, replayWith } from "../jobs/jobs.idempotency.ts";
import type { EnqueueInput, JobsService } from "../jobs/jobs.service.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import type { ImportsRepository } from "../imports/imports.repository.ts";
import { createArchiveOps } from "./states.archives.ts";
import type { ImportArchiveInput } from "./states.archives.ts";
import type { StatePatch, StatesFilter, StatesRepository } from "./states.repository.ts";

export type StatesService = {
  list(slug: string, filter: StatesFilter): Promise<StateListItem[]>;
  tree(slug: string, includeStash: boolean): Promise<StateTreeNode[]>;
  snapshot(
    actor: Actor,
    slug: string,
    input: CreateStateInput,
    meta: RequestMeta
  ): Promise<{ state: State; job: Job }>;
  get(slug: string, idOrName: string): Promise<StateDetail>;
  update(
    actor: Actor,
    slug: string,
    id: string,
    patch: UpdateStateInput,
    meta: RequestMeta
  ): Promise<State>;
  remove(actor: Actor, slug: string, id: string, meta: RequestMeta): Promise<Job>;
  /** Deletes a state and its orphan blobs at once; the retention sweep uses it for stashes (15 §15.4). */
  removeNow(id: string): Promise<void>;
  /** The tar of a ready state, streamed (08 §8.7). */
  archive(
    slug: string,
    idOrName: string
  ): Promise<{ state: State; body: ReadableStream<Uint8Array> }>;
  archiveManifest(slug: string, uploadId: string): Promise<ArchiveManifest>;
  importArchive(
    actor: Actor,
    slug: string,
    input: ImportArchiveInput,
    meta: RequestMeta
  ): Promise<Job>;
};

export type StatesDeps = {
  repo: StatesRepository;
  projects: Pick<ProjectsRepository, "bySlug" | "usedBytes">;
  adapters: Pick<AdaptersRepository, "list" | "byId">;
  jobs: Pick<JobsService, "enqueue" | "replay">;
  blobs: BlobStore;
  uploads: Pick<ImportsRepository, "upload">;
  audit: AuditService;
  now: () => Date;
  createAdapter?: ArchiveDeps["createAdapter"];
};

import type { ArchiveDeps } from "./states.archives.ts";

export type { ImportArchiveInput } from "./states.archives.ts";

const DEFAULT_FILTER: StatesFilter = {
  limit: 1000,
  sort: "created_at",
  order: "asc",
  includeStash: true,
};

/** Roots first, children in creation order; HEAD flagged from the project row (08 §8.2). */
export function buildTree(states: State[], headId: string | null): StateTreeNode[] {
  const nodes = new Map<string, StateTreeNode>();
  for (const state of states) {
    nodes.set(state.id, {
      id: state.id,
      name: state.name,
      kind: state.kind,
      created_at: state.created_at,
      size_bytes: state.size_bytes,
      is_head: state.id === headId,
      children: [],
    });
  }
  const roots: StateTreeNode[] = [];
  for (const state of states) {
    const node = nodes.get(state.id);
    if (node === undefined) continue;
    const parent = state.parent_state_id === null ? undefined : nodes.get(state.parent_state_id);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  return roots;
}

function assertQuota(projects: StatesDeps["projects"], project: Project): void {
  if (project.quota_bytes === null) return;
  const used = projects.usedBytes(project.id);
  if (used >= project.quota_bytes) {
    throw new AppError("QUOTA_EXCEEDED", "the project is at its storage quota", {
      used_bytes: used,
      quota_bytes: project.quota_bytes,
    });
  }
}

/** Protecting a stash makes it manual; an init state never changes protection (08 §8.5). */
function changeOf(state: State, patch: UpdateStateInput): StatePatch {
  const change: StatePatch = {};
  if (patch.name !== undefined) change.name = patch.name;
  if (patch.notes !== undefined) change.notes = patch.notes;
  if (patch.tags !== undefined) change.tags = patch.tags;
  if (patch.protected === undefined || patch.protected === state.protected) return change;
  if (state.kind === "init") throw conflict("init states stay protected");
  change.protected = patch.protected;
  if (patch.protected && state.kind === "stash") change.kind = "manual";
  return change;
}

export function createStatesService(deps: StatesDeps): StatesService {
  const { repo, audit } = deps;
  const nowIso = (): string => deps.now().toISOString();
  const projectOf = (slug: string): Project => {
    const project = deps.projects.bySlug(slug);
    if (project === null) throw notFound("project");
    return project;
  };
  const find = (project: Project, idOrName: string): State => {
    const state = repo.byIdOrName(project.id, idOrName);
    if (state === null || state.kind === "diff") throw notFound("state");
    return state;
  };
  const assertNameFree = (project: Project, name: string): void => {
    if (repo.nameTaken(project.id, name)) throw conflict("state name is taken", { name });
  };
  const record = (
    actor: Actor,
    action: string,
    project: Project,
    state: State,
    meta: RequestMeta,
    details: Record<string, string | number | boolean | null> = {}
  ): void =>
    audit.record({
      actor,
      action,
      target_type: "state",
      target_id: state.id,
      target_label: state.name,
      project: { id: project.id, slug: project.slug },
      details: { name: state.name, ...details },
      outcome: "succeeded",
      meta,
    });

  /** The database adapters a snapshot covers: the requested ids, else every database adapter. */
  const adapterIds = (project: Project, requested: string[] | undefined): string[] => {
    const all = deps.adapters.list(project.id, { kind: "database" }).map((adapter) => adapter.id);
    if (requested === undefined) {
      if (all.length === 0) throw conflict("the project has no database adapter");
      return all;
    }
    const unknown = requested.find((id) => !all.includes(id));
    if (unknown !== undefined) throw notFound("adapter");
    if (requested.length === 0) throw conflict("pick at least one database to snapshot");
    return requested;
  };

  const { createAdapter, ...shared } = deps;
  const archiveDeps: ArchiveDeps = { ...shared, find, assertNameFree, record };
  if (createAdapter !== undefined) archiveDeps.createAdapter = createAdapter;
  const archives = createArchiveOps(archiveDeps);

  return {
    async list(slug, filter) {
      return repo.list(projectOf(slug).id, filter);
    },
    async tree(slug, includeStash) {
      const project = projectOf(slug);
      return buildTree(
        repo.list(project.id, { ...DEFAULT_FILTER, includeStash }),
        project.head.state_id
      );
    },
    async snapshot(actor, slug, input, meta) {
      const project = projectOf(slug);
      // A retry under the same key answers with the first job and its state; the name check below
      // would otherwise refuse the retry as a duplicate name (09 §9.3).
      const idempotency = idempotentRequest(meta, "snapshot", {
        name: input.name,
        notes: input.notes ?? null,
        tags: input.tags ?? [],
        adapter_ids: input.adapter_ids ?? null,
      });
      const replayed = await replayWith(deps.jobs, idempotency, actor, (jobId) =>
        repo.byJobId(project.id, jobId)
      );
      if (replayed !== null) return { state: replayed.row, job: replayed.job };
      assertNameFree(project, input.name);
      assertQuota(deps.projects, project);
      const ids = adapterIds(project, input.adapter_ids);
      const stateId = Bun.randomUUIDv7();
      // The row exists before the job: the dispatcher may start the runner inside `enqueue`.
      repo.insert({
        id: stateId,
        project_id: project.id,
        name: input.name,
        kind: "manual",
        protected: false,
        parent_state_id: project.head.state_id,
        job_id: "",
        actor,
        created_at: nowIso(),
      });
      repo.update(stateId, { notes: input.notes ?? null, tags: input.tags ?? [] }, nowIso());
      const request: EnqueueInput = {
        kind: "snapshot",
        projectId: project.id,
        adapterIds: ids,
        payload: { state_id: stateId, adapter_ids: ids },
        actor,
        parentRequestId: meta.request_id,
      };
      if (idempotency !== undefined) request.idempotency = idempotency;
      let job: Job;
      try {
        job = await deps.jobs.enqueue(request);
      } catch (cause: unknown) {
        repo.remove(stateId);
        throw cause;
      }
      repo.update(stateId, { job_id: job.id }, nowIso());
      const state = find(project, stateId);
      record(actor, "state.requested", project, state, meta, { adapters: ids.length });
      return { state, job };
    },
    async get(slug, idOrName) {
      const detail = repo.detail(projectOf(slug).id, idOrName);
      if (detail === null || detail.kind === "diff") throw notFound("state");
      return detail;
    },
    async update(actor, slug, id, patch, meta) {
      const project = projectOf(slug);
      const state = find(project, id);
      if (patch.name !== undefined && patch.name.toLowerCase() !== state.name.toLowerCase()) {
        assertNameFree(project, patch.name);
      }
      const change = changeOf(state, patch);
      repo.update(state.id, change, nowIso());
      const updated = find(project, state.id);
      if (change.protected !== undefined) {
        record(
          actor,
          change.protected ? "state.protected" : "state.unprotected",
          project,
          updated,
          meta
        );
      }
      return updated;
    },
    async remove(actor, slug, id, meta) {
      const project = projectOf(slug);
      const state = find(project, id);
      if (state.kind === "init")
        throw conflict("init states cannot be deleted", { state_id: state.id });
      if (state.protected) throw conflict("state is protected", { state_id: state.id });
      const job = await deps.jobs.enqueue({
        kind: "state_delete",
        projectId: project.id,
        adapterIds: state.adapters.map((adapter) => adapter.adapter_id),
        payload: { state_id: state.id, name: state.name, slug: project.slug },
        actor,
        parentRequestId: meta.request_id,
      });
      record(actor, "state.deletion_requested", project, state, meta);
      return job;
    },
    async removeNow(id) {
      const removal = repo.remove(id);
      const orphans = repo.unpinnedOrphans(removal.orphans);
      for (const hash of orphans) await deps.blobs.delete(hash);
      repo.forgetBlobs(orphans);
    },
    archive: (slug, idOrName) => archives.archive(projectOf(slug), idOrName),
    archiveManifest: (slug, uploadId) => archives.manifest(projectOf(slug), uploadId),
    importArchive: (actor, slug, input, meta) =>
      archives.importArchive(actor, projectOf(slug), input, meta),
  };
}
