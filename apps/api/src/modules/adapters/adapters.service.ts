import type {
  Actor,
  Adapter,
  AdapterDraft,
  AdapterMode,
  Engine,
  Job,
  JsonObject,
  ProbeOutcome,
  Project,
} from "@testate/shared";

import type { RequestMeta } from "../../lib/http/auth.ts";
import { AppError, conflict, forbidden, notFound } from "../../lib/http/index.ts";
import type { Check, Verdict } from "../../lib/netguard/index.ts";
import type { KeyRing } from "../../lib/sealed/index.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { EnqueueInput, JobsService } from "../jobs/jobs.service.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import { validateConfig } from "./adapters.config.ts";
import type { ValidatedConfig } from "./adapters.config.ts";
import { createDeletionPlans } from "./adapters.deletion.ts";
import type { AdapterDeletionPlan, DeletionAction } from "./adapters.deletion.ts";
import {
  probeColumns,
  purposeOf,
  readonlySecretsOf,
  refusal,
  toPublic,
} from "./adapters.helpers.ts";
import { applyPatch } from "./adapters.patch.ts";
import { recheckDenyList } from "./adapters.policy.ts";
import type { AdapterPatch } from "./adapters.patch.ts";
import type { FileProbeFn, ProbeFn } from "./adapters.probe.ts";
import type { AdapterRecord, AdaptersFilter, AdaptersRepository } from "./adapters.repository.ts";
import { CONFIG_COLUMN, READONLY_COLUMN, openSecrets, sealSecrets } from "./adapters.secrets.ts";
import type { Secrets } from "./adapters.secrets.ts";

export type { AdapterDeletionPlan, DeletionAction } from "./adapters.deletion.ts";
export { PLAN_TTL_MS } from "./adapters.deletion.ts";
export type { AdapterPatch } from "./adapters.patch.ts";
export { mergeSecrets } from "./adapters.secrets.ts";

export type AdapterWithJob = { adapter: Adapter; init_job: Job | null };

export type AdaptersService = {
  list(slug: string, filter: AdaptersFilter): Promise<Adapter[]>;
  testDraft(slug: string, draft: AdapterDraft): Promise<ProbeOutcome>;
  create(
    actor: Actor,
    slug: string,
    draft: AdapterDraft,
    meta: RequestMeta
  ): Promise<AdapterWithJob>;
  get(slug: string, id: string): Promise<Adapter>;
  update(
    actor: Actor,
    slug: string,
    id: string,
    patch: AdapterPatch,
    meta: RequestMeta
  ): Promise<AdapterWithJob>;
  setMode(
    actor: Actor,
    slug: string,
    id: string,
    mode: AdapterMode,
    meta: RequestMeta
  ): Promise<Adapter>;
  retest(actor: Actor, slug: string, id: string, meta: RequestMeta): Promise<ProbeOutcome>;
  deletionPlan(slug: string, id: string): Promise<AdapterDeletionPlan>;
  remove(
    actor: Actor,
    slug: string,
    id: string,
    planId: string,
    action: DeletionAction,
    meta: RequestMeta
  ): Promise<Job>;
  /** Disables every adapter whose target the deny list now blocks; returns their ids (16 §16.2). */
  recheckDenyList(): Promise<string[]>;
};

export type AdaptersDeps = {
  repo: AdaptersRepository;
  projects: Pick<ProjectsRepository, "bySlug">;
  audit: AuditService;
  ring: KeyRing;
  netguard: { check(input: Check): Promise<Verdict> };
  probe: ProbeFn;
  fileProbe: FileProbeFn;
  jobs: Pick<JobsService, "enqueue" | "replay">;
  now: () => Date;
};

export function createAdaptersService(deps: AdaptersDeps): AdaptersService {
  const { repo, audit, ring } = deps;
  const plans = createDeletionPlans(repo, deps.now);
  const nowIso = (): string => deps.now().toISOString();

  const projectOf = (slug: string): Project => {
    const project = deps.projects.bySlug(slug);
    if (project === null) throw notFound("project");
    return project;
  };
  const find = (projectId: string, id: string): AdapterRecord => {
    const adapter = repo.byId(id);
    if (adapter === null || adapter.project_id !== projectId) throw notFound("adapter");
    return adapter;
  };
  const probe = async (
    engine: Engine,
    validated: ValidatedConfig,
    secrets: Secrets
  ): Promise<ProbeOutcome> => {
    const verdict = await deps.netguard.check({
      ...validated.target,
      purpose: purposeOf(validated.kind),
    });
    if (!verdict.allowed) throw refusal(verdict, validated.target);
    if (validated.kind !== "database") return deps.fileProbe(engine, validated.config, secrets);
    const result = await deps.probe(engine, validated.config, secrets);
    if (!result.meets_floor) {
      throw new AppError("ENGINE_UNSUPPORTED", `${engine} ${result.version} is below the floor`, {
        floor: result.floor,
        version: result.version,
      });
    }
    return result;
  };
  const record = (
    actor: Actor,
    action: string,
    adapter: AdapterRecord,
    slug: string,
    meta: RequestMeta,
    details: JsonObject = {}
  ): void =>
    audit.record({
      actor,
      action,
      target_type: "adapter",
      target_id: adapter.id,
      project: { id: adapter.project_id, slug },
      adapter: { id: adapter.id, name: adapter.name },
      details,
      outcome: "succeeded",
      meta,
    });
  /** A database adapter gets its init state through a snapshot job (05 §5.3 step 4). */
  const initJob = async (
    adapter: AdapterRecord,
    actor: Actor,
    meta: RequestMeta
  ): Promise<Job | null> => {
    if (adapter.kind !== "database") return null;
    return deps.jobs.enqueue({
      kind: "snapshot",
      projectId: adapter.project_id,
      adapterIds: [adapter.id],
      payload: { init: true, adapter_id: adapter.id },
      actor,
      parentRequestId: meta.request_id,
    });
  };
  const failRetest = (id: string, cause: unknown): void => {
    if (!(cause instanceof AppError)) return;
    if (cause.code === "HOST_BLOCKED") repo.setStatus(id, "disabled", "policy", nowIso());
    else repo.setStatus(id, "error", cause.message, nowIso());
  };

  return {
    async list(slug, filter) {
      return repo.list(projectOf(slug).id, filter).map(toPublic);
    },
    async testDraft(slug, draft) {
      projectOf(slug);
      return probe(
        draft.engine,
        validateConfig(draft.engine, draft.kind, draft.config, draft.secrets),
        draft.secrets
      );
    },
    async create(actor, slug, draft, meta) {
      const project = projectOf(slug);
      if (repo.byName(project.id, draft.name) !== null)
        throw conflict("adapter name is taken", { name: draft.name });
      const validated = validateConfig(draft.engine, draft.kind, draft.config, draft.secrets);
      const outcome = await probe(draft.engine, validated, draft.secrets);
      const id = Bun.randomUUIDv7();
      const readonly = readonlySecretsOf(draft);
      repo.insert({
        id,
        project_id: project.id,
        kind: draft.kind,
        engine: draft.engine,
        name: draft.name,
        mode: draft.kind === "database" ? draft.mode : "read_only",
        config_public: validated.config,
        config_sealed: await sealSecrets(ring, id, CONFIG_COLUMN, draft.secrets),
        readonly_config_sealed:
          readonly === null ? null : await sealSecrets(ring, id, READONLY_COLUMN, readonly),
        excluded_tables: draft.excluded_tables ?? [],
        restore_mode: draft.restore_mode ?? "atomic",
        lock_timeout_ms: draft.lock_timeout_ms ?? 60000,
        target_hash: validated.targetHash,
        has_secrets: Object.keys(draft.secrets).length > 0,
        created_at: nowIso(),
      });
      repo.setProbe(id, probeColumns(outcome, nowIso()), nowIso());
      const adapter = find(project.id, id);
      record(actor, "adapter.created", adapter, slug, meta, {
        engine: adapter.engine,
        kind: adapter.kind,
      });
      return { adapter: toPublic(adapter), init_job: await initJob(adapter, actor, meta) };
    },
    async get(slug, id) {
      return toPublic(find(projectOf(slug).id, id));
    },
    async update(actor, slug, id, patch, meta) {
      const project = projectOf(slug);
      const current = find(project.id, id);
      if (
        patch.name !== undefined &&
        patch.name !== current.name &&
        repo.byName(project.id, patch.name) !== null
      ) {
        throw conflict("adapter name is taken", { name: patch.name });
      }
      const change = await applyPatch(
        { ring, nowIso, probe: (validated, secrets) => probe(current.engine, validated, secrets) },
        current,
        patch
      );
      repo.updateConfig(id, change.columns, nowIso());
      if (change.outcome !== null)
        repo.setProbe(id, probeColumns(change.outcome, nowIso()), nowIso());
      const updated = find(project.id, id);
      record(
        actor,
        change.credentialReplaced ? "adapter.credential_replaced" : "adapter.updated",
        updated,
        slug,
        meta,
        { fields: Object.keys(patch).join(",") }
      );
      return {
        adapter: toPublic(updated),
        init_job: change.newTarget ? await initJob(updated, actor, meta) : null,
      };
    },
    async setMode(actor, slug, id, mode, meta) {
      const adapter = find(projectOf(slug).id, id);
      if (adapter.kind !== "database")
        throw new AppError("VALIDATION_ERROR", "only database adapters have a mode");
      if (mode === "sandbox" && actor.role !== "admin") throw forbidden("loosening requires admin");
      repo.setMode(id, mode, nowIso());
      const ended = mode === "read_only" ? repo.endWriteSessions(id, nowIso()) : 0;
      record(
        actor,
        mode === "sandbox" ? "adapter.mode_loosened" : "adapter.mode_tightened",
        adapter,
        slug,
        meta,
        { write_sessions_ended: ended }
      );
      return toPublic(find(adapter.project_id, id));
    },
    async retest(actor, slug, id, meta) {
      const adapter = find(projectOf(slug).id, id);
      const secrets = await openSecrets(ring, id, CONFIG_COLUMN, adapter.config_sealed);
      const validated = validateConfig(adapter.engine, adapter.kind, adapter.config, secrets);
      try {
        const outcome = await probe(adapter.engine, validated, secrets);
        repo.setProbe(id, probeColumns(outcome, nowIso()), nowIso());
        record(actor, "adapter.updated", adapter, slug, meta, { retest: "ok" });
        return outcome;
      } catch (cause: unknown) {
        failRetest(id, cause);
        throw cause;
      }
    },
    async deletionPlan(slug, id) {
      return plans.plan(find(projectOf(slug).id, id));
    },
    recheckDenyList: () => recheckDenyList({ repo, ring, netguard: deps.netguard, now: deps.now }),
    async remove(actor, slug, id, planId, action, meta) {
      const project = projectOf(slug);
      // A repeated Idempotency-Key after the row is gone still answers with the same job.
      if (meta.idempotency_key !== undefined && repo.byId(id) === null) {
        const replayed = await deps.jobs.replay(meta.idempotency_key, actor);
        if (replayed !== null) return replayed;
      }
      const adapter = find(project.id, id);
      plans.consume(id, planId, action);
      record(actor, "adapter.deletion_requested", adapter, slug, meta, { plan_id: planId, action });
      const request: EnqueueInput = {
        kind: "adapter_delete",
        projectId: adapter.project_id,
        adapterIds: [adapter.id],
        payload: { slug, adapter_id: adapter.id, name: adapter.name, action },
        actor,
        parentRequestId: meta.request_id,
      };
      if (meta.idempotency_key !== undefined) request.idempotencyKey = meta.idempotency_key;
      return deps.jobs.enqueue(request);
    },
  };
}
