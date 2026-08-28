import { Hono } from "hono";
import { hookSchema } from "@testate/shared";
import * as v from "valibot";

import { requireRole } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { HooksHandlers } from "./hooks.handler.ts";

const P = "/projects/:slug/hooks";

export function createHooksRouter(h: HooksHandlers): Hono {
  const router = new Hono();
  router.get(
    P,
    requireRole("viewer"),
    describe("hooks", "List hooks", v.array(hookSchema)),
    h.list
  );
  router.post(P, requireRole("qa"), describe("hooks", "Create a hook", hookSchema, 201), h.create);
  router.put(
    `${P}/order`,
    requireRole("qa"),
    describe("hooks", "Reorder a trigger", v.array(hookSchema)),
    h.reorder
  );
  router.patch(
    `${P}/:id`,
    requireRole("qa"),
    describe("hooks", "Update a hook", hookSchema),
    h.update
  );
  router.delete(
    `${P}/:id`,
    requireRole("qa"),
    describe("hooks", "Delete a hook", v.undefined(), 204),
    h.remove
  );
  return router;
}
