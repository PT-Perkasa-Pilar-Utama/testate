import { Hono } from "hono";
import { auditRowSchema } from "@testate/shared";
import * as v from "valibot";

import { requireRole } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { AuditHandlers } from "./audit.handler.ts";

// SCAFFOLD: viewer access lands with project scoping (09 §9.5); until then rows are admin-only.
export function createAuditRouter(h: AuditHandlers): Hono {
  const router = new Hono();
  router.get(
    "/audit-logs",
    requireRole("admin"),
    describe("audit", "Audit rows", v.array(auditRowSchema)),
    h.list
  );
  router.get(
    "/audit-logs/export",
    requireRole("admin"),
    describe("audit", "Audit CSV", v.unknown()),
    h.exportCsv
  );
  return router;
}
