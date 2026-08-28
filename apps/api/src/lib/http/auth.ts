import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "hono/bun";
import { getCookie } from "hono/cookie";
import type { Actor, Role } from "@testate/shared";

import { forbidden, unauthorized } from "./errors.ts";

export const SESSION_COOKIE = "testate_session";
export const CSRF_HEADER = "x-testate-request";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const RANK = { viewer: 0, qa: 1, admin: 2 } as const satisfies Record<Role, number>;

/** What a credential resolves to: the actor plus the two flags the middleware gates on. */
export type Resolved = {
  actor: Actor;
  mustChangePassword: boolean;
  projectScope: string[] | null;
};

/** Resolves a credential to an actor. The auth module provides the implementation. */
export type ActorResolver = {
  fromSession(cookieValue: string): Promise<Resolved | null>;
  fromBearer(token: string): Promise<Resolved | null>;
};

export type RequestMeta = { ip: string | null; user_agent: string | null };

async function resolve(c: Context, resolver: ActorResolver): Promise<Resolved | null> {
  const bearer = c.req.header("authorization");
  if (bearer !== undefined) {
    return bearer.startsWith("Bearer ") ? resolver.fromBearer(bearer.slice(7)) : null;
  }
  const cookie = getCookie(c, SESSION_COOKIE);
  return cookie === undefined ? null : resolver.fromSession(cookie);
}

function recordActor(c: Context, actor: Actor, viaBearer: boolean): void {
  c.get("event").add("actor", {
    user_id: actor.kind === "user" ? actor.id : null,
    token_id: actor.kind === "token" ? actor.id : null,
    role: actor.role,
    auth: viaBearer ? "token" : "session",
    agent: actor.agent,
  });
}

/** Sets `actor` on the context from the cookie session or the bearer token; never rejects here. */
export function authenticate(resolver: ActorResolver): MiddlewareHandler {
  return async (c, next) => {
    const viaBearer = c.req.header("authorization") !== undefined;
    const resolved = await resolve(c, resolver);
    c.set("actor", resolved?.actor ?? null);
    c.set("authKind", viaBearer ? "bearer" : "session");
    c.set("passwordChangeRequired", resolved?.mustChangePassword ?? false);
    c.set("projectScope", resolved?.projectScope ?? null);
    if (resolved !== null) recordActor(c, resolved.actor, viaBearer);
    await next();
  };
}

/** The actor for a route that requires one; throws UNAUTHORIZED otherwise. */
export function currentActor(c: Context): Actor {
  const actor = c.get("actor");
  if (actor === null) throw unauthorized();
  return actor;
}

function assertCsrf(c: Context): void {
  const viaCookie = c.get("authKind") === "session";
  if (viaCookie && MUTATING.has(c.req.method) && c.req.header(CSRF_HEADER) !== "1") {
    throw forbidden("csrf");
  }
}

/** Cookie sessions send `X-Testate-Request: 1` on every mutation; bearer requests are exempt. */
export function requireCsrf(): MiddlewareHandler {
  return async (c, next) => {
    currentActor(c);
    assertCsrf(c);
    await next();
  };
}

/**
 * Cumulative role check, agent-token restriction, the forced-password-change gate (09 §9.2),
 * and the CSRF header on cookie mutations.
 */
export function requireRole(minimum: Role): MiddlewareHandler {
  return async (c, next) => {
    const actor = currentActor(c);
    if (actor.agent) throw forbidden("agent_token_restricted");
    if (c.get("passwordChangeRequired")) throw forbidden("password_change_required");
    if (RANK[actor.role] < RANK[minimum]) throw forbidden("role");
    assertCsrf(c);
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

function remoteAddress(c: Context): string | null {
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    return null;
  }
}

/** Client address and agent for audit rows; `X-Forwarded-For` counts only behind a trusted proxy. */
export function requestMeta(c: Context, trustProxy: boolean): RequestMeta {
  const forwarded = trustProxy ? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
  return {
    ip: forwarded === undefined || forwarded === "" ? remoteAddress(c) : forwarded,
    user_agent: c.req.header("user-agent") ?? null,
  };
}
