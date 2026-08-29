import type { Actor, ColumnPolicy, Fixture, Introspection, JsonObject } from "@testate/shared";
import type { upsertColumnPolicySchema } from "@testate/shared";
import type * as v from "valibot";

import type { ConnectionRef, DbEngine, RowOpResult } from "../../lib/engines/index.ts";
import { AppError, conflict } from "../../lib/http/index.ts";
import type { RequestMeta } from "../../lib/http/auth.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import { extractFixture } from "./data.fixture.ts";
import type { FixtureRequest } from "./data.fixture.ts";
import { toRowOps } from "./data.forms.ts";
import type { RowEdit } from "./data.forms.ts";
import { lookupRows, lookupTarget } from "./data.lookup.ts";
import type { LookupRow } from "./data.lookup.ts";
import { maskRows } from "./data.masks.ts";
import { assertEditable, requirePolicy } from "./data.policies.ts";
import type { PoliciesRepository } from "./data.policies.ts";
import type { WriteSessions } from "./data.sessions.ts";

export type PolicyBody = v.InferOutput<typeof upsertColumnPolicySchema>;

export type RowEditsResult = {
  results: { index: number; kind: RowOpResult["kind"]; pk: JsonObject; row: JsonObject | null }[];
  stash_state_id: string | null;
};

export type Editing = {
  lookup(
    adapterId: string,
    table: string,
    column: string,
    q: string,
    limit: number
  ): Promise<LookupRow[]>;
  rowEdits(
    actor: Actor,
    adapterId: string,
    table: string,
    sessionId: string,
    edits: RowEdit[],
    meta: RequestMeta
  ): Promise<RowEditsResult>;
  policies(adapterId: string, table?: string): Promise<ColumnPolicy[]>;
  upsertPolicy(
    actor: Actor,
    adapterId: string,
    table: string,
    column: string,
    body: PolicyBody,
    meta: RequestMeta
  ): Promise<ColumnPolicy>;
  removePolicy(
    actor: Actor,
    adapterId: string,
    table: string,
    column: string,
    meta: RequestMeta
  ): Promise<void>;
  setPolicyLock(
    actor: Actor,
    adapterId: string,
    table: string,
    column: string,
    locked: boolean,
    meta: RequestMeta
  ): Promise<ColumnPolicy>;
  fixture(
    actor: Actor,
    adapterId: string,
    request: FixtureRequest,
    meta: RequestMeta
  ): Promise<Fixture>;
};

export type EditingDeps = {
  policies: PoliciesRepository;
  projects: Pick<ProjectsRepository, "byId">;
  audit: AuditService;
  now: () => Date;
  adapterOf: (adapterId: string) => AdapterRecord;
  connect: (adapter: AdapterRecord) => Promise<{ engine: DbEngine; conn: ConnectionRef }>;
  guarded: <T>(adapter: AdapterRecord, work: () => Promise<T>) => Promise<T>;
  schemaOf: (adapter: AdapterRecord) => Promise<Introspection>;
  sessions: WriteSessions;
};

function requireTabular(adapter: AdapterRecord): void {
  if (adapter.tier !== "tabular") {
    throw new AppError("ENGINE_UNSUPPORTED", "operation outside the adapter's tier", {
      reason: "tier",
    });
  }
}

/** Editing, lookups, policies, and fixtures on the Tabular tier (24). */
export function createEditing(deps: EditingDeps): Editing {
  const nowIso = (): string => deps.now().toISOString();
  const record = (
    actor: Actor,
    action: string,
    adapter: AdapterRecord,
    targetId: string,
    details: JsonObject,
    meta: RequestMeta
  ): void =>
    deps.audit.record({
      actor,
      action,
      target_type: "policy",
      target_id: targetId,
      project: { id: adapter.project_id, slug: deps.projects.byId(adapter.project_id)?.slug ?? "" },
      adapter: { id: adapter.id, name: adapter.name },
      details,
      outcome: "succeeded",
      meta,
    });
  const tableOf = (schema: Introspection, table: string): Introspection["tables"][number] => {
    const dot = table.indexOf(".");
    const wanted =
      dot === -1
        ? { schema: null, name: table }
        : { schema: table.slice(0, dot), name: table.slice(dot + 1) };
    const found = schema.tables.find(
      (item) =>
        (item.schema === wanted.schema || wanted.schema === null) && item.name === wanted.name
    );
    if (found === undefined) throw new AppError("NOT_FOUND", "table not found", { table });
    return found;
  };

  return {
    async lookup(adapterId, table, column, q, limit) {
      const adapter = deps.adapterOf(adapterId);
      requireTabular(adapter);
      const schema = await deps.schemaOf(adapter);
      const source = tableOf(schema, table);
      const fk = source.foreign_keys_out.find((item) => item.columns[0] === column);
      const targetKey =
        fk === undefined ? "" : `${fk.ref.schema ?? ""}.${fk.ref.name}`.replace(/^\./, "");
      const display =
        deps.policies.list(adapter.id, targetKey).find((policy) => policy.display)?.column ?? null;
      const target = lookupTarget(schema, source, column, display);
      const { engine, conn } = await deps.connect(adapter);
      return deps.guarded(adapter, () => lookupRows(engine, conn, target, q, limit));
    },
    async rowEdits(actor, adapterId, table, sessionId, edits, meta) {
      const adapter = deps.adapterOf(adapterId);
      requireTabular(adapter);
      if (adapter.mode !== "sandbox") {
        throw new AppError("ADAPTER_READ_ONLY", `${adapter.name} is read-only`, {
          adapter_id: adapter.id,
        });
      }
      const session = deps.sessions.require(sessionId);
      if (session.adapter_id !== adapter.id || session.user_id !== actor.id)
        throw conflict("write session is closed");
      const schema = await deps.schemaOf(adapter);
      const target = tableOf(schema, table);
      const needsKey = edits.some((edit) => edit.kind !== "insert");
      if (needsKey && (target.primary_key === null || target.primary_key.length === 0)) {
        throw conflict("the table has no primary key", { table });
      }
      const ops = await toRowOps(edits, deps.policies.list(adapter.id, table));
      const stashId = await deps.sessions.beforeWrite(session, actor, meta);
      const { engine, conn } = await deps.connect(adapter);
      const results = await deps.guarded(adapter, () =>
        engine.writeRows(conn, { schema: target.schema, name: target.name }, ops, {
          foreignKeyChecks: session.foreign_key_checks,
        })
      );
      return {
        results: results.map((result, index) => ({
          index,
          kind: result.kind,
          pk: result.pk,
          row: result.row === null ? null : engine.decodeRow(result.row),
        })),
        stash_state_id: stashId,
      };
    },
    async policies(adapterId, table) {
      const adapter = deps.adapterOf(adapterId);
      requireTabular(adapter);
      return deps.policies.list(adapter.id, table);
    },
    async upsertPolicy(actor, adapterId, table, column, body, meta) {
      const adapter = deps.adapterOf(adapterId);
      requireTabular(adapter);
      const existing = deps.policies.byColumn(adapter.id, table, column);
      assertEditable(actor, existing);
      const schema = await deps.schemaOf(adapter);
      if (!tableOf(schema, table).columns.some((item) => item.name === column)) {
        throw new AppError("NOT_FOUND", "column not found", { table, column });
      }
      const saved = deps.policies.upsert(
        adapter.id,
        { table, column, ...body },
        actor.id,
        nowIso()
      );
      record(
        actor,
        existing === null ? "policy.created" : "policy.updated",
        adapter,
        `${table}.${column}`,
        { table, column },
        meta
      );
      return saved;
    },
    async removePolicy(actor, adapterId, table, column, meta) {
      const adapter = deps.adapterOf(adapterId);
      requireTabular(adapter);
      const existing = requirePolicy(deps.policies.byColumn(adapter.id, table, column));
      assertEditable(actor, existing);
      deps.policies.remove(adapter.id, table, column);
      record(actor, "policy.removed", adapter, `${table}.${column}`, { table, column }, meta);
    },
    async setPolicyLock(actor, adapterId, table, column, locked, meta) {
      const adapter = deps.adapterOf(adapterId);
      requireTabular(adapter);
      requirePolicy(deps.policies.byColumn(adapter.id, table, column));
      deps.policies.setLocked(adapter.id, table, column, locked, nowIso());
      record(
        actor,
        locked ? "policy.locked" : "policy.unlocked",
        adapter,
        `${table}.${column}`,
        { table, column },
        meta
      );
      return requirePolicy(deps.policies.byColumn(adapter.id, table, column));
    },
    async fixture(actor, adapterId, request, meta) {
      const adapter = deps.adapterOf(adapterId);
      const schema = await deps.schemaOf(adapter);
      const { engine, conn } = await deps.connect(adapter);
      const fixture = await deps.guarded(adapter, () =>
        extractFixture(
          {
            engine,
            conn,
            schema,
            policies: deps.policies.list(adapter.id),
            actor,
            adapterName: adapter.name,
            engineName: adapter.engine,
            now: deps.now,
          },
          request
        )
      );
      deps.audit.record({
        actor,
        action: "fixture.extracted",
        target_type: "adapter",
        target_id: adapter.id,
        project: {
          id: adapter.project_id,
          slug: deps.projects.byId(adapter.project_id)?.slug ?? "",
        },
        adapter: { id: adapter.id, name: adapter.name },
        details: {
          table: request.table,
          rows: fixture.rows,
          masked: fixture.masked_columns.length,
        },
        outcome: "succeeded",
        meta,
      });
      return fixture;
    },
  };
}

export { maskRows };
