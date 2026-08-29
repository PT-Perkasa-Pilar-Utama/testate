import { describe, expect, it } from "bun:test";
import { AGENT_TOOL_NAMES } from "@testate/shared";
import * as v from "valibot";

import { createAgentService } from "./agent.service.ts";
import type { AgentContext, AgentRuntime, JsonRpcResponse } from "./agent.service.ts";

const service = createAgentService("0.1.0");
const CTX: AgentContext = {
  actor: { kind: "token", id: "t1", label: "token:agent", role: "viewer", agent: true },
  scope: null,
  meta: { ip: "", user_agent: "test", request_id: null },
};
const runtime: AgentRuntime = {
  runTool: async (name) => ({ tool: name }),
  listResources: async () => [
    { uri: "testate://projects/shop/states", name: "shop states", mimeType: "application/json" },
  ],
  readResource: async (uri) => ({ uri }),
};

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
      runtime,
      CTX
    );
    expect(reply(resultSchema, response).result.protocolVersion).toBe("2025-03-26");
  });

  it("lists every tool with a JSON schema input", async () => {
    const response = await service.handle(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      runtime,
      CTX
    );
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
      runtime,
      CTX
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
      runtime,
      CTX
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
      runtime,
      CTX
    );
    expect(reply(errorSchema, unknown).error.code).toBe(-32601);
  });

  it("lists and reads resources through the runtime", async () => {
    const listed = await service.handle(
      { jsonrpc: "2.0", id: 6, method: "resources/list" },
      runtime,
      CTX
    );
    expect(
      reply(
        v.object({ result: v.object({ resources: v.array(v.object({ uri: v.string() })) }) }),
        listed
      ).result.resources[0]?.uri
    ).toBe("testate://projects/shop/states");
    const read = await service.handle(
      {
        jsonrpc: "2.0",
        id: 7,
        method: "resources/read",
        params: { uri: "testate://projects/shop/states" },
      },
      runtime,
      CTX
    );
    expect(
      reply(
        v.object({ result: v.object({ contents: v.array(v.object({ text: v.string() })) }) }),
        read
      ).result.contents[0]?.text
    ).toBe('{"uri":"testate://projects/shop/states"}');
  });

  it("ignores notifications", async () => {
    expect(
      await service.handle({ jsonrpc: "2.0", method: "notifications/initialized" }, runtime, CTX)
    ).toBeNull();
  });
});
