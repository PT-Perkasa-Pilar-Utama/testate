import { Hono } from "hono";
import {
  adapterDeletionPlanSchema,
  adapterWithProjectSchema,
  adapterSchema,
  jobSchema,
  createAdapterResponseSchema,
  hostSuggestionSchema,
  probeOutcomeSchema,
} from "@testate/shared";
import * as v from "valibot";

import { requireRole } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { AdaptersHandlers } from "./adapters.handler.ts";

const P = "/projects/:slug/adapters";

export function createAdaptersRouter(h: AdaptersHandlers): Hono {
  const router = new Hono();
  router.get(
    "/adapter-hosts",
    requireRole("qa"),
    describe("adapters", "Hosts the server can reach", v.array(hostSuggestionSchema)),
    h.hosts
  );
  router.get(
    "/storage-adapters",
    requireRole("viewer"),
    describe("adapters", "Every file store this caller may see", v.array(adapterWithProjectSchema)),
    h.stores
  );
  router.get(
    P,
    requireRole("viewer"),
    describe("adapters", "List adapters", v.array(adapterSchema)),
    h.list
  );
  router.post(
    `${P}/test`,
    requireRole("qa"),
    describe("adapters", "Test a draft connection", probeOutcomeSchema),
    h.testDraft
  );
  router.post(
    P,
    requireRole("qa"),
    describe("adapters", "Create an adapter", createAdapterResponseSchema, 201),
    h.create
  );
  router.get(
    `${P}/:id`,
    requireRole("viewer"),
    describe("adapters", "Get an adapter", adapterSchema),
    h.get
  );
  router.patch(
    `${P}/:id`,
    requireRole("qa"),
    describe("adapters", "Update an adapter", createAdapterResponseSchema),
    h.update
  );
  router.post(
    `${P}/:id/mode`,
    requireRole("admin"),
    describe("adapters", "Tighten or loosen the mode", adapterSchema),
    h.setMode
  );
  router.post(
    `${P}/:id/retest`,
    requireRole("qa"),
    describe("adapters", "Re-probe a saved adapter", probeOutcomeSchema),
    h.retest
  );
  router.get(
    `${P}/:id/deletion-plan`,
    requireRole("qa"),
    describe("adapters", "Deletion plan", adapterDeletionPlanSchema),
    h.deletionPlan
  );
  router.post(
    `${P}/:id/deletion`,
    requireRole("qa"),
    describe("adapters", "Return to init, then delete", jobSchema, 202),
    h.remove
  );
  return router;
}
