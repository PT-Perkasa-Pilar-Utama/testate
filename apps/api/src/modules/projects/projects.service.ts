import type * as v from "valibot";
import type { Actor, Head, Job, Project, ProjectDefaults, Quota, Settings } from "@testate/shared";
import { freeSlug, projectSlug } from "@testate/shared";
import type { createProjectSchema } from "@testate/shared";

import type { RequestMeta } from "../../lib/http/auth.ts";
import { conflict, forbidden, notFound } from "../../lib/http/index.ts";
import type { AdaptersService } from "../adapters/adapters.service.ts";
import type { AuditService } from "../audit/audit.service.ts";
import { idempotentRequest } from "../jobs/jobs.idempotency.ts";
import type { EnqueueInput, JobsService } from "../jobs/jobs.service.ts";
import type {
  DeletionCounts,
  ProjectPatch,
  ProjectsListQuery,
  ProjectsRepository,
} from "./projects.repository.ts";

export type AdapterSummary = {
  id: string;
  name: string;
  kind: string;
  engine: string;
  tier: string;
  mode: string;
  status: string;
};

export type ProjectOverview = {
  project: Project;
  adapters: AdapterSummary[];
  latest_jobs: Job[];
  quota: Quota;
  banner: { kind: "head_unknown"; message: string } | null;
};

/**
 * The wire shape, not a second copy of it: the create body and what the service takes are the same
 * thing, and the two drifting apart is how `quota_bytes` reached the API and stopped at this line.
 */
export type CreateProjectInput = v.InferOutput<typeof createProjectSchema>;

export type PlanAdapter = {
  adapter_id: string;
  name: string;
  engine: string;
  init_state_id: string | null;
  action: "restore" | "force" | "skip" | "none";
  reason?: "read_only" | "unreachable" | "no_init_state" | "removed";
  drift: null;
};

export type DeletionPlan = {
  plan_id: string;
  expires_at: string;
  protected_states: number;
  /** Everything the deletion takes with the project; the dialog names it before the slug is typed. */
  affected: DeletionCounts;
  adapters: PlanAdapter[];
};

export type DeletionInput = {
  confirm_slug: string;
  plan_id: string;
  adapters: { adapter_id: string; action: "restore" | "force" | "skip" }[];
};

export type ProjectsService = {
  list(scope: string[] | null, query: Omit<ProjectsListQuery, "ids">): Promise<Project[]>;
  total(scope: string[] | null, query: Omit<ProjectsListQuery, "ids">): Promise<number>;
  create(actor: Actor, input: CreateProjectInput, meta: RequestMeta): Promise<Project>;
  defaults(): Promise<ProjectDefaults>;
  get(actor: Actor, slug: string): Promise<ProjectOverview>;
  update(actor: Actor, slug: string, patch: ProjectPatch, meta: RequestMeta): Promise<Project>;
  head(slug: string): Promise<Head>;
  quota(slug: string): Promise<Quota>;
  deletionPlan(slug: string): Promise<DeletionPlan>;
  deleteProject(actor: Actor, slug: string, input: DeletionInput, meta: RequestMeta): Promise<Job>;
};

export type ProjectsDeps = {
  repo: ProjectsRepository;
  audit: AuditService;
  settings: { get(): Promise<Settings> };
  adapters: Pick<AdaptersService, "list">;
  jobs: Pick<JobsService, "list" | "enqueue" | "replay">;
  now: () => Date;
};

export const PLAN_TTL_MS = 15 * 60 * 1000;
const WARN_RATIO = 0.8;

type StoredPlan = DeletionPlan & { slug: string };

function quotaOf(project: Project, settings: Settings, used: number, instanceUsed: number): Quota {
  const quota = project.quota_bytes ?? settings.quota.default_bytes;
  return {
    used_bytes: used,
    quota_bytes: quota,
    warn_at_bytes: Math.floor(quota * WARN_RATIO),
    instance_used_bytes: instanceUsed,
    instance_ceiling_bytes: settings.quota.instance_ceiling_bytes,
  };
}

/** The deletion plan per adapter (05 §5.4); reachability and drift come from the adapters service. */
function planFor(adapter: AdapterSummary): PlanAdapter {
  const base = {
    adapter_id: adapter.id,
    name: adapter.name,
    engine: adapter.engine,
    init_state_id: null,
    drift: null,
  };
  if (adapter.kind !== "database") return { ...base, action: "none" };
  if (adapter.mode === "read_only") return { ...base, action: "skip", reason: "read_only" };
  return { ...base, action: "restore" };
}

/** Which plan actions a request may pick per adapter (04 §4.8 step 1). */
function allowedActions(planned: PlanAdapter): readonly string[] {
  if (planned.action === "skip" || planned.action === "none") return ["skip"];
  return planned.drift === null ? ["restore", "skip"] : ["restore", "force", "skip"];
}

/** Every database adapter in the plan needs an action the plan allows (04 §4.8 step 1). */
function assertActionsAllowed(plan: DeletionPlan, chosen: Map<string, string>): void {
  for (const planned of plan.adapters) {
    if (planned.action === "none") continue;
    const action = chosen.get(planned.adapter_id);
    if (action === undefined) {
      throw conflict("every database adapter needs an action", { adapter_id: planned.adapter_id });
    }
    if (!allowedActions(planned).includes(action)) {
      throw conflict("action not allowed by the plan", { adapter_id: planned.adapter_id, action });
    }
  }
}

export function createProjectsService(deps: ProjectsDeps): ProjectsService {
  const { repo, audit } = deps;
  const plans = new Map<string, StoredPlan>();
  const nowIso = (): string => deps.now().toISOString();
  const find = (slug: string): Project => {
    const project = repo.bySlug(slug);
    if (project === null) throw notFound("project");
    return project;
  };
  const summaries = async (slug: string): Promise<AdapterSummary[]> =>
    (await deps.adapters.list(slug, {})).map((adapter) => ({
      id: adapter.id,
      name: adapter.name,
      kind: adapter.kind,
      engine: adapter.engine,
      tier: adapter.tier,
      mode: adapter.mode,
      status: adapter.status,
    }));

  return {
    async total(scope, query) {
      return repo.total({ ...query, ids: scope });
    },
    async list(scope, query) {
      return repo.list({ ...query, ids: scope });
    },
    async defaults() {
      return { quota_bytes: (await deps.settings.get()).quota.default_bytes };
    },
    async create(actor, input, meta) {
      // No await between reading what is taken and writing the row: SQLite is synchronous, so the
      // slug this finds is still free when the insert lands. An await here would open the race.
      const slug =
        input.slug ?? freeSlug(projectSlug(input.name), (free) => repo.bySlug(free) !== null);
      // A caller that names its own slug gets that slug or a refusal, never a numbered neighbour.
      if (input.slug !== undefined && repo.bySlug(slug) !== null)
        throw conflict("slug is taken", { slug });
      const project = repo.insert({
        id: Bun.randomUUIDv7(),
        slug,
        name: input.name,
        description: input.description ?? null,
        quota_bytes: input.quota_bytes ?? null,
        created_by: actor.id,
        created_at: nowIso(),
      });
      audit.record({
        actor,
        action: "project.created",
        target_type: "project",
        target_id: project.id,
        target_label: project.name,
        project: { id: project.id, slug: project.slug },
        details: { name: project.name },
        outcome: "succeeded",
        meta,
      });
      return project;
    },
    async get(actor, slug) {
      const project = find(slug);
      const [settings, adapters, jobs] = await Promise.all([
        deps.settings.get(),
        summaries(slug),
        deps.jobs.list(actor, null, {
          limit: 10,
          sort: "created_at",
          order: "desc",
          project_id: project.id,
        }),
      ]);
      return {
        project,
        adapters,
        latest_jobs: jobs.rows,
        quota: quotaOf(project, settings, repo.usedBytes(project.id), repo.instanceUsedBytes()),
        banner:
          project.head.status === "unknown"
            ? {
                kind: "head_unknown",
                message: "The last checkout did not finish. HEAD is unknown until the next one.",
              }
            : null,
      };
    },
    async update(actor, slug, patch, meta) {
      const project = find(slug);
      if (patch.quota_bytes !== undefined && actor.role !== "admin") throw forbidden("role");
      repo.update(project.id, patch, nowIso());
      audit.record({
        actor,
        action: "project.updated",
        target_type: "project",
        target_id: project.id,
        target_label: project.name,
        project: { id: project.id, slug },
        details: { fields: Object.keys(patch).join(",") },
        outcome: "succeeded",
        meta,
      });
      return find(slug);
    },
    async head(slug) {
      return find(slug).head;
    },
    async quota(slug) {
      const project = find(slug);
      const settings = await deps.settings.get();
      return quotaOf(project, settings, repo.usedBytes(project.id), repo.instanceUsedBytes());
    },
    async deletionPlan(slug) {
      const project = find(slug);
      const adapters = (await summaries(slug)).map(planFor);
      const affected = repo.deletionCounts(project.id);
      const plan: StoredPlan = {
        plan_id: Bun.randomUUIDv7(),
        expires_at: new Date(deps.now().getTime() + PLAN_TTL_MS).toISOString(),
        protected_states: affected.protected_states,
        affected,
        adapters,
        slug,
      };
      for (const [id, stored] of plans) if (stored.expires_at <= nowIso()) plans.delete(id);
      plans.set(plan.plan_id, plan);
      return {
        plan_id: plan.plan_id,
        expires_at: plan.expires_at,
        protected_states: plan.protected_states,
        affected,
        adapters,
      };
    },
    async deleteProject(actor, slug, input, meta) {
      // A repeated Idempotency-Key answers with the first job, before the plan is consumed again.
      const idempotency = idempotentRequest(meta, "project_delete", {
        slug,
        confirm_slug: input.confirm_slug,
        plan_id: input.plan_id,
        adapters: input.adapters.map((item) => ({
          adapter_id: item.adapter_id,
          action: item.action,
        })),
      });
      if (idempotency !== undefined) {
        const replayed = await deps.jobs.replay(idempotency, actor);
        if (replayed !== null) return replayed;
      }
      const project = find(slug);
      if (input.confirm_slug !== slug)
        throw conflict("the slug you typed does not match this project");
      const plan = plans.get(input.plan_id);
      if (plan === undefined || plan.slug !== slug || plan.expires_at <= nowIso()) {
        throw conflict("deletion plan is stale");
      }
      const chosen = new Map(input.adapters.map((item) => [item.adapter_id, item.action]));
      assertActionsAllowed(plan, chosen);
      plans.delete(input.plan_id);
      audit.record({
        actor,
        action: "project.deletion_requested",
        target_type: "project",
        target_id: project.id,
        target_label: project.name,
        project: { id: project.id, slug },
        details: { plan_id: input.plan_id },
        outcome: "succeeded",
        meta,
      });
      const actions = plan.adapters
        .filter((planned) => planned.action !== "none")
        .map((planned) => ({
          adapter_id: planned.adapter_id,
          action: chosen.get(planned.adapter_id) ?? "skip",
        }));
      const request: EnqueueInput = {
        kind: "project_delete",
        projectId: project.id,
        adapterIds: plan.adapters.map((planned) => planned.adapter_id),
        payload: { slug, actions },
        actor,
        parentRequestId: meta.request_id,
      };
      if (idempotency !== undefined) request.idempotency = idempotency;
      return deps.jobs.enqueue(request);
    },
  };
}
