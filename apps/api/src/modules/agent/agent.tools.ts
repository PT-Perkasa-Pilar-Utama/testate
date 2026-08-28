import type { Actor, JsonObject, JsonValue } from "@testate/shared";
import { jsonValueSchema } from "@testate/shared";
import * as v from "valibot";

import { AppError } from "../../lib/http/index.ts";
import type { AdaptersService } from "../adapters/adapters.service.ts";
import type { DataService } from "../data/data.service.ts";
import type { DiffsService } from "../diffs/diffs.service.ts";
import type { ProjectsService } from "../projects/projects.service.ts";
import type { StatesService } from "../states/states.service.ts";
import type { StorageService } from "../storage/storage.service.ts";
import type { ToolRunner } from "./agent.service.ts";

export type AgentToolDeps = {
  projects: ProjectsService;
  adapters: AdaptersService;
  data: DataService;
  states: StatesService;
  diffs: DiffsService;
  storage: StorageService;
};

/** The agent actor: viewer role, agent flag on, so every read path applies masks and lower caps. */
const AGENT_ACTOR: Actor = {
  kind: "token",
  id: "01991f00-0000-7000-8000-0000000000a0",
  label: "token:agent",
  role: "viewer",
  agent: true,
};

type Tool = (args: JsonObject) => Promise<JsonValue>;
type TableTools = { list_tables: Tool; describe_table: Tool };

function text(args: JsonObject, key: string): string {
  return v.parse(v.string(`${key} is required`), args[key]);
}

function json<T>(value: T): JsonValue {
  return v.parse(jsonValueSchema, value);
}

function tableTools(data: DataService): TableTools {
  return {
    list_tables: async (args) => {
      const schema = await data.schema(text(args, "adapter"));
      return json(
        schema.tables.map((table) => ({
          schema: table.schema,
          name: table.name,
          row_estimate: table.row_estimate,
          primary_key: table.primary_key,
        }))
      );
    },
    describe_table: async (args) => {
      const schema = await data.schema(text(args, "adapter"));
      const wanted = text(args, "table");
      const table = schema.tables.find((item) => `${item.schema}.${item.name}` === wanted);
      if (table === undefined) throw new AppError("NOT_FOUND", "table not found");
      return json(table);
    },
  };
}

/** Maps MCP tool names to the read paths of the modules. No write path is reachable from here. */
export function createAgentTools(deps: AgentToolDeps): ToolRunner {
  const tools = new Map<string, Tool>(
    Object.entries({
      list_projects: async () => json(await deps.projects.list()),
      list_adapters: async (args) => json(await deps.adapters.list(text(args, "project"))),
      ...tableTools(deps.data),
      page_rows: async (args) =>
        json(await deps.data.rows(text(args, "adapter"), text(args, "table"))),
      get_row: async (args) =>
        json(await deps.data.rows(text(args, "adapter"), text(args, "table"))),
      run_readonly_query: async (args) =>
        json(
          await deps.data.query(AGENT_ACTOR, text(args, "adapter"), {
            dialect: "sql",
            text: text(args, "sql"),
            mode: "read",
          })
        ),
      extract_fixture: async (args) =>
        json(await deps.data.fixture(AGENT_ACTOR, text(args, "adapter"), text(args, "table"))),
      list_states: async (args) => json(await deps.states.list(text(args, "project"), false)),
      get_state: async (args) =>
        json(await deps.states.get(text(args, "project"), text(args, "state"))),
      diff_summary: async (args) =>
        json(await deps.diffs.get(text(args, "project"), text(args, "diff"))),
      list_files: async (args) =>
        json(await deps.storage.list(text(args, "adapter"), undefined, undefined)),
      preview_file: async (args) =>
        json(await deps.storage.preview(text(args, "adapter"), text(args, "path"))),
    } satisfies Record<string, Tool>)
  );
  return async (name, args) => {
    const tool = tools.get(name);
    if (tool === undefined) throw new AppError("NOT_FOUND", `unknown tool ${name}`);
    return tool(args);
  };
}
