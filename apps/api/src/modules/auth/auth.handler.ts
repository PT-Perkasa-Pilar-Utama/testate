import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  changePasswordSchema,
  createTokenSchema,
  loginSchema,
  tokenKindSchema,
} from "@testate/shared";
import * as v from "valibot";
import { nextCursor } from "../../lib/db/keyset.ts";

import { SESSION_COOKIE, currentActor, requestMeta } from "../../lib/http/auth.ts";
import { ok, okPage, param, parseBody, parseQuery } from "../../lib/http/index.ts";
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
};

const tokensQuery = v.object({
  kind: v.optional(v.array(tokenKindSchema)),
  revoked: v.optional(v.array(v.picklist(["true", "false"]))),
  limit: v.optional(
    v.array(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(200)))
  ),
  cursor: v.optional(v.array(v.string())),
});

function toTokensQuery(parsed: v.InferOutput<typeof tokensQuery>): TokensListQuery {
  const query: TokensListQuery = {};
  const kind = parsed.kind?.[0];
  if (kind !== undefined) query.kind = kind;
  const revoked = parsed.revoked?.[0];
  if (revoked !== undefined) query.revoked = revoked === "true";
  query.limit = parsed.limit?.[0] ?? 50;
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

export function createAuthHandlers(
  service: AuthService,
  options: AuthHandlerOptions
): AuthHandlers {
  const cookiePath = options.basePath === "/" ? "/" : options.basePath;
  const meta = (c: Parameters<Handler>[0]): ReturnType<typeof requestMeta> =>
    requestMeta(c, options.trustProxy);
  return {
    login: async (c) => {
      const input = await parseBody(c, loginSchema);
      const { sessionToken, response } = await service.login(input, meta(c));
      setCookie(c, SESSION_COOKIE, sessionToken, {
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
      const token = getCookie(c, SESSION_COOKIE);
      if (token !== undefined) await service.logout(token, c.get("actor"), meta(c));
      deleteCookie(c, SESSION_COOKIE, { path: cookiePath });
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
        getCookie(c, SESSION_COOKIE),
        meta(c)
      );
      return c.body(null, 204);
    },
    sessions: async (c) =>
      okPage(c, await service.sessions(currentActor(c), getCookie(c, SESSION_COOKIE)), null, 50),
    revokeSession: async (c) => {
      await service.revokeSession(currentActor(c), param(c, "id"));
      return c.body(null, 204);
    },
    listTokens: async (c) => {
      const query = toTokensQuery(parseQuery(c, tokensQuery));
      const rows = await service.listTokens(query);
      const limit = query.limit ?? 50;
      return okPage(
        c,
        rows,
        nextCursor(rows, limit, (row) => [row.created_at, row.id]),
        limit
      );
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
