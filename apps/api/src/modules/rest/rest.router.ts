import { Hono } from "hono";
import { restRequestSchema, restRunSchema } from "@testate/shared";
import * as v from "valibot";

import { requireRole } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { RestHandlers } from "./rest.handler.ts";

const P = "/projects/:slug/rest/:id/requests";

export function createRestRouter(h: RestHandlers): Hono {
  const router = new Hono();
  router.get(
    P,
    requireRole("viewer"),
    describe("rest", "List saved requests", v.array(restRequestSchema)),
    h.list
  );
  router.post(
    P,
    requireRole("qa"),
    describe("rest", "Create a request", restRequestSchema, 201),
    h.create
  );
  router.get(
    `${P}/:rid`,
    requireRole("viewer"),
    describe("rest", "Get a request", restRequestSchema),
    h.get
  );
  router.patch(
    `${P}/:rid`,
    requireRole("qa"),
    describe("rest", "Update a request", restRequestSchema),
    h.update
  );
  router.delete(
    `${P}/:rid`,
    requireRole("qa"),
    describe("rest", "Delete a request", v.undefined(), 204),
    h.remove
  );
  router.post(
    `${P}/:rid/run`,
    requireRole("qa"),
    describe("rest", "Run a request", restRunSchema),
    h.run
  );
  router.get(
    `${P}/:rid/runs`,
    requireRole("viewer"),
    describe("rest", "Recent runs", v.array(restRunSchema)),
    h.runs
  );
  return router;
}
