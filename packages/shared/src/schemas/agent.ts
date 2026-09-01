import * as v from "valibot";

import { slugSchema } from "./common.ts";
import { jsonObjectSchema } from "./json.ts";

const adapterRef = v.pipe(v.string(), v.minLength(1));

/** Input schemas for the MCP tools, in the order 18-agent-mcp.md lists them. */
export const AGENT_TOOL_INPUTS = {
  help: v.object({}),
  list_projects: v.object({}),
  list_adapters: v.object({ project: slugSchema }),
  list_tables: v.object({ project: slugSchema, adapter: adapterRef }),
  describe_table: v.object({ project: slugSchema, adapter: adapterRef, table: v.string() }),
  page_rows: v.object({
    project: slugSchema,
    adapter: adapterRef,
    table: v.string(),
    filter: v.optional(v.array(v.string())),
    sort: v.optional(v.string()),
    cursor: v.optional(v.string()),
    limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000))),
  }),
  get_row: v.object({
    project: slugSchema,
    adapter: adapterRef,
    table: v.string(),
    pk: jsonObjectSchema,
  }),
  run_readonly_query: v.object({
    project: slugSchema,
    adapter: adapterRef,
    sql: v.optional(v.string()),
    mongo: v.optional(jsonObjectSchema),
    limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000))),
  }),
  extract_fixture: v.object({
    project: slugSchema,
    adapter: adapterRef,
    table: v.string(),
    pk: jsonObjectSchema,
    depth: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(3))),
    direction: v.optional(v.picklist(["parents", "children", "both"])),
    format: v.optional(v.picklist(["sql", "json"])),
  }),
  list_states: v.object({ project: slugSchema, kind: v.optional(v.string()) }),
  get_state: v.object({ project: slugSchema, state: v.string() }),
  diff_summary: v.object({ project: slugSchema, diff: v.string() }),
  list_files: v.object({
    project: slugSchema,
    adapter: adapterRef,
    path: v.optional(v.string()),
    cursor: v.optional(v.string()),
  }),
  preview_file: v.object({ project: slugSchema, adapter: adapterRef, path: v.string() }),
  // The tester half (23 §23.2). Listed for every agent; a viewer token is refused when it calls
  // one, which is a clearer answer than a tool that is not there.
  run_write_query: v.object({
    project: slugSchema,
    adapter: adapterRef,
    sql: v.string(),
    limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000))),
  }),
  end_write_session: v.object({ project: slugSchema, adapter: adapterRef }),
  take_snapshot: v.object({
    project: slugSchema,
    name: v.string(),
    notes: v.optional(v.string()),
    adapters: v.optional(v.array(adapterRef)),
  }),
  checkout_state: v.object({
    project: slugSchema,
    state: v.string(),
    force: v.optional(v.boolean()),
    adapters: v.optional(v.array(adapterRef)),
  }),
  get_job: v.object({ job: v.string() }),
} as const;

export type AgentToolName = keyof typeof AGENT_TOOL_INPUTS;
export const AGENT_TOOL_NAMES: readonly string[] = Object.keys(AGENT_TOOL_INPUTS);

export const jsonRpcRequestSchema = v.object({
  jsonrpc: v.literal("2.0"),
  id: v.optional(v.union([v.string(), v.number(), v.null()])),
  method: v.string(),
  params: v.optional(jsonObjectSchema),
});
export type JsonRpcRequest = v.InferOutput<typeof jsonRpcRequestSchema>;
