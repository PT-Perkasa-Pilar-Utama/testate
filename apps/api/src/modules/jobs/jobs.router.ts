import { Hono } from "hono";
import { jobSchema } from "@testate/shared";
import * as v from "valibot";

import { requireRole } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { JobsHandlers } from "./jobs.handler.ts";

export function createJobsRouter(h: JobsHandlers): Hono {
  const router = new Hono();
  router.get(
    "/jobs",
    requireRole("viewer"),
    describe("jobs", "List jobs", v.array(jobSchema)),
    h.list
  );
  router.get(
    "/jobs/:id",
    requireRole("viewer"),
    describe("jobs", "Get a job, optionally waiting", jobSchema),
    h.get
  );
  router.post(
    "/jobs/:id/cancel",
    requireRole("qa"),
    describe("jobs", "Cancel a job", jobSchema, 202),
    h.cancel
  );
  router.get(
    "/jobs/:id/events",
    requireRole("viewer"),
    describe("jobs", "Job events (SSE)", v.unknown()),
    h.events
  );
  return router;
}
