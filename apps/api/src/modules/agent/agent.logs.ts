/**
 * `read_logs`: one source of a Logs adapter for an agent (#69; docs/decisions/2026-10-10-logs-
 * tier.md, Q9). The same read as the viewer's, so an agent and a person see the same entries; an
 * agent is always masked (Q5), which `masksApply` decides from the actor.
 */
import { AGENT_TOOL_INPUTS, LOG_LINE_DEFAULT } from "@testate/shared";
import type { LogsQuery } from "@testate/shared";
import * as v from "valibot";

import type { LogsService } from "../logs/logs.service.ts";
import { json } from "./agent.catalog.ts";
import type { Tool } from "./agent.catalog.ts";

export type LogTools = { read_logs: Tool };

export function logTools(deps: { logs: LogsService }): LogTools {
  return {
    read_logs: async (args, ctx, scope) => {
      const input = v.parse(AGENT_TOOL_INPUTS.read_logs, args);
      const project = scope.project(input.project);
      const adapter = scope.adapter(project, input.adapter);
      const { project: _project, adapter: _adapter, ...rest } = input;
      const query: LogsQuery = { ...rest, limit: input.limit ?? LOG_LINE_DEFAULT };
      const { page } = await deps.logs.read(ctx.actor, project.slug, adapter.id, query, ctx.scope);
      return json(page);
    },
  };
}
