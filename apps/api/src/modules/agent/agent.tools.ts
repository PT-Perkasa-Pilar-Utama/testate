import type { JsonObject, Project } from "@testate/shared";

import { AppError, notFound } from "../../lib/http/index.ts";
import { sha256 } from "../../lib/password/index.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import type { AgentToolDeps, Scope } from "./agent.catalog.ts";
import { json, tools } from "./agent.catalog.ts";
import type { AgentContext, AgentRuntime, Resource } from "./agent.service.ts";

export type { AgentToolDeps } from "./agent.catalog.ts";
export { AGENT_CAPS } from "./agent.catalog.ts";

/** What one call resolved, so its audit row names the project and adapter. */
type Seen = { project?: Project; adapter?: AdapterRecord };

type AuditEntry = Parameters<AgentToolDeps["audit"]["record"]>[0];

/** Maps MCP tool names to the read paths of the modules; every call is scoped and audited (23 §23.1). */
export function createAgentTools(deps: AgentToolDeps): AgentRuntime {
  const registry = tools(deps);
  const scopeFor = (ctx: AgentContext, seen: Seen): Scope => ({
    project(slug) {
      const project = deps.projectsRepo.bySlug(slug);
      if (project === null || (ctx.scope !== null && !ctx.scope.includes(project.id)))
        throw notFound("project");
      seen.project = project;
      return project;
    },
    adapter(project, ref) {
      const adapter = deps.adaptersRepo
        .list(project.id, {})
        .find((item) => item.id === ref || item.name === ref);
      if (adapter === undefined) throw notFound("adapter");
      seen.adapter = adapter;
      return adapter;
    },
  });
  const record = (
    ctx: AgentContext,
    name: string,
    args: JsonObject,
    seen: Seen,
    outcome: "succeeded" | "failed"
  ): void => {
    const entry: AuditEntry = {
      actor: ctx.actor,
      action: "agent.tool_call",
      target_type: "tool",
      target_id: name,
      details: { tool: name, arguments_hash: sha256(JSON.stringify(args)) },
      outcome,
      meta: ctx.meta,
    };
    if (seen.project !== undefined)
      entry.project = { id: seen.project.id, slug: seen.project.slug };
    if (seen.adapter !== undefined)
      entry.adapter = { id: seen.adapter.id, name: seen.adapter.name };
    deps.audit.record(entry);
  };
  return {
    async runTool(name, args, ctx) {
      const tool = registry.get(name);
      if (tool === undefined) throw new AppError("NOT_FOUND", `unknown tool ${name}`);
      const seen: Seen = {};
      try {
        const result = await tool(args, ctx, scopeFor(ctx, seen));
        record(ctx, name, args, seen, "succeeded");
        return result;
      } catch (cause: unknown) {
        record(ctx, name, args, seen, "failed");
        throw cause;
      }
    },
    async listResources(ctx) {
      const resources: Resource[] = [];
      for (const project of await deps.projects.list(ctx.scope, {
        limit: 200,
        sort: "name",
        order: "asc",
      })) {
        resources.push({
          uri: `testate://projects/${project.slug}/states`,
          name: `${project.slug} states`,
          mimeType: "application/json",
        });
        for (const adapter of deps.adaptersRepo.list(project.id, {})) {
          if (adapter.kind !== "database") continue;
          resources.push({
            uri: `testate://projects/${project.slug}/adapters/${adapter.id}/schema`,
            name: `${project.slug}/${adapter.name} schema`,
            mimeType: "application/json",
          });
        }
      }
      return resources;
    },
    async readResource(uri, ctx) {
      const match = /^testate:\/\/projects\/([^/]+)\/(states|adapters\/([^/]+)\/schema)$/.exec(uri);
      if (match === null) throw notFound("resource");
      const seen: Seen = {};
      const scope = scopeFor(ctx, seen);
      const project = scope.project(match[1] ?? "");
      if (match[2] === "states")
        return json(
          await deps.states.list(project.slug, {
            limit: 200,
            sort: "created_at",
            order: "desc",
            includeStash: false,
          })
        );
      return json(await deps.data.schema(scope.adapter(project, match[3] ?? "").id));
    },
  };
}
