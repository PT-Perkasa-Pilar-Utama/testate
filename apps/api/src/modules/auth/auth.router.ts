import { Hono } from "hono";
import {
  apiTokenSchema,
  createTokenResponseSchema,
  loginResponseSchema,
  meSchema,
  sessionSchema,
} from "@testate/shared";
import * as v from "valibot";

import { requireCsrf, requireHuman, requireRole, requireUnscoped } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { AuthHandlers } from "./auth.handler.ts";

/**
 * Session routes take `requireHuman` and `requireCsrf`, not `requireRole`: they must stay
 * reachable while a password change is required (09 §9.2), a session-less caller gets 401 from
 * `currentActor`, and an agent token gets 403, since it reaches `/mcp` and nothing else.
 */
export function createAuthRouter(h: AuthHandlers): Hono {
  const router = new Hono();
  router.post("/auth/login", describe("auth", "Log in", loginResponseSchema), h.login);
  router.post(
    "/auth/logout",
    requireHuman(),
    requireCsrf(),
    describe("auth", "Log out", v.undefined(), 204),
    h.logout
  );
  router.get("/auth/me", requireHuman(), describe("auth", "Current actor", meSchema), h.me);
  router.post(
    "/auth/password",
    requireHuman(),
    requireCsrf(),
    describe("auth", "Change own password", v.undefined(), 204),
    h.changePassword
  );
  router.get(
    "/auth/sessions",
    requireHuman(),
    describe("auth", "Own sessions", v.array(sessionSchema)),
    h.sessions
  );
  router.delete(
    "/auth/sessions/:id",
    requireHuman(),
    requireCsrf(),
    describe("auth", "Revoke a session", v.undefined(), 204),
    h.revokeSession
  );

  router.use("/tokens", requireRole("admin"), requireUnscoped());
  router.use("/tokens/*", requireRole("admin"), requireUnscoped());
  router.get(
    "/tokens",
    describe("tokens", "List API tokens", v.array(apiTokenSchema)),
    h.listTokens
  );
  router.post(
    "/tokens",
    describe("tokens", "Create an API token", createTokenResponseSchema, 201),
    h.createToken
  );
  router.delete(
    "/tokens/:id",
    describe("tokens", "Revoke an API token", v.undefined(), 204),
    h.revokeToken
  );
  return router;
}
