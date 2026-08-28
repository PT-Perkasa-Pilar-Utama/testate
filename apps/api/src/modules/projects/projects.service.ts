import type { Head, Job, Project, Quota } from "@testate/shared";

import { conflict, notFound } from "../../lib/http/index.ts";
import { DELETION_PLAN_MOCK, PROJECT_JOB_MOCK, PROJECT_MOCK, QUOTA_MOCK } from "./projects.mock.ts";

export type ProjectOverview = {
  project: Project;
  adapters: {
    id: string;
    name: string;
    kind: string;
    engine: string;
    tier: string;
    mode: string;
    status: string;
  }[];
  latest_jobs: Job[];
  quota: Quota;
  banner: { kind: "head_unknown"; message: string } | null;
};

export type ProjectsService = {
  list(): Promise<Project[]>;
  create(slug: string): Promise<Project>;
  get(slug: string): Promise<ProjectOverview>;
  update(slug: string): Promise<Project>;
  head(slug: string): Promise<Head>;
  quota(slug: string): Promise<Quota>;
  deletionPlan(slug: string): Promise<typeof DELETION_PLAN_MOCK>;
  deleteProject(slug: string, confirmSlug: string, planId: string): Promise<Job>;
};

/** SCAFFOLD: one project, `shop`. The projects card wires the repository (06 §6.4). */
export function createProjectsService(): ProjectsService {
  const find = (slug: string): Project => {
    if (slug !== PROJECT_MOCK.slug) throw notFound("project");
    return PROJECT_MOCK;
  };
  return {
    async list() {
      return [PROJECT_MOCK];
    },
    async create(slug) {
      if (slug === PROJECT_MOCK.slug) throw conflict("slug is taken", { slug });
      return {
        ...PROJECT_MOCK,
        slug,
        head: { status: "none", state_id: null, state_name: null, changed_at: null },
      };
    },
    async get(slug) {
      const project = find(slug);
      return {
        project,
        adapters: [
          {
            id: "01991f00-0000-7000-8000-000000000020",
            name: "orders-db",
            kind: "database",
            engine: "postgres",
            tier: "tabular",
            mode: "sandbox",
            status: "ok",
          },
        ],
        latest_jobs: [PROJECT_JOB_MOCK],
        quota: QUOTA_MOCK,
        banner: null,
      };
    },
    async update(slug) {
      return find(slug);
    },
    async head(slug) {
      return find(slug).head;
    },
    async quota(slug) {
      find(slug);
      return QUOTA_MOCK;
    },
    async deletionPlan(slug) {
      find(slug);
      return DELETION_PLAN_MOCK;
    },
    async deleteProject(slug, confirmSlug, planId) {
      find(slug);
      if (confirmSlug !== slug) throw conflict("confirm_slug does not match");
      if (planId !== DELETION_PLAN_MOCK.plan_id) throw conflict("deletion plan is stale");
      return {
        ...PROJECT_JOB_MOCK,
        kind: "project_delete",
        status: "queued",
        finished_at: null,
        result: null,
      };
    },
  };
}
