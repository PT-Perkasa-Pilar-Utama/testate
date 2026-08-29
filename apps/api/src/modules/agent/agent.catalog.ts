import type { JsonObject, JsonValue, Project, TableSchema } from "@testate/shared";
import { jsonValueSchema } from "@testate/shared";
import * as v from "valibot";

import type { RowFilter } from "../../lib/engines/index.ts";
import { AppError, notFound } from "../../lib/http/index.ts";
import type { AdapterRecord, AdaptersRepository } from "../adapters/adapters.repository.ts";
import type { AdaptersService } from "../adapters/adapters.service.ts";
import type { AuditService } from "../audit/audit.service.ts";
import { parseFilter } from "../data/data.handler.ts";
import type { DataService } from "../data/data.service.ts";
import type { DiffsService } from "../diffs/diffs.service.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import type { ProjectsService } from "../projects/projects.service.ts";
import type { StatesService } from "../states/states.service.ts";
import type { StorageService } from "../storage/storage.service.ts";
import type { AgentContext } from "./agent.service.ts";

export type AgentToolDeps = {
  projects: ProjectsService;
  projectsRepo: Pick<ProjectsRepository, "bySlug">;
  adapters: AdaptersService;
  adaptersRepo: Pick<AdaptersRepository, "list">;
  data: DataService;
  states: StatesService;
  diffs: DiffsService;
  storage: StorageService;
  audit: AuditService;
};

/** Agent caps (18 §18.1): lower than the dashboard because an agent loops. */
export const AGENT_CAPS = {
  rowsDefault: 200,
  rowsMax: 1000,
  byteBudget: 1024 * 1024,
  timeBudgetMs: 15000,
  fixtureDepth: 3,
} as const;

export type Tool = (args: JsonObject, ctx: AgentContext, scope: Scope) => Promise<JsonValue>;

/** The project and adapter a call resolved, so audit rows and refusals name them. */
export type Scope = {
  project: (slug: string) => Project;
  adapter: (project: Project, ref: string) => AdapterRecord;
};

function text(args: JsonObject, key: string): string {
  return v.parse(v.string(`${key} is required`), args[key]);
}

function optional<TSchema extends v.GenericSchema>(
  args: JsonObject,
  key: string,
  schema: TSchema
): v.InferOutput<TSchema> | undefined {
  return args[key] === undefined ? undefined : v.parse(schema, args[key]);
}

export function json<T>(value: T): JsonValue {
  return v.parse(jsonValueSchema, value);
}

function cap(limit: number | undefined): number {
  return Math.min(limit ?? AGENT_CAPS.rowsDefault, AGENT_CAPS.rowsMax);
}

function tableOf(schema: { tables: TableSchema[] }, wanted: string): TableSchema {
  const table = schema.tables.find(
    (item) =>
      `${item.schema ?? ""}.${item.name}`.replace(/^\./, "") === wanted || item.name === wanted
  );
  if (table === undefined) throw notFound("table");
  return table;
}

function keyFilters(pk: JsonObject): RowFilter[] {
  return Object.entries(pk).map(([column, value]) => ({
    column,
    op: "eq",
    value: v.is(v.string(), value) ? value : JSON.stringify(value),
  }));
}

/** The parent's key from the child's FK columns; null when any part is NULL (no parent). */
function parentKey(row: JsonObject, columns: string[], refColumns: string[]): JsonObject | null {
  const key: JsonObject = {};
  for (const [index, column] of refColumns.entries()) {
    const value = row[columns[index] ?? ""] ?? null;
    if (value === null) return null;
    key[column] = value;
  }
  return key;
}

/** One row plus its parents one level up, every side masked (18 §18.3 `get_row`). */
async function getRow(
  deps: AgentToolDeps,
  ctx: AgentContext,
  adapter: AdapterRecord,
  table: string,
  pk: JsonObject
): Promise<JsonValue> {
  const schema = await deps.data.schema(adapter.id);
  const source = tableOf(schema, table);
  const page = await deps.data.rows(ctx.actor, adapter.id, table, {
    limit: 1,
    filters: keyFilters(pk),
  });
  const row = page.data[0];
  if (row === undefined) throw notFound("row");
  const parents: Record<string, JsonObject[]> = {};
  const masked = new Set(page.masked_columns);
  for (const fk of source.foreign_keys_out) {
    const key = parentKey(row, fk.columns, fk.ref_columns);
    if (key === null) continue;
    const ref = `${fk.ref.schema ?? ""}.${fk.ref.name}`.replace(/^\./, "");
    const parent = await deps.data.rows(ctx.actor, adapter.id, ref, {
      limit: 5,
      filters: keyFilters(key),
    });
    parents[ref] = [...(parents[ref] ?? []), ...parent.data];
    for (const column of parent.masked_columns) masked.add(`${ref}.${column}`);
  }
  return json({ row, parents, masked_columns: [...masked] });
}

function pageQuery(args: JsonObject): Parameters<DataService["rows"]>[3] {
  const query: Parameters<DataService["rows"]>[3] = {
    limit: cap(optional(args, "limit", v.number())),
    filters: (optional(args, "filter", v.array(v.string())) ?? []).map(parseFilter),
  };
  const sort = optional(args, "sort", v.string());
  const cursor = optional(args, "cursor", v.string());
  if (sort !== undefined) query.sort = sort;
  if (cursor !== undefined) query.cursor = cursor;
  return query;
}

export function tools(deps: AgentToolDeps): ReadonlyMap<string, Tool> {
  return new Map<string, Tool>(
    Object.entries({
      list_projects: async (_args, ctx) =>
        json(
          (await deps.projects.list(ctx.scope, { limit: 200, sort: "name", order: "asc" })).map(
            (project) => ({ slug: project.slug, name: project.name, head: project.head })
          )
        ),
      list_adapters: async (args, _ctx, scope) =>
        json(
          (await deps.adapters.list(scope.project(text(args, "project")).slug, {})).map(
            (adapter) => ({
              id: adapter.id,
              name: adapter.name,
              kind: adapter.kind,
              engine: adapter.engine,
              tier: adapter.tier,
              mode: adapter.mode,
            })
          )
        ),
      list_tables: async (args, _ctx, scope) => {
        const adapter = scope.adapter(scope.project(text(args, "project")), text(args, "adapter"));
        const schema = await deps.data.schema(adapter.id);
        return json(
          schema.tables.map((table) => ({
            schema: table.schema,
            name: table.name,
            kind: table.kind,
            row_estimate: table.row_estimate,
            primary_key: table.primary_key,
            unsupported: table.unsupported,
          }))
        );
      },
      describe_table: async (args, _ctx, scope) => {
        const adapter = scope.adapter(scope.project(text(args, "project")), text(args, "adapter"));
        return json(tableOf(await deps.data.schema(adapter.id), text(args, "table")));
      },
      page_rows: async (args, ctx, scope) => {
        const adapter = scope.adapter(scope.project(text(args, "project")), text(args, "adapter"));
        const page = await deps.data.rows(
          ctx.actor,
          adapter.id,
          text(args, "table"),
          pageQuery(args)
        );
        return json({
          rows: page.data,
          next_cursor: page.page.next_cursor,
          masked_columns: page.masked_columns,
        });
      },
      get_row: async (args, ctx, scope) =>
        getRow(
          deps,
          ctx,
          scope.adapter(scope.project(text(args, "project")), text(args, "adapter")),
          text(args, "table"),
          v.parse(v.record(v.string(), jsonValueSchema), args["pk"])
        ),
      run_readonly_query: async (args, ctx, scope) => {
        const adapter = scope.adapter(scope.project(text(args, "project")), text(args, "adapter"));
        const sql = optional(args, "sql", v.string());
        if (sql === undefined)
          throw new AppError("VALIDATION_ERROR", "sql is required in this build");
        const result = await deps.data.query(ctx.actor, adapter.id, {
          dialect: "sql",
          text: sql,
          mode: "read",
          row_cap: cap(optional(args, "limit", v.number())),
          byte_budget: AGENT_CAPS.byteBudget,
          time_budget_ms: AGENT_CAPS.timeBudgetMs,
          tag: "mcp",
        });
        return json({
          columns: result.columns,
          rows: result.rows,
          truncated: result.truncated,
          masked_columns: result.masked_columns,
        });
      },
      extract_fixture: async (args, ctx, scope) => {
        const adapter = scope.adapter(scope.project(text(args, "project")), text(args, "adapter"));
        return json(
          await deps.data.fixture(
            ctx.actor,
            adapter.id,
            {
              table: text(args, "table"),
              pk: v.parse(v.record(v.string(), jsonValueSchema), args["pk"]),
              depth: Math.min(optional(args, "depth", v.number()) ?? 2, AGENT_CAPS.fixtureDepth),
              direction:
                optional(args, "direction", v.picklist(["parents", "children", "both"])) ??
                "parents",
              format: optional(args, "format", v.picklist(["sql", "json"])) ?? "sql",
            },
            ctx.meta
          )
        );
      },
      list_states: async (args, _ctx, scope) => {
        const kind = optional(args, "kind", v.picklist(["init", "manual", "stash", "diff"]));
        const query: Parameters<StatesService["list"]>[1] = {
          limit: 200,
          sort: "created_at",
          order: "desc",
          includeStash: kind === "stash",
        };
        if (kind !== undefined) query.kind = kind;
        const states = await deps.states.list(scope.project(text(args, "project")).slug, query);
        return json(
          states.map((state) => ({
            id: state.id,
            name: state.name,
            kind: state.kind,
            parent_state_id: state.parent_state_id,
            created_at: state.created_at,
          }))
        );
      },
      get_state: async (args, _ctx, scope) => {
        const detail = await deps.states.get(
          scope.project(text(args, "project")).slug,
          text(args, "state")
        );
        return json({
          ...detail,
          adapters: detail.adapters.map((adapter) => ({
            ...adapter,
            tables: adapter.tables.map(({ blob_hash: _hash, ...table }) => table),
          })),
        });
      },
      diff_summary: async (args, _ctx, scope) =>
        json(await deps.diffs.get(scope.project(text(args, "project")).slug, text(args, "diff"))),
      list_files: async (args, ctx, scope) => {
        const project = scope.project(text(args, "project"));
        const adapter = scope.adapter(project, text(args, "adapter"));
        const query: Parameters<StorageService["list"]>[3] = { limit: AGENT_CAPS.rowsDefault };
        const path = optional(args, "path", v.string());
        const cursor = optional(args, "cursor", v.string());
        if (path !== undefined) query.path = path;
        if (cursor !== undefined) query.cursor = cursor;
        const page = await deps.storage.list(ctx.actor, project.slug, adapter.id, query);
        return json({ entries: page.data, next_cursor: page.next_cursor });
      },
      preview_file: async (args, ctx, scope) => {
        const project = scope.project(text(args, "project"));
        const adapter = scope.adapter(project, text(args, "adapter"));
        const result = await deps.storage.preview(
          ctx.actor,
          project.slug,
          adapter.id,
          text(args, "path")
        );
        if (result.kind === "binary")
          throw new AppError("VALIDATION_ERROR", "binary files have no text preview", {
            content_type: result.contentType,
          });
        return json(result.payload);
      },
    })
  );
}
