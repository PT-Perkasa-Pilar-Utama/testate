import type {
  Actor,
  Adapter,
  AdapterDraft,
  AdapterKind,
  AdapterMode,
  AdapterWithProject,
  Engine,
  Job,
  ProbeOutcome,
  Project,
} from "@testate/shared";

import type { RequestMeta } from "../../lib/http/auth.ts";
import { AppError, conflict, forbidden, notFound } from "../../lib/http/index.ts";
import type { IngestService } from "../ingest/ingest.service.ts";
import type { Check, Verdict } from "../../lib/netguard/index.ts";
import type { KeyRing } from "../../lib/sealed/index.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { JobsService } from "../jobs/jobs.service.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import { validateConfig } from "./adapters.config.ts";
import type { ValidatedConfig } from "./adapters.config.ts";
import { listByKind } from "./adapters.stores.ts";
import { createDeletionPlans, enqueueDeletion } from "./adapters.deletion.ts";
import { createInitJob } from "./adapters.init.ts";
import type { StatesRepository } from "../states/states.repository.ts";
import type { RemoveDeps } from "./adapters.deletion.ts";
import type { AdapterDeletionPlan, DeletionAction } from "./adapters.deletion.ts";
import {
  adapterRecorder,
  probeColumns,
  readonlySecretsOf,
  sharedTargetWarning,
  toPublic,
} from "./adapters.helpers.ts";
import { applyPatch } from "./adapters.patch.ts";
import { recheckDenyList } from "./adapters.policy.ts";
import type { AdapterPatch } from "./adapters.patch.ts";
import { probeTarget } from "./adapters.probe.ts";
import type { FileProbeFn, ProbeFn } from "./adapters.probe.ts";
import type { AdapterRecord, AdaptersFilter, AdaptersRepository } from "./adapters.repository.ts";
import { CONFIG_COLUMN, READONLY_COLUMN, openSecrets, sealSecrets } from "./adapters.secrets.ts";
import type { Secrets } from "./adapters.secrets.ts";
import {
  assertMayManage,
  assertModeChangeable,
  modeOnCreate,
  takesInit,
} from "./adapters.inspect.ts";

export type { AdapterDeletionPlan, DeletionAction } from "./adapters.deletion.ts";
export { PLAN_TTL_MS } from "./adapters.deletion.ts";
export type { AdapterPatch } from "./adapters.patch.ts";
export { mergeSecrets } from "./adapters.secrets.ts";

export type AdapterWithJob = {
  adapter: Adapter;
  init_job: Job | null;
  /** An `ingest` adapter's token, in the create answer only (I8). */
  ingest_token?: string | null;
};

export type AdaptersService = {
  list(slug: string, filter: AdaptersFilter): Promise<Adapter[]>;
  /** Every adapter of one kind across the projects this caller may see (adapters.stores.ts). */
  listByKind(scope: string[] | null, kind: AdapterKind): Promise<AdapterWithProject[]>;
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
  projects: Pick<ProjectsRepository, "bySlug" | "byId">;
  audit: AuditService;
  ring: KeyRing;
  netguard: { check(input: Check): Promise<Verdict> };
  probe: ProbeFn;
  fileProbe: FileProbeFn;
  jobs: Pick<JobsService, "enqueue" | "replay">;
  states: Pick<StatesRepository, "insert" | "nameTaken" | "update" | "initOf">;
  /** An `ingest` adapter's token is minted with it and answered once (I8). */
  ingest: Pick<IngestService, "mint">;
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
  const probe = (
    engine: Engine,
    validated: ValidatedConfig,
    secrets: Secrets
  ): Promise<ProbeOutcome> => probeTarget(deps, engine, validated, secrets);
  const record = adapterRecorder(audit);
  const ingestToken = (adapter: AdapterRecord): string | null =>
    adapter.engine === "ingest" ? deps.ingest.mint(adapter.id).token : null;
  const initJob = createInitJob({ states: deps.states, jobs: deps.jobs, now: deps.now });
  /**
   * A database joins the starting point, or is repointed at another one, only while every
   * database holds its starting point: HEAD on init and nothing moved since. That is what makes
   * init one moment for every database, whenever each was connected. A project that has never
   * been restored (HEAD empty) is at its start by definition; the first init job moves HEAD there.
   */
  const assertAtInit = (project: { id: string; head: Project["head"] }): void => {
    const init = deps.states.initOf(project.id);
    if (init === null || project.head.state_id === null) return;
    const there =
      project.head.state_id === init.id && !project.head.dirty && project.head.status !== "unknown";
    if (!there) {
      throw conflict(
        "check out the starting point first: a database joins it only while every database holds it",
        { head: project.head.state_id, init: init.id }
      );
    }
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
    async listByKind(scope, kind) {
      return listByKind(repo.all(), deps.projects, scope, kind);
    },
    async testDraft(slug, draft) {
      projectOf(slug);
      const validated = validateConfig(draft.engine, draft.kind, draft.config, draft.secrets);
      const outcome = await probe(draft.engine, validated, draft.secrets);
      // Two adapters on one database do not see each other: their jobs are not serialised, and a
      // reset through one rewinds the other's work. Say so while the operator can still stop.
      const shared = repo.sharingTarget(validated.targetHash);
      return shared.length === 0
        ? outcome
        : { ...outcome, warnings: [...outcome.warnings, sharedTargetWarning(shared)] };
    },
    async create(actor, slug, draft, meta) {
      const project = projectOf(slug);
      if (repo.byName(project.id, draft.name) !== null)
        throw conflict("adapter name is taken", { name: draft.name });
      if (draft.kind === "database" && takesInit(project)) assertAtInit(project);
      const mode = modeOnCreate(project, draft);
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
        mode,
        config_public: validated.config,
        config_sealed: await sealSecrets(ring, id, CONFIG_COLUMN, draft.secrets),
        readonly_config_sealed:
          readonly === null ? null : await sealSecrets(ring, id, READONLY_COLUMN, readonly),
        excluded_tables: draft.excluded_tables ?? [],
        restore_mode: draft.restore_mode ?? "atomic",
        lock_timeout_ms: draft.lock_timeout_ms ?? 60000,
        target_hash: validated.targetHash,
        has_secrets: Object.keys(draft.secrets).length > 0,
        // A token is not a user, so a token-made adapter has no creator and is an admin's.
        created_by: actor.kind === "user" ? actor.id : null,
        created_at: nowIso(),
      });
      repo.setProbe(id, probeColumns(outcome, nowIso()), nowIso());
      const adapter = find(project.id, id);
      record(actor, "adapter.created", adapter, slug, meta, {
        engine: adapter.engine,
        kind: adapter.kind,
      });
      const init = takesInit(project) ? await initJob(adapter, actor, meta) : null;
      return { adapter: toPublic(adapter), init_job: init, ingest_token: ingestToken(adapter) };
    },
    async get(slug, id) {
      return toPublic(find(projectOf(slug).id, id));
    },
    async update(actor, slug, id, patch, meta) {
      const project = projectOf(slug);
      const current = find(project.id, id);
      assertMayManage(project, current, actor);
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
      const reinit = change.newTarget && takesInit(project);
      if (reinit) assertAtInit(project);
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
        init_job: reinit ? await initJob(updated, actor, meta) : null,
      };
    },
    /**
     * A file store has a mode too, and it means the same thing there as it does on a database:
     * `read_only` refuses every write. A tester picks the mode when the adapter is created; every
     * change after that is an admin's, in either direction, so the mode a database was protected
     * with is not something a tester's session or token can undo or reshuffle.
     *
     * This used to refuse anything that was not a database, which left a file store stuck on
     * whatever mode it was created with. Uploading, deleting and renaming a file all check the
     * mode, so a store made read-only could never be written to again and one made sandbox could
     * never be protected. Ending write sessions is still a database's business; a file store has
     * none, and `endWriteSessions` finds none to end.
     */
    async setMode(actor, slug, id, mode, meta) {
      const project = projectOf(slug);
      const adapter = find(project.id, id);
      assertModeChangeable(project, adapter.kind);
      if (actor.role !== "admin") throw forbidden("changing the mode requires admin");
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
      const removal: RemoveDeps = {
        jobs: deps.jobs,
        plans,
        adapterOf: () => assertMayManage(project, find(project.id, id), actor),
        record: (adapter, details) =>
          record(actor, "adapter.deletion_requested", adapter, slug, meta, details),
      };
      return enqueueDeletion(removal, slug, id, planId, action, actor, meta);
    },
  };
}
