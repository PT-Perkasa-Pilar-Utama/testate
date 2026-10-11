import { Hono } from "hono";
import { readingSchema, readingSeriesSchema } from "@testate/shared";
import * as v from "valibot";

import { requireRole } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { ReadingsHandlers } from "./readings.handler.ts";

const P = "/projects/:slug/readings";

/** Resource readings (#38, Q7): take one, list them, read one; and the monitor's series (#101). */
export function createReadingsRouter(h: ReadingsHandlers): Hono {
  const router = new Hono();
  router.post(
    P,
    requireRole("qa"),
    describe("readings", "Take a resource reading of the project", readingSchema, 201),
    h.take
  );
  router.get(
    P,
    requireRole("viewer"),
    describe("readings", "Resource readings, newest first", v.array(readingSchema)),
    h.list
  );
  // Before `/:id`, which would otherwise take `series` for a reading id.
  router.get(
    `${P}/series`,
    requireRole("viewer"),
    describe(
      "readings",
      "Every value over a window, bucketed (min, mean, max)",
      readingSeriesSchema
    ),
    h.series
  );
  router.get(
    `${P}/:id`,
    requireRole("viewer"),
    describe("readings", "One resource reading", readingSchema),
    h.get
  );
  return router;
}
