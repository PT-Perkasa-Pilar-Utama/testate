import { toJsonSchema } from "@valibot/to-json-schema";
import type { JsonObject, JsonRpcRequest, JsonValue } from "@testate/shared";
import {
  AGENT_TOOL_INPUTS,
  jsonObjectSchema,
  jsonRpcRequestSchema,
  jsonValueSchema,
} from "@testate/shared";
import * as v from "valibot";

export const MCP_PROTOCOL_VERSION = "2025-03-26";

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: JsonValue }
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      error: { code: number; message: string; data?: JsonValue };
    };

export type ToolRunner = (name: string, args: JsonObject) => Promise<JsonValue>;

export type AgentService = {
  handle(raw: JsonValue, runTool: ToolRunner): Promise<JsonRpcResponse | null>;
};

export const ERR_PARSE = -32700;
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
    description: `Testate read-only tool ${name}; see docs/api-specs/18-agent-mcp.md`,
    inputSchema: v.parse(jsonValueSchema, toJsonSchema(schema)),
  }));
}

async function callTool(
  id: string | number | null,
  params: JsonObject,
  runTool: ToolRunner
): Promise<JsonRpcResponse> {
  const name = v.safeParse(v.string(), params["name"]);
  const schema = name.success ? TOOLS.get(name.output) : undefined;
  if (!name.success || schema === undefined) return error(id, ERR_PARAMS, "unknown tool");
  const args = v.safeParse(schema, params["arguments"] ?? {});
  if (!args.success) {
    return error(id, ERR_PARAMS, "invalid params", {
      issues: args.issues.map((issue) => issue.message),
    });
  }
  try {
    const result = await runTool(name.output, v.parse(jsonObjectSchema, args.output));
    return {
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: JSON.stringify(result) }] },
    };
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: JSON.stringify({ code: "INTERNAL", message }) }],
        isError: true,
      },
    };
  }
}

/**
 * In-house JSON-RPC handler for the MCP subset: initialize, ping, tools/list, tools/call,
 * resources/list. Chosen over @hono/mcp, which peer-requires zod (04 §4.8).
 */
export function createAgentService(version: string): AgentService {
  return {
    async handle(raw, runTool) {
      const parsed = v.safeParse(jsonRpcRequestSchema, raw);
      if (!parsed.success) return error(null, ERR_INVALID_REQUEST, "invalid request");
      const request: JsonRpcRequest = parsed.output;
      if (request.id === undefined) return null;
      const id = request.id;
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
          return callTool(id, request.params ?? {}, runTool);
        case "resources/list":
          return { jsonrpc: "2.0", id, result: { resources: [] } };
        default:
          return error(id, ERR_METHOD, `unknown method ${request.method}`);
      }
    },
  };
}
