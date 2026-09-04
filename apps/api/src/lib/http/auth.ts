import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "hono/bun";
import { getCookie } from "hono/cookie";
import type { Actor, Role } from "@testate/shared";

import { forbidden, unauthorized } from "./errors.ts";

export const SESSION_COOKIE = "testate_session";

/**
 * `__Host-` when the browser can hold it to that: a secure cookie set from the root path with no
 * domain, which no subdomain and no other path can overwrite. A sub-path deploy sets the cookie
 * on that path, which the prefix forbids, and a plain-HTTP dev instance cannot mark it secure.
 */
export function sessionCookieName(secure: boolean, basePath: string): string {
  return secure && basePath === "/" ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;
}
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

export type RequestMeta = {
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  /** `Idempotency-Key` header on job-creating POSTs (09 §9.3). */
  idempotency_key?: string;
};

async function resolve(
  c: Context,
  resolver: ActorResolver,
  cookieName: string
): Promise<Resolved | null> {
  const bearer = c.req.header("authorization");
  if (bearer !== undefined) {
    return bearer.startsWith("Bearer ") ? resolver.fromBearer(bearer.slice(7)) : null;
  }
  const cookie = getCookie(c, cookieName);
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
export function authenticate(
  resolver: ActorResolver,
  cookieName: string = SESSION_COOKIE
): MiddlewareHandler {
  return async (c, next) => {
    const viaBearer = c.req.header("authorization") !== undefined;
    const resolved = await resolve(c, resolver, cookieName);
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

/**
 * Instance administration needs a credential that is not fenced to a project.
 *
 * A project-scoped token is a project credential: 09 §9.4 promises it cannot list or touch another
 * project, and 07 §7.1 counts that scope as the containment a leaked CI token relies on. Users,
 * tokens and settings are not project resources, and two of them are a way straight out of the
 * fence: a scoped token could mint an unscoped one, or create a user and sign in as them. Either
 * makes the scope decorative, so the fence holds here too.
 */
export function requireUnscoped(): MiddlewareHandler {
  return async (c, next) => {
    currentActor(c);
    if (c.get("projectScope") !== null) throw forbidden("token_is_project_scoped");
    await next();
  };
}

/**
 * The API reference describes every route this instance serves, so it asks who is reading.
 *
 * It touches no data, which is why it was open. What it does do is hand a stranger the shape of
 * the whole surface: every path, every parameter, every error, on a box they can reach. Any signed
 * in role may read it, because knowing the API is not a privilege here; an agent token may not,
 * for the same reason it reaches nothing but `/mcp`.
 *
 * A browser gets sent to the sign-in screen rather than a JSON refusal it cannot act on. A client
 * asking for JSON gets the refusal.
 */
export function requireReader(basePath: string): MiddlewareHandler {
  const loginPath = basePath === "/" ? "/login" : `${basePath}/login`;
  return async (c, next) => {
    const actor = c.get("actor");
    const wantsHtml = (c.req.header("accept") ?? "").includes("text/html");
    if (actor === null) {
      if (!wantsHtml) throw unauthorized();
      const next = encodeURIComponent(new URL(c.req.url).pathname);
      return c.redirect(`${loginPath}?next=${next}`, 302);
    }
    if (actor.agent) throw forbidden("agent_token_restricted");
    await next();
    return undefined;
  };
}

/**
 * A session route is a person's: it must stay reachable while a password change is required, so
 * it takes no role, but an agent token has no business on it either (07 §7.1: `/mcp` only).
 */
export function requireHuman(): MiddlewareHandler {
  return async (c, next) => {
    if (currentActor(c).agent) throw forbidden("agent_token_restricted");
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
  const meta: RequestMeta = {
    ip: forwarded === undefined || forwarded === "" ? remoteAddress(c) : forwarded,
    user_agent: c.req.header("user-agent") ?? null,
    request_id: c.get("requestId") ?? null,
  };
  const key = c.req.header("idempotency-key");
  if (key !== undefined) meta.idempotency_key = key;
  return meta;
}
