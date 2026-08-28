/**
 * API v1 router.
 *
 * AI AGENTS: this file wires routers only. Business logic lives in
 * modules/<name>/<name>.service.ts; SQL in <name>.repository.ts.
 * Do NOT add handlers or logic here.
 */
import { Hono } from "hono";

import type { Handler } from "../lib/http/index.ts";
import type { AdaptersHandlers } from "./adapters/adapters.handler.ts";
import { createAdaptersRouter } from "./adapters/adapters.router.ts";
import type { AgentHandlers } from "./agent/agent.handler.ts";
import { createAgentRouter } from "./agent/agent.router.ts";
import type { AuditHandlers } from "./audit/audit.handler.ts";
import { createAuditRouter } from "./audit/audit.router.ts";
import type { AuthHandlers } from "./auth/auth.handler.ts";
import { createAuthRouter } from "./auth/auth.router.ts";
import type { CheckoutsHandlers } from "./checkouts/checkouts.handler.ts";
import { createCheckoutsRouter } from "./checkouts/checkouts.router.ts";
import type { DataHandlers } from "./data/data.handler.ts";
import { createDataRouter } from "./data/data.router.ts";
import type { DiffsHandlers } from "./diffs/diffs.handler.ts";
import { createDiffsRouter } from "./diffs/diffs.router.ts";
import type { HooksHandlers } from "./hooks/hooks.handler.ts";
import { createHooksRouter } from "./hooks/hooks.router.ts";
import type { ImportsHandlers } from "./imports/imports.handler.ts";
import { createImportsRouter } from "./imports/imports.router.ts";
import type { JobsHandlers } from "./jobs/jobs.handler.ts";
import { createJobsRouter } from "./jobs/jobs.router.ts";
import type { OpsHandlers } from "./ops/ops.handler.ts";
import { createOpsRouter } from "./ops/ops.router.ts";
import type { ProjectsHandlers } from "./projects/projects.handler.ts";
import { createProjectsRouter } from "./projects/projects.router.ts";
import type { RestHandlers } from "./rest/rest.handler.ts";
import { createRestRouter } from "./rest/rest.router.ts";
import type { SettingsHandlers } from "./settings/settings.handler.ts";
import { createSettingsRouter } from "./settings/settings.router.ts";
import type { StatesHandlers } from "./states/states.handler.ts";
import { createStatesRouter } from "./states/states.router.ts";
import type { StorageHandlers } from "./storage/storage.handler.ts";
import { createStorageRouter } from "./storage/storage.router.ts";
import type { ToolsHandlers } from "./tools/tools.handler.ts";
import { createToolsRouter } from "./tools/tools.router.ts";
import type { UsersHandlers } from "./users/users.handler.ts";
import { createUsersRouter } from "./users/users.router.ts";

export type V1Deps = {
  ops: OpsHandlers;
  resetState: Handler | null;
  auth: AuthHandlers;
  users: UsersHandlers;
  projects: ProjectsHandlers;
  adapters: AdaptersHandlers;
  data: DataHandlers;
  imports: ImportsHandlers;
  states: StatesHandlers;
  checkouts: CheckoutsHandlers;
  diffs: DiffsHandlers;
  storage: StorageHandlers;
  rest: RestHandlers;
  hooks: HooksHandlers;
  jobs: JobsHandlers;
  audit: AuditHandlers;
  settings: SettingsHandlers;
  tools: ToolsHandlers;
  agent: AgentHandlers;
};

export function createV1(deps: V1Deps): Hono {
  const v1 = new Hono();
  v1.route("/", createOpsRouter(deps.ops, deps.resetState));
  v1.route("/", createAuthRouter(deps.auth));
  v1.route("/", createUsersRouter(deps.users));
  v1.route("/", createProjectsRouter(deps.projects));
  v1.route("/", createAdaptersRouter(deps.adapters));
  v1.route("/", createDataRouter(deps.data));
  v1.route("/", createImportsRouter(deps.imports));
  v1.route("/", createStatesRouter(deps.states));
  v1.route("/", createCheckoutsRouter(deps.checkouts));
  v1.route("/", createDiffsRouter(deps.diffs));
  v1.route("/", createStorageRouter(deps.storage));
  v1.route("/", createRestRouter(deps.rest));
  v1.route("/", createHooksRouter(deps.hooks));
  v1.route("/", createJobsRouter(deps.jobs));
  v1.route("/", createAuditRouter(deps.audit));
  v1.route("/", createSettingsRouter(deps.settings));
  v1.route("/", createToolsRouter(deps.tools));
  v1.route("/", createAgentRouter(deps.agent));
  return v1;
}
