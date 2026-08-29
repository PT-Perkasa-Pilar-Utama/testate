import type { Actor, Engine, WriteSession } from "@testate/shared";

import { AppError, conflict, forbidden, notFound } from "../../lib/http/index.ts";
import type { RequestMeta } from "../../lib/http/auth.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { JobsService } from "../jobs/jobs.service.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import type { StatesRepository } from "../states/states.repository.ts";
import type { DataRepository, WriteSessionRecord } from "./data.repository.ts";

export type SessionDeps = {
  repo: DataRepository;
  states: Pick<StatesRepository, "insert" | "byIdOrName">;
  projects: Pick<ProjectsRepository, "byId">;
  jobs: Pick<JobsService, "enqueue" | "wait">;
  audit: AuditService;
  now: () => Date;
  adapterOf: (adapterId: string) => AdapterRecord;
  idleMinutes?: number;
};

export type WriteSessions = {
  start(actor: Actor, adapterId: string, foreignKeyChecks: boolean, meta: RequestMeta): Promise<WriteSession>;
  setForeignKeyChecks(actor: Actor, id: string, enabled: boolean, meta: RequestMeta): Promise<WriteSession>;
  end(actor: Actor, id: string, meta: RequestMeta): Promise<void>;
  /** An open, unexpired session or `CONFLICT` (06 §6.6 step 1). */
  require(id: string): WriteSessionRecord;
  /** The first write takes a stash through a synchronous snapshot job (05 §5.8); later writes count. */
  beforeWrite(session: WriteSessionRecord, actor: Actor, meta: RequestMeta): Promise<string | null>;
};

const DEFAULT_IDLE_MINUTES = 30;

type Owned = { session: WriteSessionRecord; adapter: AdapterRecord };

/** How `foreign_key_checks = false` reaches the engine (12 §12.3). */
export const FK_MAPPING = {
  postgres: "SET CONSTRAINTS ALL DEFERRED",
  mysql: "SET FOREIGN_KEY_CHECKS = 0",
  mariadb: "SET FOREIGN_KEY_CHECKS = 0",
  mongodb: null,
  s3: null,
  sftp: null,
  ftp: null,
  http: null,
} as const satisfies Record<Engine, string | null>;

export function createWriteSessions(deps: SessionDeps): WriteSessions {
  const idleMs = (deps.idleMinutes ?? DEFAULT_IDLE_MINUTES) * 60 * 1000;
  const nowIso = (): string => deps.now().toISOString();
  const expiresAt = (session: WriteSessionRecord): string =>
    new Date(Date.parse(session.last_write_at ?? session.started_at) + idleMs).toISOString();
  const toPublic = (session: WriteSessionRecord, engine: Engine): WriteSession => ({
    id: session.id,
    adapter_id: session.adapter_id,
    started_at: session.started_at,
    foreign_key_checks: session.foreign_key_checks,
    fk_checks_mapping: FK_MAPPING[engine] ?? "not applicable",
    stash_state_id: session.stash_state_id,
    expires_at: expiresAt(session),
  });
  const record = (actor: Actor, action: string, adapter: AdapterRecord, session: WriteSessionRecord, meta: RequestMeta): void =>
    deps.audit.record({
      actor,
      action,
      target_type: "write_session",
      target_id: session.id,
      project: { id: adapter.project_id, slug: deps.projects.byId(adapter.project_id)?.slug ?? "" },
      adapter: { id: adapter.id, name: adapter.name },
      details: { write_count: session.write_count, foreign_key_checks: session.foreign_key_checks },
      outcome: "succeeded",
      meta,
    });
  const owned = (actor: Actor, id: string): Owned => {
    const session = deps.repo.sessionById(id);
    if (session === null || session.ended_at !== null) throw notFound("write session");
    if (session.user_id !== actor.id) throw forbidden("not the session's owner");
    return { session, adapter: deps.adapterOf(session.adapter_id) };
  };

  return {
    async start(actor, adapterId, foreignKeyChecks, meta) {
      const adapter = deps.adapterOf(adapterId);
      if (adapter.tier !== "tabular") {
        throw new AppError("ENGINE_UNSUPPORTED", "write sessions need a tabular adapter", { reason: "tier" });
      }
      if (adapter.mode !== "sandbox") {
        throw new AppError("ADAPTER_READ_ONLY", `${adapter.name} is read-only`, { adapter_id: adapter.id });
      }
      const open = deps.repo.openSession(adapter.id, actor.id);
      if (open !== null && Date.parse(expiresAt(open)) > deps.now().getTime()) {
        throw conflict("a write session is already open", { write_session_id: open.id });
      }
      if (open !== null) deps.repo.endSession(open.id, nowIso());
      const session = deps.repo.insertSession({
        id: Bun.randomUUIDv7(),
        adapter_id: adapter.id,
        user_id: actor.id,
        started_at: nowIso(),
        foreign_key_checks: foreignKeyChecks,
      });
      record(actor, "write_session.started", adapter, session, meta);
      return toPublic(session, adapter.engine);
    },
    async setForeignKeyChecks(actor, id, enabled, meta) {
      const { session, adapter } = owned(actor, id);
      if (!enabled && FK_MAPPING[adapter.engine] === null) {
        throw new AppError("ENGINE_UNSUPPORTED", "this engine cannot turn foreign-key checks off", { reason: "fk_toggle" });
      }
      deps.repo.setForeignKeyChecks(session.id, enabled);
      const updated = { ...session, foreign_key_checks: enabled };
      if (!enabled) record(actor, "write_session.fk_checks_off", adapter, updated, meta);
      return toPublic(updated, adapter.engine);
    },
    async end(actor, id, meta) {
      const { session, adapter } = owned(actor, id);
      deps.repo.endSession(session.id, nowIso());
      record(actor, "write_session.ended", adapter, session, meta);
    },
    require(id) {
      const session = deps.repo.sessionById(id);
      if (session === null || session.ended_at !== null) throw conflict("write session is closed");
      if (Date.parse(expiresAt(session)) <= deps.now().getTime()) {
        deps.repo.endSession(session.id, nowIso());
        throw conflict("write session expired", { write_session_id: session.id });
      }
      return session;
    },
    async beforeWrite(session, actor, meta) {
      if (session.stash_state_id !== null) {
        deps.repo.recordWrite(session.id, nowIso(), null);
        return session.stash_state_id;
      }
      const adapter = deps.adapterOf(session.adapter_id);
      const stateId = Bun.randomUUIDv7();
      deps.states.insert({
        id: stateId,
        project_id: adapter.project_id,
        name: `stash-${nowIso().replace(/[:.]/g, "-")}-${stateId.slice(-4)}`,
        kind: "stash",
        protected: false,
        parent_state_id: deps.projects.byId(adapter.project_id)?.head.state_id ?? null,
        stash_reason: "write-session",
        job_id: "",
        actor,
        created_at: nowIso(),
      });
      const job = await deps.jobs.enqueue({
        kind: "snapshot",
        projectId: adapter.project_id,
        adapterIds: [adapter.id],
        payload: { state_id: stateId, adapter_ids: [adapter.id] },
        actor,
        parentRequestId: meta.request_id,
      });
      const done = await deps.jobs.wait(null, job.id, 300);
      if (done.status !== "succeeded") {
        throw new AppError("ADAPTER_UNREACHABLE", "the stash before the first write failed", { job_id: job.id });
      }
      deps.repo.recordWrite(session.id, nowIso(), stateId);
      return stateId;
    },
  };
}
