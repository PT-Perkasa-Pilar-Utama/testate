import { Hono } from "hono";
import { entrySchema, previewPayloadSchema } from "@testate/shared";
import * as v from "valibot";

import { requireRole } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { StorageHandlers } from "./storage.handler.ts";

const P = "/projects/:slug/adapters/:id";

export function createStorageRouter(h: StorageHandlers): Hono {
  const router = new Hono();
  router.get(
    `${P}/entries`,
    requireRole("viewer"),
    describe("storage", "List a directory", v.array(entrySchema)),
    h.list
  );
  router.get(
    `${P}/entries/stat`,
    requireRole("viewer"),
    describe("storage", "Entry metadata", entrySchema),
    h.stat
  );
  router.get(
    `${P}/entries/preview`,
    requireRole("viewer"),
    describe("storage", "Preview a file", previewPayloadSchema),
    h.preview
  );
  router.get(
    `${P}/entries/download`,
    requireRole("viewer"),
    describe("storage", "Download a file", v.unknown()),
    h.download
  );
  router.post(
    `${P}/host-key/accept`,
    requireRole("qa"),
    describe("storage", "Accept a changed SFTP host key", v.undefined(), 204),
    h.acceptHostKey
  );
  return router;
}
