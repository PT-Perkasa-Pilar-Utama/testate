import { Hono } from "hono";
import * as v from "valibot";

import { requireAgentToken } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { AgentHandlers } from "./agent.handler.ts";

export function createAgentRouter(h: AgentHandlers): Hono {
  const router = new Hono();
  router.post(
    "/mcp",
    requireAgentToken(),
    describe("agent", "MCP JSON-RPC endpoint (agent tokens only)", v.unknown()),
    h.post
  );
  router.get(
    "/mcp",
    requireAgentToken(),
    describe("agent", "MCP event stream (not implemented)", v.unknown()),
    h.get
  );
  return router;
}
