import { Hono } from "hono";
import { userSchema } from "@testate/shared";
import * as v from "valibot";

import { requireRole, requireUnscoped } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { UsersHandlers } from "./users.handler.ts";

export function createUsersRouter(h: UsersHandlers): Hono {
  const router = new Hono();
  router.use("/users", requireRole("admin"), requireUnscoped());
  router.use("/users/*", requireRole("admin"), requireUnscoped());
  router.get("/users", describe("users", "List users", v.array(userSchema)), h.list);
  router.post("/users", describe("users", "Create a user", userSchema, 201), h.create);
  router.get("/users/:id", describe("users", "Get a user", userSchema), h.get);
  router.patch("/users/:id", describe("users", "Update a user", userSchema), h.update);
  router.post("/users/:id/disable", describe("users", "Disable a user", userSchema), h.disable);
  router.post("/users/:id/enable", describe("users", "Enable a user", userSchema), h.enable);
  router.delete("/users/:id", describe("users", "Delete a user", v.undefined(), 204), h.remove);
  router.post(
    "/users/:id/reset-password",
    describe("users", "Reset a password", v.undefined(), 204),
    h.resetPassword
  );
  return router;
}
