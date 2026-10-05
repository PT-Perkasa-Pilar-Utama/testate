import { Hono } from "hono";
import {
  importReportSchema,
  importRunSchema,
  jobSchema,
  normalizerSchema,
  previewSchema,
  uploadSchema,
} from "@testate/shared";
import * as v from "valibot";

import { requireRole } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { ImportsHandlers } from "./imports.handler.ts";

const P = "/projects/:slug";
const M = `${P}/adapters/:id/normalizers`;

export function createImportsRouter(h: ImportsHandlers): Hono {
  const router = new Hono();
  router.post(
    `${P}/uploads`,
    requireRole("qa"),
    describe("imports", "Upload a file", uploadSchema, 201),
    h.upload
  );
  router.post(
    `${P}/imports/preview`,
    requireRole("qa"),
    describe("imports", "Preview a source", previewSchema),
    h.preview
  );
  router.get(
    M,
    requireRole("viewer"),
    describe("imports", "List normalizers", v.array(normalizerSchema)),
    h.listNormalizers
  );
  router.post(
    M,
    requireRole("qa"),
    describe("imports", "Create a normalizer", normalizerSchema, 201),
    h.createNormalizer
  );
  router.get(
    `${M}/:mid`,
    requireRole("viewer"),
    describe("imports", "Get a normalizer", normalizerSchema),
    h.getNormalizer
  );
  router.patch(
    `${M}/:mid`,
    requireRole("qa"),
    describe("imports", "Update a normalizer", normalizerSchema),
    h.updateNormalizer
  );
  router.delete(
    `${M}/:mid`,
    requireRole("qa"),
    describe("imports", "Delete a normalizer", v.undefined(), 204),
    h.removeNormalizer
  );
  router.post(
    `${P}/imports`,
    requireRole("qa"),
    describe("imports", "Dry run or run an import (job)", jobSchema, 202),
    h.run
  );
  router.get(
    `${P}/imports`,
    requireRole("viewer"),
    describe("imports", "Past runs", v.array(importRunSchema)),
    h.listRuns
  );
  router.get(
    `${P}/imports/:run_id`,
    requireRole("viewer"),
    describe("imports", "Run report", importReportSchema),
    h.report
  );
  router.get(
    `${P}/imports/:run_id/rejected`,
    requireRole("viewer"),
    describe("imports", "Rejected rows CSV", v.unknown()),
    h.rejectedRows
  );
  router.get(
    `${P}/adapters/:id/tables/:table/sample`,
    requireRole("viewer"),
    describe("imports", "Sample file from the schema", v.unknown()),
    h.sample
  );
  return router;
}
