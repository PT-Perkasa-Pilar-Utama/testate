import { toJsonSchema } from "@valibot/to-json-schema";
import type { Actor, JsonObject, JsonRpcRequest, JsonValue } from "@testate/shared";
import {
  AGENT_TOOL_INPUTS,
  jsonObjectSchema,
  jsonRpcRequestSchema,
  jsonValueSchema,
} from "@testate/shared";
import * as v from "valibot";

import { AppError } from "../../lib/http/index.ts";
import { TOOL_DESCRIPTIONS } from "./agent.guide.ts";
import type { RequestMeta } from "../../lib/http/auth.ts";

export const MCP_PROTOCOL_VERSION = "2025-03-26";

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: JsonValue }
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      error: { code: number; message: string; data?: JsonValue };
    };

/** Who is calling and what they may see; the handler builds it from the bearer token (23 §23.1). */
export type AgentContext = { actor: Actor; scope: string[] | null; meta: RequestMeta };

export type Resource = { uri: string; name: string; mimeType: string };

/** The read paths behind the protocol; tools and resources never reach a write path. */
export type AgentRuntime = {
  runTool(name: string, args: JsonObject, ctx: AgentContext): Promise<JsonValue>;
  listResources(ctx: AgentContext): Promise<Resource[]>;
  readResource(uri: string, ctx: AgentContext): Promise<JsonValue>;
};

export type AgentService = {
  handle(raw: JsonValue, runtime: AgentRuntime, ctx: AgentContext): Promise<JsonRpcResponse | null>;
};

export const ERR_PARSE = -32700;
export const ERR_RATE_LIMITED = -32000;
const ERR_INVALID_REQUEST = -32600;
const ERR_METHOD = -32601;
const ERR_PARAMS = -32602;

const TOOLS: ReadonlyMap<string, v.GenericSchema> = new Map(Object.entries(AGENT_TOOL_INPUTS));

function error(
  id: string | number | null,
  code: number,
  message: string,
  data?: JsonValue
): JsonRpcResponse {
  return data === undefined
    ? { jsonrpc: "2.0", id, error: { code, message } }
    : { jsonrpc: "2.0", id, error: { code, message, data } };
}

function toolList(): JsonValue {
  return [...TOOLS.entries()].map(([name, schema]) => ({
    name,
    description: TOOL_DESCRIPTIONS.get(name) ?? `Testate read-only tool ${name}`,
    inputSchema: v.parse(jsonValueSchema, toJsonSchema(schema)),
  }));
}

/** Tool failures are results with `isError`, carrying the 01 §1.6 error code (18 §18.4). */
function toolFailure(id: string | number | null, cause: unknown): JsonRpcResponse {
  const body =
    cause instanceof AppError
      ? { code: cause.code, message: cause.message, details: cause.details ?? {} }
      : { code: "INTERNAL", message: cause instanceof Error ? cause.message : String(cause) };
  return {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: JSON.stringify(body) }], isError: true },
  };
}

async function callTool(
  id: string | number | null,
  params: JsonObject,
  runtime: AgentRuntime,
  ctx: AgentContext
): Promise<JsonRpcResponse> {
  const name = v.safeParse(v.string(), params["name"]);
  const schema = name.success ? TOOLS.get(name.output) : undefined;
  if (!name.success || schema === undefined) return error(id, ERR_PARAMS, "unknown tool");
  const args = v.safeParse(schema, params["arguments"] ?? {});
  if (!args.success)
    return error(id, ERR_PARAMS, "invalid params", {
      issues: args.issues.map((issue) => issue.message),
    });
  try {
    const result = await runtime.runTool(name.output, v.parse(jsonObjectSchema, args.output), ctx);
    return {
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: JSON.stringify(result) }] },
    };
  } catch (cause: unknown) {
    return toolFailure(id, cause);
  }
}

async function readResource(
  id: string | number | null,
  params: JsonObject,
  runtime: AgentRuntime,
  ctx: AgentContext
): Promise<JsonRpcResponse> {
  const uri = v.safeParse(v.string(), params["uri"]);
  if (!uri.success) return error(id, ERR_PARAMS, "uri is required");
  try {
    const text = JSON.stringify(await runtime.readResource(uri.output, ctx));
    return {
      jsonrpc: "2.0",
      id,
      result: { contents: [{ uri: uri.output, mimeType: "application/json", text }] },
    };
  } catch (cause: unknown) {
    return toolFailure(id, cause);
  }
}

/**
 * In-house JSON-RPC handler for the MCP subset: initialize, ping, tools/list, tools/call,
 * resources/list, resources/read. Chosen over @hono/mcp, which peer-requires zod (04 §4.8).
 */
export function createAgentService(version: string): AgentService {
  return {
    async handle(raw, runtime, ctx) {
      const parsed = v.safeParse(jsonRpcRequestSchema, raw);
      if (!parsed.success) return error(null, ERR_INVALID_REQUEST, "invalid request");
      const request: JsonRpcRequest = parsed.output;
      if (request.id === undefined) return null;
      return dispatch(request, request.id, version, runtime, ctx);
    },
  };
}

async function dispatch(
  request: JsonRpcRequest,
  id: string | number | null,
  version: string,
  runtime: AgentRuntime,
  ctx: AgentContext
): Promise<JsonRpcResponse> {
  switch (request.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          serverInfo: { name: "testate", version },
          capabilities: { tools: {}, resources: {} },
        },
      };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: toolList() } };
    case "tools/call":
      return callTool(id, request.params ?? {}, runtime, ctx);
    case "resources/list":
      return {
        jsonrpc: "2.0",
        id,
        result: { resources: v.parse(jsonValueSchema, await runtime.listResources(ctx)) },
      };
    case "resources/read":
      return readResource(id, request.params ?? {}, runtime, ctx);
    default:
      return error(id, ERR_METHOD, `unknown method ${request.method}`);
  }
}
