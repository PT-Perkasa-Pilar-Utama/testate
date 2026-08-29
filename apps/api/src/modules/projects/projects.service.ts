import type { Actor, Head, Job, Project, Quota, Settings } from "@testate/shared";

import type { RequestMeta } from "../../lib/http/auth.ts";
import { conflict, forbidden, notFound } from "../../lib/http/index.ts";
import type { AdaptersService } from "../adapters/adapters.service.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { JobsService } from "../jobs/jobs.service.ts";
import { PROJECT_JOB_MOCK } from "./projects.mock.ts";
import type { ProjectPatch, ProjectsListQuery, ProjectsRepository } from "./projects.repository.ts";

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

export type CreateProjectInput = { slug: string; name: string; description?: string };

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
  adapters: PlanAdapter[];
};

export type DeletionInput = {
  confirm_slug: string;
  plan_id: string;
  adapters: { adapter_id: string; action: "restore" | "force" | "skip" }[];
};

export type ProjectsService = {
  list(scope: string[] | null, query: Omit<ProjectsListQuery, "ids">): Promise<Project[]>;
  create(actor: Actor, input: CreateProjectInput, meta: RequestMeta): Promise<Project>;
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
  jobs: Pick<JobsService, "list">;
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

/** SCAFFOLD: reachability, init-state lookup, and drift land with the adapters and engine cards. */
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
    async list(scope, query) {
      return repo.list({ ...query, ids: scope });
    },
    async create(actor, input, meta) {
      if (repo.bySlug(input.slug) !== null) throw conflict("slug is taken", { slug: input.slug });
      const project = repo.insert({
        id: Bun.randomUUIDv7(),
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        quota_bytes: null,
        created_by: actor.id,
        created_at: nowIso(),
      });
      audit.record({
        actor,
        action: "project.created",
        target_type: "project",
        target_id: project.id,
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
        deps.jobs.list(actor),
      ]);
      return {
        project,
        adapters,
        latest_jobs: jobs.filter((job) => job.project_id === project.id).slice(0, 10),
        quota: quotaOf(project, settings, repo.usedBytes(project.id), repo.instanceUsedBytes()),
        banner:
          project.head.status === "unknown"
            ? {
                kind: "head_unknown",
                message: "The last checkout did not finish; HEAD is unknown until the next one.",
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
      const plan: StoredPlan = {
        plan_id: Bun.randomUUIDv7(),
        expires_at: new Date(deps.now().getTime() + PLAN_TTL_MS).toISOString(),
        protected_states: repo.protectedStates(project.id),
        adapters,
        slug,
      };
      for (const [id, stored] of plans) if (stored.expires_at <= nowIso()) plans.delete(id);
      plans.set(plan.plan_id, plan);
      return {
        plan_id: plan.plan_id,
        expires_at: plan.expires_at,
        protected_states: plan.protected_states,
        adapters,
      };
    },
    async deleteProject(actor, slug, input, meta) {
      const project = find(slug);
      if (input.confirm_slug !== slug) throw conflict("confirm_slug does not match");
      const plan = plans.get(input.plan_id);
      if (plan === undefined || plan.slug !== slug || plan.expires_at <= nowIso()) {
        throw conflict("deletion plan is stale");
      }
      const chosen = new Map(input.adapters.map((item) => [item.adapter_id, item.action]));
      for (const planned of plan.adapters) {
        if (planned.action === "none") continue;
        const action = chosen.get(planned.adapter_id);
        if (action === undefined)
          throw conflict("every database adapter needs an action", {
            adapter_id: planned.adapter_id,
          });
        if (!allowedActions(planned).includes(action)) {
          throw conflict("action not allowed by the plan", {
            adapter_id: planned.adapter_id,
            action,
          });
        }
      }
      plans.delete(input.plan_id);
      audit.record({
        actor,
        action: "project.deletion_requested",
        target_type: "project",
        target_id: project.id,
        project: { id: project.id, slug },
        details: { plan_id: input.plan_id },
        outcome: "succeeded",
        meta,
      });
      // SCAFFOLD: the jobs card enqueues project_delete (return to init, then remove rows, 04 §4.8).
      return {
        ...PROJECT_JOB_MOCK,
        kind: "project_delete",
        status: "queued",
        project_id: project.id,
        finished_at: null,
        result: null,
      };
    },
  };
}
