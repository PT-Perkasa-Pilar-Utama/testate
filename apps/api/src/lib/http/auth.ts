import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { Actor, Role } from "@testate/shared";

import { forbidden, unauthorized } from "./errors.ts";

export const SESSION_COOKIE = "testate_session";
export const CSRF_HEADER = "x-testate-request";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const RANK = { viewer: 0, qa: 1, admin: 2 } as const satisfies Record<Role, number>;

/** Resolves a credential to an actor. The auth module provides the implementation. */
export type ActorResolver = {
  fromSession(cookieValue: string): Promise<Actor | null>;
  fromBearer(token: string): Promise<Actor | null>;
};

/** Sets `actor` on the context from the cookie session or the bearer token; never rejects here. */
export function authenticate(resolver: ActorResolver): MiddlewareHandler {
  return async (c, next) => {
    const bearer = c.req.header("authorization");
    const cookie = getCookie(c, SESSION_COOKIE);
    let actor: Actor | null = null;
    if (bearer?.startsWith("Bearer ")) actor = await resolver.fromBearer(bearer.slice(7));
    else if (cookie !== undefined) actor = await resolver.fromSession(cookie);
    c.set("actor", actor);
    c.set("authKind", bearer === undefined ? "session" : "bearer");
    if (actor !== null) {
      c.get("event").add("actor", {
        user_id: actor.kind === "user" ? actor.id : null,
        token_id: actor.kind === "token" ? actor.id : null,
        role: actor.role,
        auth: bearer === undefined ? "session" : "token",
        agent: actor.agent,
      });
    }
    await next();
  };
}

/** The actor for a route that requires one; throws UNAUTHORIZED otherwise. */
export function currentActor(c: Context): Actor {
  const actor = c.get("actor");
  if (actor === null) throw unauthorized();
  return actor;
}

/** Cumulative role check, agent-token restriction, and the CSRF header on cookie mutations. */
export function requireRole(minimum: Role): MiddlewareHandler {
  return async (c, next) => {
    const actor = currentActor(c);
    if (actor.agent) throw forbidden("agent_token_restricted");
    if (RANK[actor.role] < RANK[minimum]) throw forbidden("role");
    const viaCookie = c.get("authKind") === "session";
    if (viaCookie && MUTATING.has(c.req.method) && c.req.header(CSRF_HEADER) !== "1") {
      throw forbidden("csrf");
    }
    await next();
  };
}

/** The MCP endpoint accepts agent tokens only. */
export function requireAgentToken(): MiddlewareHandler {
  return async (c, next) => {
    const actor = currentActor(c);
    if (!actor.agent) throw forbidden("agent_token_required");
    await next();
  };
}
