import type { Actor, Hook, JsonObject, RestRun } from "@testate/shared";
import type { hookRunSchema } from "@testate/shared";
import * as v from "valibot";

import { AppError, notFound } from "../../lib/http/index.ts";
import type { RequestMeta } from "../../lib/http/auth.ts";
import type { AdaptersRepository } from "../adapters/adapters.repository.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import type { RestRepository } from "../rest/rest.repository.ts";
import type { RestService, RunContext } from "../rest/rest.service.ts";
import type { HookPatch, HooksRepository } from "./hooks.repository.ts";

export type HookRunResult = v.InferOutput<typeof hookRunSchema>;

/** What a job hands to its hooks: placeholders plus the job id the runs are recorded under. */
export type HookContext = {
  projectId: string;
  jobId: string;
  actor: Actor;
  state?: { id: string; name: string };
};

export type HookInput = {
  trigger: Hook["trigger"];
  rest_request_id: string;
  fail_policy: Hook["fail_policy"];
  enabled: boolean;
};

export type HooksService = {
  list(slug: string, trigger: Hook["trigger"] | undefined): Promise<Hook[]>;
  create(actor: Actor, slug: string, input: HookInput, meta: RequestMeta): Promise<Hook>;
  update(
    actor: Actor,
    slug: string,
    id: string,
    patch: HookPatch,
    meta: RequestMeta
  ): Promise<Hook>;
  remove(actor: Actor, slug: string, id: string, meta: RequestMeta): Promise<void>;
  reorder(slug: string, trigger: Hook["trigger"], hookIds: string[]): Promise<Hook[]>;
  /** Runs the trigger's enabled hooks in order; throws HOOK_ABORTED-flavoured CONFLICT on an `abort` failure (05 §5.13). */
  run(trigger: Hook["trigger"], ctx: HookContext): Promise<HookRunResult[]>;
};

/** The subset the jobs need; the composition root passes the whole service. */
export type HookRunner = Pick<HooksService, "run">;

export type HooksDeps = {
  repo: HooksRepository;
  rest: Pick<RestService, "run">;
  requests: Pick<RestRepository, "byId">;
  adapters: Pick<AdaptersRepository, "byId">;
  projects: Pick<ProjectsRepository, "bySlug" | "byId">;
  audit: AuditService;
  now: () => Date;
};

export class HookAbort extends AppError {
  constructor(hook: Hook, run: HookRunResult) {
    super("CONFLICT", `hook ${hook.request.name} failed with policy abort`, {
      hook_id: hook.id,
      trigger: hook.trigger,
      status_code: run.status_code,
    });
    this.name = "HookAbort";
  }
}

export function hookResultsJson(results: HookRunResult[]): JsonObject[] {
  return results.map((result) => ({ ...result }));
}

export function createHooksService(deps: HooksDeps): HooksService {
  const { repo } = deps;
  const nowIso = (): string => deps.now().toISOString();
  const projectOf = (slug: string): { id: string; slug: string } => {
    const project = deps.projects.bySlug(slug);
    if (project === null) throw notFound("project");
    return project;
  };
  const find = (projectId: string, id: string): Hook => {
    const hook = repo.byId(projectId, id);
    if (hook === null) throw notFound("hook");
    return hook;
  };
  /** A request qualifies when its adapter is a REST adapter of this project (13 §13.2). */
  const requireRequest = (projectId: string, requestId: string): void => {
    const request = deps.requests.byId(requestId);
    const adapter = request === null ? null : deps.adapters.byId(request.adapter_id);
    if (adapter === null || adapter.project_id !== projectId || adapter.kind !== "rest")
      throw notFound("request");
  };
  const record = (
    actor: Actor,
    action: string,
    project: { id: string; slug: string },
    hook: Hook,
    meta: RequestMeta
  ): void =>
    deps.audit.record({
      actor,
      action,
      target_type: "hook",
      target_id: hook.id,
      project: { id: project.id, slug: project.slug },
      details: { trigger: hook.trigger, request: hook.request.name, fail_policy: hook.fail_policy },
      outcome: "succeeded",
      meta,
    });

  const succeededOrFailed = (hook: Hook, run: RestRun): HookRunResult => {
    const ok = run.matched_expected ?? (run.status_code !== null && run.status_code < 300);
    return {
      hook_id: hook.id,
      trigger: hook.trigger,
      request_run_id: run.run_id,
      status: ok ? "succeeded" : "failed",
      status_code: run.status_code,
      duration_ms: run.duration_ms,
      policy: hook.fail_policy,
    };
  };
  const unreachable = (hook: Hook, cause: unknown): HookRunResult => {
    const runId =
      cause instanceof AppError ? v.safeParse(v.string(), cause.details?.["run_id"]) : null;
    return {
      hook_id: hook.id,
      trigger: hook.trigger,
      request_run_id: runId?.success === true ? runId.output : null,
      status: "failed",
      status_code: null,
      duration_ms: null,
      policy: hook.fail_policy,
    };
  };

  const runOne = async (hook: Hook, ctx: HookContext, slug: string): Promise<HookRunResult> => {
    const startedAt = nowIso();
    const hookRunId = Bun.randomUUIDv7();
    const placeholders: RunContext["placeholders"] = { job: { id: ctx.jobId } };
    if (ctx.state !== undefined) placeholders.state = ctx.state;
    let result: HookRunResult;
    try {
      const run = await deps.rest.run(slug, hook.request.adapter_id, hook.request.id, {
        placeholders,
        jobId: ctx.jobId,
        hookRunId,
      });
      result = succeededOrFailed(hook, run);
    } catch (cause: unknown) {
      result = unreachable(hook, cause);
    }
    repo.insertRun({
      id: hookRunId,
      hook_id: hook.id,
      job_id: ctx.jobId,
      request_run_id: result.request_run_id,
      status: result.status,
      started_at: startedAt,
      finished_at: nowIso(),
    });
    deps.audit.record({
      actor: ctx.actor,
      action: "hook.run",
      target_type: "hook",
      target_id: hook.id,
      project: { id: ctx.projectId, slug },
      details: {
        trigger: hook.trigger,
        status: result.status,
        status_code: result.status_code,
        job_id: ctx.jobId,
      },
      outcome: result.status === "succeeded" ? "succeeded" : "failed",
    });
    return result;
  };

  return {
    async list(slug, trigger) {
      return repo.list(projectOf(slug).id, trigger);
    },
    async create(actor, slug, input, meta) {
      const project = projectOf(slug);
      requireRequest(project.id, input.rest_request_id);
      const hook = repo.insert(project.id, {
        id: Bun.randomUUIDv7(),
        trigger: input.trigger,
        rest_request_id: input.rest_request_id,
        enabled: input.enabled,
        fail_policy: input.fail_policy,
        created_at: nowIso(),
        updated_at: nowIso(),
      });
      record(actor, "hook.created", project, hook, meta);
      return hook;
    },
    async update(actor, slug, id, patch, meta) {
      const project = projectOf(slug);
      const hook = find(project.id, id);
      if (patch.rest_request_id !== undefined) requireRequest(project.id, patch.rest_request_id);
      repo.update(hook.id, patch, nowIso());
      const updated = find(project.id, id);
      record(actor, "hook.updated", project, updated, meta);
      return updated;
    },
    async remove(actor, slug, id, meta) {
      const project = projectOf(slug);
      const hook = find(project.id, id);
      repo.remove(hook.id);
      record(actor, "hook.deleted", project, hook, meta);
    },
    async reorder(slug, trigger, hookIds) {
      const project = projectOf(slug);
      const current = repo.list(project.id, trigger).map((hook) => hook.id);
      const same = hookIds.length === current.length && current.every((id) => hookIds.includes(id));
      if (!same || new Set(hookIds).size !== hookIds.length) {
        throw new AppError(
          "VALIDATION_ERROR",
          "hook_ids must list every hook of the trigger exactly once"
        );
      }
      repo.reorder(hookIds, nowIso());
      return repo.list(project.id, trigger);
    },
    async run(trigger, ctx) {
      const project = deps.projects.byId(ctx.projectId);
      if (project === null) throw notFound("project");
      const results: HookRunResult[] = [];
      for (const hook of repo.list(project.id, trigger)) {
        if (!hook.enabled) continue;
        const result = await runOne(hook, ctx, project.slug);
        results.push(result);
        if (result.status === "failed" && hook.fail_policy === "abort")
          throw new HookAbort(hook, result);
      }
      return results;
    },
  };
}
