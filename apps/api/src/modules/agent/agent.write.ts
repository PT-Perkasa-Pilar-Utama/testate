import type { CreateStateInput, Job, JsonObject, JsonValue, Project } from "@testate/shared";
import * as v from "valibot";

import { forbidden } from "../../lib/http/index.ts";
import type { AgentToolDeps, Scope, Tool } from "./agent.catalog.ts";
import { cap, json, optional, text } from "./agent.catalog.ts";
import type { AgentContext } from "./agent.service.ts";

/** How long a tool waits on a job before it answers "still running" (23 §23.6). */
const JOB_WAIT_SECONDS = 15;

/**
 * Reading is every agent's; writing is a tester's.
 *
 * `/mcp` is the one route that does not pass through `requireRole`, because that middleware
 * refuses agent tokens by design. So the role check lives on the tool, and a viewer agent token
 * gets the same `403 role` a viewer session gets from the dashboard.
 */
function requireTester(ctx: AgentContext): void {
  if (ctx.actor.role === "viewer") throw forbidden("role");
}

/** Names or ids, whichever the agent had to hand; the caller's scope decides what resolves. */
function adapterIds(scope: Scope, project: Project, args: JsonObject): string[] | undefined {
  const refs = optional(args, "adapters", v.array(v.string()));
  return refs?.map((ref) => scope.adapter(project, ref).id);
}

/**
 * Waits out the short jobs and reports the long ones.
 *
 * A snapshot of a small sandbox finishes inside the wait and the agent reads its outcome from the
 * same call. A restore of something large does not, and the agent polls `get_job` rather than
 * holding an MCP request open for minutes.
 */
async function settle(deps: AgentToolDeps, ctx: AgentContext, job: Job): Promise<JsonValue> {
  const done = await deps.jobs.wait(ctx.scope, job.id, JOB_WAIT_SECONDS);
  return json({
    id: done.id,
    kind: done.kind,
    status: done.status,
    error: done.error === null ? null : done.error.message,
  });
}

/** The tester half of the catalog, named so the map it folds into keeps its keys. */
export type WriteTools = {
  run_write_query: Tool;
  end_write_session: Tool;
  take_snapshot: Tool;
  checkout_state: Tool;
  get_job: Tool;
};

/**
 * What a tester does that a reader does not: change rows, keep a state, put one back.
 *
 * Spec 23 called the MCP server read-only by construction, on the grounds that every agent token
 * was a viewer. An agent token now carries a role, so the construction moves down one level: these
 * tools exist, and the role on the token decides whether they answer.
 */
export function writeTools(deps: AgentToolDeps): WriteTools {
  return {
    run_write_query: async (args, ctx, scope) => {
      requireTester(ctx);
      const adapter = scope.adapter(scope.project(text(args, "project")), text(args, "adapter"));
      // The session is the safety net, not a formality: it stashes the adapter before the first
      // write, so there is something to go back to. Reused across calls, so one run leaves one
      // stash rather than one per statement.
      const session = await deps.data.openWriteSession(ctx.actor, adapter.id, ctx.meta);
      const result = await deps.data.query(ctx.actor, adapter.id, {
        dialect: "sql",
        text: text(args, "sql"),
        mode: "write",
        write_session_id: session.id,
        row_cap: cap(optional(args, "limit", v.number())),
        tag: "mcp",
      });
      return json({
        columns: result.columns,
        rows: result.rows,
        truncated: result.truncated,
        masked_columns: result.masked_columns,
        write_session_id: session.id,
      });
    },
    end_write_session: async (args, ctx, scope) => {
      requireTester(ctx);
      const adapter = scope.adapter(scope.project(text(args, "project")), text(args, "adapter"));
      const session = await deps.data.openWriteSession(ctx.actor, adapter.id, ctx.meta);
      await deps.data.endWriteSession(ctx.actor, session.id, ctx.meta);
      return json({ ended: session.id, stash_state_id: session.stash_state_id });
    },
    take_snapshot: async (args, ctx, scope) => {
      requireTester(ctx);
      const project = scope.project(text(args, "project"));
      const input: CreateStateInput = { name: text(args, "name") };
      const notes = optional(args, "notes", v.string());
      const ids = adapterIds(scope, project, args);
      if (notes !== undefined) input.notes = notes;
      if (ids !== undefined) input.adapter_ids = ids;
      const { state, job } = await deps.states.snapshot(ctx.actor, project.slug, input, ctx.meta);
      return json({
        state: { id: state.id, name: state.name, kind: state.kind },
        job: await settle(deps, ctx, job),
      });
    },
    checkout_state: async (args, ctx, scope) => {
      requireTester(ctx);
      const project = scope.project(text(args, "project"));
      // By id or by name, whichever the agent has; `get` resolves both and 404s on neither.
      const state = await deps.states.get(project.slug, text(args, "state"));
      const request: Parameters<typeof deps.checkouts.create>[2] = {
        state_id: state.id,
        force: optional(args, "force", v.boolean()) ?? false,
      };
      const ids = adapterIds(scope, project, args);
      if (ids !== undefined) request.adapter_ids = ids;
      const { checkout, job } = await deps.checkouts.create(
        ctx.actor,
        project.slug,
        request,
        ctx.meta
      );
      return json({
        checkout: { id: checkout.id, state: state.name },
        job: await settle(deps, ctx, job),
      });
    },
    get_job: async (args, ctx) => {
      const job = await deps.jobs.get(ctx.scope, text(args, "job"));
      return json({
        id: job.id,
        kind: job.kind,
        status: job.status,
        progress: job.progress,
        error: job.error === null ? null : job.error.message,
      });
    },
  };
}
