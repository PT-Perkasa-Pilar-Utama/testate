import { Hono } from "hono";
import * as v from "valibot";

import { requireAgentToken, requireRole } from "../../lib/http/auth.ts";
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
  // The same guide the `help` tool and the `testate://guide` resource serve, for whoever is
  // wiring the agent up. `requireRole` rather than `requireAgentToken`: an agent already has two
  // doors to it over MCP, and this one is for the person building the integration.
  router.get(
    "/agent/guide",
    requireRole("viewer"),
    describe("agent", "How an agent should use Testate, as Markdown", v.string()),
    h.guide
  );
  return router;
}
