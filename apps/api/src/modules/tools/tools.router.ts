import { Hono } from "hono";
import { hashResponseSchema, randomResponseSchema, uuidResponseSchema } from "@testate/shared";

import { requireRole } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { ToolsHandlers } from "./tools.handler.ts";

export function createToolsRouter(h: ToolsHandlers): Hono {
  const router = new Hono();
  router.post("/tools/hash", requireRole("viewer"), describe("tools", "Hash a value", hashResponseSchema), h.hash);
  router.post("/tools/random", requireRole("viewer"), describe("tools", "Random secret", randomResponseSchema), h.random);
  router.post("/tools/uuid", requireRole("viewer"), describe("tools", "UUIDs", uuidResponseSchema), h.uuid);
  return router;
}
