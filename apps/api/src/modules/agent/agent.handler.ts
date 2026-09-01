import type { Settings } from "@testate/shared";
import { jsonValueSchema } from "@testate/shared";
import * as v from "valibot";

import { currentActor, requestMeta } from "../../lib/http/auth.ts";
import { createRateLimiter } from "../../lib/http/ratelimit.ts";
import type { Handler } from "../../lib/http/index.ts";
import { agentGuide } from "./agent.guide.ts";
import type { AgentContext, AgentRuntime, AgentService } from "./agent.service.ts";
import { ERR_PARSE, ERR_RATE_LIMITED } from "./agent.service.ts";

export type AgentHandlers = { post: Handler; get: Handler; guide: Handler };

export type AgentHandlerDeps = {
  settings: { get(): Promise<Settings> };
  trustProxy: boolean;
  now: () => Date;
};

const methodOf = v.object({
  method: v.optional(v.string()),
  params: v.optional(v.object({ name: v.optional(v.string()) })),
});

/** Sliding one-minute window per token (18 §18.1); `createRateLimiter` sweeps idle keys itself. */

export function createAgentHandlers(
  service: AgentService,
  runtime: AgentRuntime,
  deps: AgentHandlerDeps
): AgentHandlers {
  const limiter = createRateLimiter(deps.now);
  return {
    post: async (c) => {
      const raw = v.safeParse(jsonValueSchema, await c.req.json().catch(() => undefined));
      if (!raw.success) {
        return c.json(
          { jsonrpc: "2.0", id: null, error: { code: ERR_PARSE, message: "parse error" } },
          { status: 200 }
        );
      }
      const actor = currentActor(c);
      const ctx: AgentContext = {
        actor,
        scope: c.get("projectScope"),
        meta: requestMeta(c, deps.trustProxy),
      };
      const envelope = v.safeParse(methodOf, raw.output);
      const tool = envelope.success ? envelope.output.params?.name : undefined;
      c.get("event").add("op", {
        name:
          tool === undefined
            ? `mcp:${envelope.success ? (envelope.output.method ?? "?") : "?"}`
            : `mcp:${tool}`,
      });
      const retryAfter = limiter.hit(
        actor.id,
        (await deps.settings.get()).limits.agent_requests_per_minute
      );
      if (retryAfter !== null) {
        c.header("Retry-After", String(retryAfter));
        return c.json(
          {
            jsonrpc: "2.0",
            id: null,
            error: {
              code: ERR_RATE_LIMITED,
              message: "rate limited",
              data: { retry_after: retryAfter },
            },
          },
          { status: 429 }
        );
      }
      const response = await service.handle(raw.output, runtime, ctx);
      if (response === null) return c.body(null, 202);
      return c.json(response, { status: 200 });
    },
    get: async (c) => c.body(null, 405),
    guide: async (c) =>
      // No token on this route, so it shows the reader's guide; a tester sees its own
      // through `help` once it connects.
      c.text(agentGuide("viewer"), 200, { "content-type": "text/markdown; charset=utf-8" }),
  };
}
