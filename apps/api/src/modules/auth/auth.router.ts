import { Hono } from "hono";
import {
  apiTokenSchema,
  createTokenResponseSchema,
  loginResponseSchema,
  meSchema,
  sessionSchema,
} from "@testate/shared";
import * as v from "valibot";

import { requireRole } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { AuthHandlers } from "./auth.handler.ts";

export function createAuthRouter(h: AuthHandlers): Hono {
  const router = new Hono();
  router.post("/auth/login", describe("auth", "Log in", loginResponseSchema), h.login);
  router.post("/auth/logout", describe("auth", "Log out", v.undefined(), 204), h.logout);
  router.get("/auth/me", describe("auth", "Current actor", meSchema), h.me);
  router.post(
    "/auth/password",
    describe("auth", "Change own password", v.undefined(), 204),
    h.changePassword
  );
  router.get(
    "/auth/sessions",
    describe("auth", "Own sessions", v.array(sessionSchema)),
    h.sessions
  );
  router.delete(
    "/auth/sessions/:id",
    describe("auth", "Revoke a session", v.undefined(), 204),
    h.revokeSession
  );

  router.use("/tokens", requireRole("admin"));
  router.use("/tokens/*", requireRole("admin"));
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
