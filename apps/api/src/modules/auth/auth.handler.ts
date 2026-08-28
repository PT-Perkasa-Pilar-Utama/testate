import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { changePasswordSchema, createTokenSchema, loginSchema } from "@testate/shared";

import { SESSION_COOKIE, currentActor } from "../../lib/http/auth.ts";
import { ok, okPage, param, parseBody } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { AuthService } from "./auth.service.ts";

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

export type AuthHandlerOptions = { env: string; basePath: string; secureCookies: boolean };

export function createAuthHandlers(
  service: AuthService,
  options: AuthHandlerOptions
): AuthHandlers {
  const cookiePath = options.basePath === "/" ? "/" : options.basePath;
  return {
    login: async (c) => {
      const input = await parseBody(c, loginSchema);
      const { sessionToken, response } = await service.login(input);
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
      if (token !== undefined) await service.logout(token);
      deleteCookie(c, SESSION_COOKIE, { path: cookiePath });
      return c.body(null, 204);
    },
    me: async (c) => ok(c, service.me(currentActor(c), options.env)),
    changePassword: async (c) => {
      const input = await parseBody(c, changePasswordSchema);
      await service.changePassword(currentActor(c), input.current, input.next);
      return c.body(null, 204);
    },
    sessions: async (c) => okPage(c, await service.sessions(currentActor(c)), null, 50),
    revokeSession: async (c) => {
      await service.revokeSession(currentActor(c), param(c, "id"));
      return c.body(null, 204);
    },
    listTokens: async (c) => okPage(c, await service.listTokens(), null, 50),
    createToken: async (c) => {
      await parseBody(c, createTokenSchema);
      return ok(c, await service.createToken(), 201);
    },
    revokeToken: async (c) => {
      await service.revokeToken(param(c, "id"));
      return c.body(null, 204);
    },
  };
}
