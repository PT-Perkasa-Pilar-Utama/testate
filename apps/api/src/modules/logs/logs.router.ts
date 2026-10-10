import { Hono } from "hono";
import { logSourcesSchema, logsPageSchema } from "@testate/shared";
import * as v from "valibot";

import { requireRole } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { LogsHandlers } from "./logs.handler.ts";

const P = "/projects/:slug/adapters/:id/logs";

/** Read-only by construction: the Logs tier has no write route (#37). */
export function createLogsRouter(h: LogsHandlers): Hono {
  const router = new Hono();
  router.get(
    P,
    requireRole("viewer"),
    describe("logs", "Read a log source", logsPageSchema),
    h.read
  );
  router.get(
    `${P}/sources`,
    requireRole("viewer"),
    describe("logs", "The sources a log adapter has", logSourcesSchema),
    h.sources
  );
  router.get(
    `${P}/download`,
    requireRole("viewer"),
    describe("logs", "Download the entries on screen as JSON lines", v.string()),
    h.download
  );
  return router;
}
