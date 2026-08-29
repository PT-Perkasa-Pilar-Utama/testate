import type {
  Actor,
  Checkout,
  CheckoutRequest,
  Job,
  Preflight,
  Project,
  State,
} from "@testate/shared";

import { AppError, conflict, notFound } from "../../lib/http/index.ts";
import { toConnectionConfig } from "../../lib/engines/connection.ts";
import type { RequestMeta } from "../../lib/http/auth.ts";
import { CONFIG_COLUMN, openSecrets } from "../adapters/adapters.secrets.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { EnqueueInput, JobsService } from "../jobs/jobs.service.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import { preflight } from "./checkouts.preflight.ts";
import type {
  AdapterCounters,
  CheckoutsFilter,
  CheckoutsRepository,
} from "./checkouts.repository.ts";
import type { RestoreDeps } from "./checkouts.restore.ts";
import { statusOf } from "./checkouts.job.ts";
import { repairCounters } from "./checkouts.counters.ts";

export type CheckoutWithJob = { checkout: Checkout; job: Job };

export type CheckoutsService = {
  preflight(slug: string, input: CheckoutRequest): Promise<Preflight>;
  create(
    actor: Actor,
    slug: string,
    input: CheckoutRequest,
    meta: RequestMeta
  ): Promise<CheckoutWithJob>;
  list(slug: string, filter: CheckoutsFilter): Promise<Checkout[]>;
  get(slug: string, id: string): Promise<Checkout>;
  retry(actor: Actor, slug: string, id: string, meta: RequestMeta): Promise<CheckoutWithJob>;
  terminateBlockers(
    actor: Actor,
    slug: string,
    id: string,
    adapterId: string,
    sessionIds: string[],
    meta: RequestMeta
  ): Promise<{ terminated: string[]; failed: string[] }>;
  counters(slug: string, id: string): Promise<{ adapters: AdapterCounters[] }>;
  repairCounters(
    actor: Actor,
    slug: string,
    id: string,
    meta: RequestMeta
  ): Promise<{ adapters: AdapterCounters[] }>;
};

export type CheckoutsDeps = RestoreDeps & {
  repo: CheckoutsRepository;
  projects: Pick<ProjectsRepository, "bySlug" | "setHead">;
  jobs: Pick<JobsService, "enqueue">;
  audit: AuditService;
  now: () => Date;
};

const RETRIABLE = new Set<Checkout["adapters"][number]["result"]>([
  "rolled_back",
  "unknown",
  "counters_failed",
  "pending",
]);

export function createCheckoutsService(deps: CheckoutsDeps): CheckoutsService {
  const { repo, audit } = deps;
  const projectOf = (slug: string): Project => {
    const project = deps.projects.bySlug(slug);
    if (project === null) throw notFound("project");
    return project;
  };
  const find = (project: Project, id: string): Checkout => {
    const checkout = repo.byId(project.id, id);
    if (checkout === null) throw notFound("checkout");
    return checkout;
  };
  const stateOf = (project: Project, input: CheckoutRequest): State => {
    const state = deps.states.byIdOrName(project.id, input.state_id ?? input.state_name ?? "");
    if (state === null || state.kind === "diff") throw notFound("state");
    if (state.status !== "ready") throw conflict("state is not ready", { status: state.status });
    return state;
  };
  /** State adapters ∩ live project adapters ∩ requested; every one must be sandbox (09 §9.2). */
  const targets = (
    project: Project,
    state: State,
    requested: string[] | undefined
  ): AdapterRecord[] => {
    const live = state.adapters.flatMap((entry) => {
      const adapter = deps.adapters.byId(entry.adapter_id);
      return adapter === null || adapter.project_id !== project.id ? [] : [adapter];
    });
    const chosen =
      requested === undefined ? live : live.filter((adapter) => requested.includes(adapter.id));
    if (chosen.length === 0) throw conflict("no adapter of the state is available for checkout");
    const readOnly = chosen.find((adapter) => adapter.mode !== "sandbox");
    if (readOnly !== undefined) {
      throw new AppError("ADAPTER_READ_ONLY", `${readOnly.name} is read-only`, {
        adapter_id: readOnly.id,
      });
    }
    return chosen;
  };
  const record = (
    actor: Actor,
    action: string,
    project: Project,
    checkout: Checkout,
    meta: RequestMeta
  ): void =>
    audit.record({
      actor,
      action,
      target_type: "checkout",
      target_id: checkout.id,
      project: { id: project.id, slug: project.slug },
      details: { state_id: checkout.state.id, force: checkout.force },
      outcome: "succeeded",
      meta,
    });
  const enqueue = async (
    project: Project,
    checkoutId: string,
    stateId: string,
    adapterIds: string[],
    force: boolean,
    retry: boolean,
    actor: Actor,
    meta: RequestMeta
  ): Promise<Job> => {
    const request: EnqueueInput = {
      kind: "checkout",
      projectId: project.id,
      adapterIds,
      payload: {
        checkout_id: checkoutId,
        state_id: stateId,
        adapter_ids: adapterIds,
        force,
        retry,
      },
      actor,
      parentRequestId: meta.request_id,
    };
    if (meta.idempotency_key !== undefined) request.idempotencyKey = meta.idempotency_key;
    return deps.jobs.enqueue(request);
  };

  return {
    async preflight(slug, input) {
      const project = projectOf(slug);
      const state = stateOf(project, input);
      const manifests = deps.states.manifestsOf(state.id);
      const outside = deps.adapters
        .list(project.id, { kind: "database" })
        .filter((adapter) => !manifests.some((manifest) => manifest.adapter_id === adapter.id));
      return preflight(deps, state, manifests, outside, input.adapter_ids, input.force);
    },
    async create(actor, slug, input, meta) {
      const project = projectOf(slug);
      const state = stateOf(project, input);
      const adapters = targets(project, state, input.adapter_ids);
      const id = Bun.randomUUIDv7();
      // The row exists before the job: the dispatcher may start the runner inside `enqueue`.
      repo.insert({
        id,
        project_id: project.id,
        state_id: state.id,
        job_id: "",
        force: input.force,
        purpose: "checkout",
        adapter_ids: adapters.map((adapter) => adapter.id),
        actor,
        created_at: deps.now().toISOString(),
      });
      let job: Job;
      try {
        job = await enqueue(
          project,
          id,
          state.id,
          adapters.map((adapter) => adapter.id),
          input.force,
          false,
          actor,
          meta
        );
      } catch (cause: unknown) {
        repo.finish(id, "failed", deps.now().toISOString());
        throw cause;
      }
      repo.setJob(id, job.id);
      const checkout = find(project, id);
      record(actor, "checkout.created", project, checkout, meta);
      if (input.force) record(actor, "checkout.forced", project, checkout, meta);
      return { checkout, job };
    },
    async list(slug, filter) {
      return repo.list(projectOf(slug).id, filter);
    },
    async get(slug, id) {
      return find(projectOf(slug), id);
    },
    async retry(actor, slug, id, meta) {
      const project = projectOf(slug);
      const checkout = find(project, id);
      if (checkout.status === "running") throw conflict("checkout is still running");
      const failed = checkout.adapters.filter((adapter) => RETRIABLE.has(adapter.result));
      if (failed.length === 0) throw conflict("nothing to retry");
      const ids = failed.map((adapter) => adapter.adapter_id);
      const job = await enqueue(
        project,
        checkout.id,
        checkout.state.id,
        ids,
        checkout.force,
        true,
        actor,
        meta
      );
      repo.resetAdapters(checkout.id, ids, job.id);
      const updated = find(project, checkout.id);
      record(actor, "checkout.retried", project, updated, meta);
      return { checkout: updated, job };
    },
    async terminateBlockers(actor, slug, id, adapterId, sessionIds, meta) {
      const project = projectOf(slug);
      const checkout = find(project, id);
      const adapter = deps.adapters.byId(adapterId);
      if (adapter === null || adapter.project_id !== project.id) throw notFound("adapter");
      if (adapter.capabilities?.canTerminateSessions !== true) {
        throw new AppError("ENGINE_UNSUPPORTED", "the probe found no privilege to end sessions", {
          reason: "capability",
        });
      }
      const secrets = await openSecrets(
        deps.ring,
        adapter.id,
        CONFIG_COLUMN,
        adapter.config_sealed
      );
      const config = toConnectionConfig(adapter.engine, adapter.config, secrets);
      const engine = deps.engines.require(adapter.engine);
      const result = await engine.terminateSessions(
        { connectionId: adapter.id, config },
        sessionIds
      );
      audit.record({
        actor,
        action: "checkout.blockers_terminated",
        target_type: "checkout",
        target_id: checkout.id,
        project: { id: project.id, slug: project.slug },
        adapter: { id: adapter.id, name: adapter.name },
        details: { terminated: result.terminated, failed: result.failed },
        outcome: result.failed.length === 0 ? "succeeded" : "partial",
        meta,
      });
      return result;
    },
    async counters(slug, id) {
      return { adapters: repo.counters(find(projectOf(slug), id).id) };
    },
    async repairCounters(actor, slug, id, meta) {
      const project = projectOf(slug);
      const checkout = find(project, id);
      const repaired = await repairCounters(deps, checkout);
      const after = find(project, checkout.id);
      const status = statusOf(after.adapters.map((adapter) => adapter.result));
      repo.finish(after.id, status, deps.now().toISOString());
      if (status === "succeeded") {
        deps.projects.setHead(project.id, after.state.id, "at_state", deps.now().toISOString());
      }
      record(actor, "checkout.counters_repaired", project, after, meta);
      return { adapters: repaired };
    },
  };
}
