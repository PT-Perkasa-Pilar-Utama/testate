import { Hono } from "hono";
import {
  headSchema,
  jobSchema,
  projectDefaultsSchema,
  projectSchema,
  quotaSchema,
} from "@testate/shared";
import * as v from "valibot";

import { requireRole } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { ProjectsHandlers } from "./projects.handler.ts";

export function createProjectsRouter(h: ProjectsHandlers): Hono {
  const router = new Hono();
  router.get(
    "/projects",
    requireRole("viewer"),
    describe("projects", "List projects", v.array(projectSchema)),
    h.list
  );
  router.post(
    "/projects",
    requireRole("qa"),
    describe("projects", "Create a project", projectSchema, 201),
    h.create
  );
  // Before `/:slug`, and `defaults` is reserved in `freeSlug`, so no project can answer here.
  router.get(
    "/projects/defaults",
    requireRole("qa"),
    describe("projects", "What a new project inherits", projectDefaultsSchema),
    h.defaults
  );
  router.get(
    "/projects/:slug",
    requireRole("viewer"),
    describe("projects", "Project overview", v.unknown()),
    h.get
  );
  router.patch(
    "/projects/:slug",
    requireRole("qa"),
    describe("projects", "Update a project", projectSchema),
    h.update
  );
  router.get(
    "/projects/:slug/head",
    requireRole("viewer"),
    describe("projects", "HEAD", headSchema),
    h.head
  );
  router.get(
    "/projects/:slug/quota",
    requireRole("viewer"),
    describe("projects", "Quota usage", quotaSchema),
    h.quota
  );
  router.get(
    "/projects/:slug/deletion-plan",
    requireRole("admin"),
    describe("projects", "Deletion plan", v.unknown()),
    h.deletionPlan
  );
  router.post(
    "/projects/:slug/deletion",
    requireRole("admin"),
    describe("projects", "Return every database to init, then delete", jobSchema, 202),
    h.deleteProject
  );
  return router;
}
