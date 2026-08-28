import { Hono } from "hono";
import { healthPublicSchema } from "@testate/shared";
import * as v from "valibot";

import { requireRole } from "../../lib/http/auth.ts";
import type { Handler } from "../../lib/http/index.ts";
import { describe } from "../../lib/openapi.ts";
import type { OpsHandlers } from "./ops.handler.ts";

/** Health routes are public; the admin breakdown is decided in the handler from the actor. */
export function createOpsRouter(handlers: OpsHandlers, resetState: Handler | null): Hono {
  const router = new Hono();
  router.get("/health", describe("system", "Health", healthPublicSchema), handlers.health);
  router.get("/health/live", describe("system", "Liveness", v.undefined(), 204), handlers.live);
  router.get("/health/ready", describe("system", "Readiness", v.undefined(), 204), handlers.ready);
  if (resetState !== null) {
    router.post(
      "/admin/reset-state",
      requireRole("admin"),
      describe("system", "Reset metadata (non-production)", v.unknown()),
      resetState
    );
  }
  return router;
}
