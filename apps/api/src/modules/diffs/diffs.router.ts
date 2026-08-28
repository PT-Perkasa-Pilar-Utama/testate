import { Hono } from "hono";
import { diffRowSchema, diffSchema } from "@testate/shared";
import * as v from "valibot";

import { requireRole } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { DiffsHandlers } from "./diffs.handler.ts";

const P = "/projects/:slug/diffs";

export function createDiffsRouter(h: DiffsHandlers): Hono {
  const router = new Hono();
  router.post(
    P,
    requireRole("qa"),
    describe("diffs", "Create a diff (job)", v.unknown(), 202),
    h.create
  );
  router.get(
    P,
    requireRole("viewer"),
    describe("diffs", "List diffs", v.array(diffSchema)),
    h.list
  );
  router.get(
    `${P}/:id`,
    requireRole("viewer"),
    describe("diffs", "Diff summary", diffSchema),
    h.get
  );
  router.get(
    `${P}/:id/rows`,
    requireRole("viewer"),
    describe("diffs", "Diff rows", v.array(diffRowSchema)),
    h.rows
  );
  router.get(
    `${P}/:id/export`,
    requireRole("viewer"),
    describe("diffs", "Export a diff", v.unknown()),
    h.export
  );
  router.delete(
    `${P}/:id`,
    requireRole("qa"),
    describe("diffs", "Delete a diff", v.undefined(), 204),
    h.remove
  );
  return router;
}
