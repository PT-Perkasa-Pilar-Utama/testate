import { Hono } from "hono";
import { ingestAnswerSchema, ingestTokenSchema } from "@testate/shared";
import * as v from "valibot";

import { requireRole } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { IngestHandlers } from "./ingest.handler.ts";

const P = "/projects/:slug/adapters/:id";

/**
 * `POST /ingest/:id` has no role: its ingest token is checked in the handler, and it reaches this
 * route and nothing else (Q4b, I1). The other two are a person's, on the adapter page (I3a, I8).
 */
export function createIngestRouter(h: IngestHandlers): Hono {
  const router = new Hono();
  router.post(
    "/ingest/:id",
    describe(
      "logs",
      "Push testate-format JSON lines to an ingest adapter",
      ingestAnswerSchema,
      202
    ),
    h.push
  );
  router.post(
    `${P}/ingest-token/rotation`,
    requireRole("qa"),
    describe(
      "logs",
      "Replace an ingest adapter's token; the old one stops at once",
      ingestTokenSchema
    ),
    h.rotate
  );
  router.post(
    `${P}/logs/clear`,
    requireRole("admin"),
    describe(
      "logs",
      "Remove every line an ingest adapter holds",
      v.object({ cleared: v.boolean() })
    ),
    h.clear
  );
  return router;
}
