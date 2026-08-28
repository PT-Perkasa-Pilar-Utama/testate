import { describe, expect, it } from "bun:test";
import { AGENT_TOOL_NAMES } from "@testate/shared";
import * as v from "valibot";

import { createAgentService } from "./agent.service.ts";
import type { JsonRpcResponse } from "./agent.service.ts";

const service = createAgentService("0.1.0");
const runTool = async (name: string): Promise<{ tool: string }> => ({ tool: name });

const toolListSchema = v.object({ tools: v.array(v.object({ name: v.string() })) });
const errorSchema = v.object({ error: v.object({ code: v.number() }) });
const resultSchema = v.object({ result: v.object({ protocolVersion: v.string() }) });

/** Narrows a response through a schema; a wrong form fails the parse, not a conditional. */
function reply<T>(schema: v.GenericSchema<T>, response: JsonRpcResponse | null): T {
  return v.parse(schema, response);
}

describe("agent MCP handler", () => {
  it("answers initialize with the protocol version", async () => {
    const response = await service.handle(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      runTool
    );
    expect(reply(resultSchema, response).result.protocolVersion).toBe("2025-03-26");
  });

  it("lists every tool with a JSON schema input", async () => {
    const response = await service.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }, runTool);
    const names = reply(v.object({ result: toolListSchema }), response).result.tools.map(
      (tool) => tool.name
    );
    expect(names).toStrictEqual([...AGENT_TOOL_NAMES]);
  });

  it("validates tool arguments and reports invalid params", async () => {
    const response = await service.handle(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "list_adapters", arguments: {} },
      },
      runTool
    );
    expect(reply(errorSchema, response).error.code).toBe(-32602);
  });

  it("runs a valid tool call through the runner", async () => {
    const response = await service.handle(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "list_projects", arguments: {} },
      },
      runTool
    );
    const content = reply(
      v.object({ result: v.object({ content: v.array(v.object({ text: v.string() })) }) }),
      response
    ).result.content;
    expect(content[0]?.text).toBe(JSON.stringify({ tool: "list_projects" }));
  });

  it("rejects unknown methods", async () => {
    const unknown = await service.handle(
      { jsonrpc: "2.0", id: 4, method: "prompts/list" },
      runTool
    );
    expect(reply(errorSchema, unknown).error.code).toBe(-32601);
  });

  it("ignores notifications", async () => {
    expect(
      await service.handle({ jsonrpc: "2.0", method: "notifications/initialized" }, runTool)
    ).toBeNull();
  });
});
