/**
 * The MCP endpoint's handlers: the service, the tools over every module they read, and the rate
 * limits. Composition only, kept out of index.ts so the root stays under its line count.
 */
import { createAgentHandlers } from "./modules/agent/agent.handler.ts";
import type { AgentHandlers } from "./modules/agent/agent.handler.ts";
import { createAgentService } from "./modules/agent/agent.service.ts";
import { createAgentTools } from "./modules/agent/agent.tools.ts";
import type { AgentToolDeps } from "./modules/agent/agent.catalog.ts";
import { VERSION } from "./version.ts";

export function agentHandlers(
  tools: AgentToolDeps,
  deps: Parameters<typeof createAgentHandlers>[2]
): AgentHandlers {
  return createAgentHandlers(createAgentService(VERSION), createAgentTools(tools), deps);
}
