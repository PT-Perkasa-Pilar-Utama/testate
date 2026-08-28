import { jsonValueSchema } from "@testate/shared";
import * as v from "valibot";

import type { Handler } from "../../lib/http/index.ts";
import type { AgentService, ToolRunner } from "./agent.service.ts";
import { ERR_PARSE } from "./agent.service.ts";

export type AgentHandlers = { post: Handler; get: Handler };

export function createAgentHandlers(service: AgentService, runTool: ToolRunner): AgentHandlers {
  return {
    post: async (c) => {
      const raw = v.safeParse(jsonValueSchema, await c.req.json().catch(() => undefined));
      if (!raw.success) {
        return c.json(
          { jsonrpc: "2.0", id: null, error: { code: ERR_PARSE, message: "parse error" } },
          { status: 200 }
        );
      }
      c.get("event").add("op", { name: "mcp" });
      const response = await service.handle(raw.output, runTool);
      if (response === null) return c.body(null, 202);
      return c.json(response, { status: 200 });
    },
    get: async (c) => c.body(null, 405),
  };
}
