/**
 * Moving an adapter to another project, Inspect included (#77; M1–M7 of
 * docs/decisions/2026-10-10-move-adapter.md, ADR 0005). The id stays, so its policies, saved
 * queries, mappings and host key go with it; a database leaves its old project's states.
 */
import type { Actor, Project } from "@testate/shared";

import type { RequestMeta } from "../../lib/http/auth.ts";
import { AppError, conflict, notFound } from "../../lib/http/index.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import type { AdapterRecorder } from "./adapters.helpers.ts";
import { toPublic } from "./adapters.helpers.ts";
import { assertMayManage, takesInit } from "./adapters.inspect.ts";
import type { MoveRepository } from "./adapters.move.repository.ts";
import type { AdapterRecord, AdaptersRepository } from "./adapters.repository.ts";
import type { AdapterWithJob } from "./adapters.service.ts";

export type MoveDeps = {
  repo: Pick<AdaptersRepository, "byId" | "byName">;
  moves: MoveRepository;
  projects: Pick<ProjectsRepository, "bySlug">;
  /** A database joins a regular project only at its starting point (#63; M3). */
  assertAtInit: (project: Project) => void;
  initJob: (
    adapter: AdapterRecord,
    actor: Actor,
    meta: RequestMeta
  ) => Promise<AdapterWithJob["init_job"]>;
  record: AdapterRecorder;
  now: () => Date;
};

export type MoveRequest = {
  actor: Actor;
  slug: string;
  adapterId: string;
  target: string;
  scope: string[] | null;
  meta: RequestMeta;
};

const inScope = (deps: MoveDeps, slug: string, scope: string[] | null): Project => {
  const project = deps.projects.bySlug(slug);
  if (project === null || (scope !== null && !scope.includes(project.id)))
    throw notFound("project");
  return project;
};

/** Every refusal before anything changes: M1, M5, M6, and the name in the destination. */
function assertMovable(deps: MoveDeps, adapter: AdapterRecord, from: Project, to: Project): void {
  if (to.id === from.id) throw new AppError("VALIDATION_ERROR", "the adapter is already there");
  if (adapter.engine === "ingest" && to.kind === "inspect")
    throw new AppError("PROJECT_READ_ONLY", "Inspect stores no pushed logs; use a project.", {
      engine: adapter.engine,
    });
  if (deps.repo.byName(to.id, adapter.name) !== null)
    throw conflict("adapter name is taken", { name: adapter.name, project: to.slug });
  const blockers = deps.moves.blockers(adapter.id, from.id);
  if (blockers.job)
    throw new AppError("JOB_IN_PROGRESS", "a job of this project is still running", {
      project: from.slug,
    });
  if (blockers.session) throw conflict("end the write session on this adapter first");
}

export async function moveAdapter(deps: MoveDeps, request: MoveRequest): Promise<AdapterWithJob> {
  const { actor, meta } = request;
  const from = inScope(deps, request.slug, request.scope);
  const to = inScope(deps, request.target, request.scope);
  const found = deps.repo.byId(request.adapterId);
  if (found === null || found.project_id !== from.id) throw notFound("adapter");
  const adapter = assertMayManage(from, found, actor);
  assertMovable(deps, adapter, from, to);
  const joinsHistory = adapter.kind === "database" && takesInit(to);
  if (joinsHistory) deps.assertAtInit(to);
  const marked = deps.moves.moveTo(adapter.id, {
    from: from.id,
    to: to.id,
    // A move never loosens the mode; Inspect holds read-only adapters only (M4).
    mode: to.kind === "inspect" ? "read_only" : adapter.mode,
    at: deps.now().toISOString(),
  });
  const moved = deps.repo.byId(adapter.id);
  if (moved === null) throw notFound("adapter");
  const init = joinsHistory ? await deps.initJob(moved, actor, meta) : null;
  deps.record(actor, "adapter.moved", moved, to.slug, meta, {
    from: { id: from.id, slug: from.slug },
    manifests_marked: marked,
    init_job: init?.id ?? null,
  });
  return { adapter: toPublic(moved), init_job: init };
}
