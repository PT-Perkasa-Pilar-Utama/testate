import type {
  Actor,
  CreateStateInput,
  Job,
  Project,
  State,
  StateDetail,
  StateTreeNode,
  UpdateStateInput,
} from "@testate/shared";

import { AppError, conflict, notFound } from "../../lib/http/index.ts";
import type { RequestMeta } from "../../lib/http/auth.ts";
import type { AdaptersRepository } from "../adapters/adapters.repository.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { EnqueueInput, JobsService } from "../jobs/jobs.service.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import { PROJECT_JOB_MOCK } from "../projects/projects.mock.ts";
import { ARCHIVE_MANIFEST_MOCK } from "./states.mock.ts";
import type { StatePatch, StatesFilter, StatesRepository } from "./states.repository.ts";

export type StatesService = {
  list(slug: string, filter: StatesFilter): Promise<State[]>;
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
  archiveManifest(uploadId: string): Promise<typeof ARCHIVE_MANIFEST_MOCK>;
  importArchive(slug: string, name: string): Promise<Job>;
};

export type StatesDeps = {
  repo: StatesRepository;
  projects: Pick<ProjectsRepository, "bySlug" | "usedBytes">;
  adapters: Pick<AdaptersRepository, "list" | "byId">;
  jobs: Pick<JobsService, "enqueue">;
  audit: AuditService;
  now: () => Date;
};

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
    if (requested.length === 0) throw conflict("adapter_ids may not be empty");
    return requested;
  };

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
      if (meta.idempotency_key !== undefined) request.idempotencyKey = meta.idempotency_key;
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
    // SCAFFOLD: archives (PAX tar, upload manifest, import) belong to the archive card (15 §15.5).
    async archiveManifest() {
      return ARCHIVE_MANIFEST_MOCK;
    },
    async importArchive(slug) {
      projectOf(slug);
      return {
        ...PROJECT_JOB_MOCK,
        kind: "archive_import",
        status: "queued",
        finished_at: null,
        result: null,
      };
    },
  };
}
