import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Settings } from "@testate/shared";
import {
  changePasswordSchema,
  createTokenSchema,
  loginSchema,
  tokenKindSchema,
} from "@testate/shared";
import * as v from "valibot";
import { nextCursor } from "../../lib/db/keyset.ts";

import { currentActor, requestMeta, sessionCookieName } from "../../lib/http/auth.ts";
import { createRateLimiter } from "../../lib/http/ratelimit.ts";
import {
  AppError,
  ok,
  okPage,
  param,
  parseBody,
  parseQuery,
  rateLimited,
} from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { TokensListQuery } from "./auth.repository.ts";
import type { AuthService, CreateTokenInput } from "./auth.service.ts";

export type AuthHandlers = {
  login: Handler;
  logout: Handler;
  me: Handler;
  changePassword: Handler;
  sessions: Handler;
  revokeSession: Handler;
  listTokens: Handler;
  createToken: Handler;
  revokeToken: Handler;
};

export type AuthHandlerOptions = {
  env: string;
  basePath: string;
  secureCookies: boolean;
  trustProxy: boolean;
  now: () => Date;
  settings: { get(): Promise<Settings> };
};

const tokensQuery = v.object({
  kind: v.optional(v.array(tokenKindSchema)),
  sort: v.optional(v.array(v.picklist(["name", "created_at", "last_used_at", "expires_at"]))),
  order: v.optional(v.array(v.picklist(["asc", "desc"]))),
  q: v.optional(v.array(v.string())),
  revoked: v.optional(v.array(v.picklist(["true", "false"]))),
  limit: v.optional(
    v.array(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(200)))
  ),
  cursor: v.optional(v.array(v.string())),
});

/** The narrowing half: what a caller filters the list down to. */
function applyTokenFilter(query: TokensListQuery, parsed: v.InferOutput<typeof tokensQuery>): void {
  const kind = parsed.kind?.[0];
  if (kind !== undefined) query.kind = kind;
  const revoked = parsed.revoked?.[0];
  if (revoked !== undefined) query.revoked = revoked === "true";
  const q = parsed.q?.[0];
  if (q !== undefined) query.q = q;
}

function toTokensQuery(parsed: v.InferOutput<typeof tokensQuery>): TokensListQuery {
  const query: TokensListQuery = {
    sort: parsed.sort?.[0] ?? "created_at",
    order: parsed.order?.[0] ?? "desc",
    limit: parsed.limit?.[0] ?? 50,
  };
  applyTokenFilter(query, parsed);
  const cursor = parsed.cursor?.[0];
  if (cursor !== undefined) query.cursor = cursor;
  return query;
}

/** Drops undefined optional fields so the service input matches exactOptionalPropertyTypes. */
function toCreateTokenInput(parsed: v.InferOutput<typeof createTokenSchema>): CreateTokenInput {
  const input: CreateTokenInput = {
    name: parsed.name,
    kind: parsed.kind,
    project_ids: parsed.project_ids,
  };
  if (parsed.role !== undefined) input.role = parsed.role;
  if (parsed.expires_at !== undefined) input.expires_at = parsed.expires_at;
  return input;
}

/**
 * Failed logins per client address (07 §7.5).
 *
 * The per-account lockout beside this one stops five guesses at one account; it does nothing about
 * one guess at each of a thousand accounts, and an attacker can use it to lock a real person out.
 * This counts guesses per address instead, so the two cover each other.
 *
 * Only failures spend budget. A login that works costs nothing, which is why the limit can be
 * tight without touching anyone who simply signs in often.
 */
export function createAuthHandlers(
  service: AuthService,
  options: AuthHandlerOptions
): AuthHandlers {
  const cookiePath = options.basePath === "/" ? "/" : options.basePath;
  const cookieName = sessionCookieName(options.secureCookies, options.basePath);
  const meta = (c: Parameters<Handler>[0]): ReturnType<typeof requestMeta> =>
    requestMeta(c, options.trustProxy);
  const guesses = createRateLimiter(options.now);
  return {
    login: async (c) => {
      const input = await parseBody(c, loginSchema);
      const from = meta(c);
      // An address with no name is still one bucket: better to share a budget than to hand out an
      // unlimited one whenever the socket address cannot be read.
      const key = from.ip ?? "unknown";
      const wait = guesses.over(
        key,
        (await options.settings.get()).limits.failed_logins_per_minute
      );
      if (wait !== null) {
        c.get("event").add("op", { login_rate_limited: true });
        throw rateLimited(wait);
      }
      const { sessionToken, response } = await service
        .login(input, from)
        .catch((cause: unknown) => {
          // A guess counts once. A wrong password, an unknown name and a disabled account look
          // identical to the caller by design and all three are guessing, so all three spend
          // budget. A refusal that is itself a rate limit does not: that account is already
          // locked, and charging the address for hearing so again locks a locked-out person out
          // twice over. The event carries the fact; an audit row per attempt would let an attacker
          // fill the disk, and the per-account path already audits itself.
          const alreadyLimited = cause instanceof AppError && cause.code === "RATE_LIMITED";
          if (!alreadyLimited) guesses.record(key);
          c.get("event").add("op", { login_failed: true, login_already_limited: alreadyLimited });
          throw cause;
        });
      setCookie(c, cookieName, sessionToken, {
        httpOnly: true,
        sameSite: "Strict",
        secure: options.secureCookies,
        path: cookiePath,
        maxAge: 7 * 24 * 60 * 60,
      });
      c.get("event").add("actor", {
        user_id: response.user.id,
        role: response.user.role,
        auth: "session",
      });
      return ok(c, response);
    },
    logout: async (c) => {
      const token = getCookie(c, cookieName);
      if (token !== undefined) await service.logout(token, c.get("actor"), meta(c));
      deleteCookie(c, cookieName, { path: cookiePath });
      return c.body(null, 204);
    },
    me: async (c) =>
      ok(
        c,
        service.me(
          {
            actor: currentActor(c),
            mustChangePassword: c.get("passwordChangeRequired"),
            projectScope: c.get("projectScope"),
          },
          options.env
        )
      ),
    changePassword: async (c) => {
      const input = await parseBody(c, changePasswordSchema);
      await service.changePassword(
        currentActor(c),
        input.current,
        input.next,
        getCookie(c, cookieName),
        meta(c)
      );
      return c.body(null, 204);
    },
    sessions: async (c) =>
      okPage(c, await service.sessions(currentActor(c), getCookie(c, cookieName)), null, 50),
    revokeSession: async (c) => {
      await service.revokeSession(currentActor(c), param(c, "id"));
      return c.body(null, 204);
    },
    listTokens: async (c) => {
      const query = toTokensQuery(parseQuery(c, tokensQuery));
      const rows = await service.listTokens(query);
      const limit = query.limit ?? 50;
      const next = nextCursor(rows, limit, query, (row) => [row[query.sort], row.id]);
      return okPage(c, rows, next, limit, await service.totalTokens(query));
    },
    createToken: async (c) => {
      const input = toCreateTokenInput(await parseBody(c, createTokenSchema));
      return ok(c, await service.createToken(currentActor(c), input, meta(c)), 201);
    },
    revokeToken: async (c) => {
      await service.revokeToken(currentActor(c), param(c, "id"), meta(c));
      return c.body(null, 204);
    },
  };
}
