import { Hono } from "hono";
import {
  archiveManifestSchema,
  jobSchema,
  stateDetailSchema,
  stateSchema,
  stateTreeNodeSchema,
} from "@testate/shared";
import * as v from "valibot";

import { requireRole } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { StatesHandlers } from "./states.handler.ts";

const P = "/projects/:slug/states";

export function createStatesRouter(h: StatesHandlers): Hono {
  const router = new Hono();
  router.get(
    P,
    requireRole("viewer"),
    describe("states", "List states", v.array(stateSchema)),
    h.list
  );
  router.get(
    `${P}/tree`,
    requireRole("viewer"),
    describe("states", "State tree", v.array(stateTreeNodeSchema)),
    h.tree
  );
  router.post(
    P,
    requireRole("qa"),
    describe("states", "Take a state (snapshot job)", v.unknown(), 202),
    h.create
  );
  router.post(
    `${P}/import`,
    requireRole("qa"),
    describe("states", "Import an archive (job)", jobSchema, 202),
    h.importArchive
  );
  router.get(
    `${P}/:id`,
    requireRole("viewer"),
    describe("states", "State detail", stateDetailSchema),
    h.get
  );
  router.patch(
    `${P}/:id`,
    requireRole("qa"),
    describe("states", "Rename, tag, protect", stateSchema),
    h.update
  );
  router.delete(
    `${P}/:id`,
    requireRole("qa"),
    describe("states", "Delete a state (job)", jobSchema, 202),
    h.remove
  );
  router.get(
    `${P}/:id/archive`,
    requireRole("viewer"),
    describe("states", "Download the archive", v.unknown()),
    h.archive
  );
  router.get(
    "/projects/:slug/uploads/:upload_id/archive-manifest",
    requireRole("qa"),
    describe("states", "Read an uploaded archive's adapters", archiveManifestSchema),
    h.archiveManifest
  );
  return router;
}
