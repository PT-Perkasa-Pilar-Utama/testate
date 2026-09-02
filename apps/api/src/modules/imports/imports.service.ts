import type {
  Actor,
  ImportReport,
  ImportRun,
  Job,
  Mapping,
  Preview,
  Project,
  TableSchema,
  Upload,
} from "@testate/shared";
import { importModeSchema, jsonObjectSchema } from "@testate/shared";
import type {
  importRunRequestSchema,
  mappingBodySchema,
  previewRequestSchema,
} from "@testate/shared";
import * as v from "valibot";

import { toConnectionConfig } from "../../lib/engines/connection.ts";
import { sameTable } from "../../lib/engines/index.ts";
import type { EngineRegistry } from "../../lib/engines/index.ts";
import { AppError, conflict, notFound } from "../../lib/http/index.ts";
import type { RequestMeta } from "../../lib/http/auth.ts";
import type { KeyRing } from "../../lib/sealed/index.ts";
import type { FilesResolver } from "../adapters/adapters.files.ts";
import { ERRORS_PREVIEW, toReport } from "./imports.runs.ts";
import { fetchStorageSource } from "./imports.source.ts";
import type { AdapterRecord, AdaptersRepository } from "../adapters/adapters.repository.ts";
import { CONFIG_COLUMN, openSecrets } from "../adapters/adapters.secrets.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { PoliciesRepository } from "../data/data.policies.ts";
import type { EnqueueInput, JobsService } from "../jobs/jobs.service.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import type {
  ImportSource,
  ImportsRepository,
  MappingPatch,
  RunsFilter,
  UploadRecord,
} from "./imports.repository.ts";
import { createFileOps } from "./imports.files.ts";
import { validateMapping } from "./imports.validate.ts";

export type MappingBody = v.InferOutput<typeof mappingBodySchema>;
export type PreviewRequest = v.InferOutput<typeof previewRequestSchema>;
export type ImportRunRequest = v.InferOutput<typeof importRunRequestSchema>;

export type ImportsService = {
  upload(slug: string, file: File, purpose: "import" | "archive"): Promise<Upload>;
  preview(slug: string, request: PreviewRequest): Promise<Preview>;
  listMappings(adapterId: string): Promise<Mapping[]>;
  createMapping(actor: Actor, adapterId: string, body: MappingBody): Promise<Mapping>;
  getMapping(adapterId: string, id: string): Promise<Mapping>;
  updateMapping(adapterId: string, id: string, patch: Partial<MappingBody>): Promise<Mapping>;
  removeMapping(adapterId: string, id: string): Promise<void>;
  run(actor: Actor, slug: string, request: ImportRunRequest, meta: RequestMeta): Promise<Job>;
  listRuns(slug: string, filter: RunsFilter): Promise<ImportRun[]>;
  report(slug: string, runId: string): Promise<ImportReport>;
  rejectedRows(slug: string, runId: string): Promise<string>;
  sample(
    adapterId: string,
    table: string,
    format: "csv" | "xlsx",
    mappingId: string | undefined
  ): Promise<{ fileName: string; body: string | Uint8Array }>;
};

export type ImportsDeps = {
  repo: ImportsRepository;
  adapters: Pick<AdaptersRepository, "byId">;
  policies: Pick<PoliciesRepository, "list">;
  projects: Pick<ProjectsRepository, "bySlug">;
  engines: EngineRegistry;
  ring: KeyRing;
  files: FilesResolver;
  jobs: Pick<JobsService, "enqueue" | "get">;
  audit: AuditService;
  dataDir: string;
  maxUploadBytes: number;
  now: () => Date;
};

type SourceFile = { path: string; uploadId: string | null };

function sourceOf(source: ImportRunRequest["source"]): ImportSource {
  if ("upload_id" in source) return { kind: "upload", ref: source.upload_id };
  if ("rejected_of_run_id" in source) return { kind: "rejected", ref: source.rejected_of_run_id };
  return { kind: "storage", ref: source.path };
}

export function createImportsService(deps: ImportsDeps): ImportsService {
  const { repo } = deps;
  const nowIso = (): string => deps.now().toISOString();
  const projectOf = (slug: string): Project => {
    const project = deps.projects.bySlug(slug);
    if (project === null) throw notFound("project");
    return project;
  };
  const tabular = (adapterId: string): AdapterRecord => {
    const adapter = deps.adapters.byId(adapterId);
    if (adapter === null) throw notFound("adapter");
    if (adapter.tier !== "tabular")
      throw new AppError("ENGINE_UNSUPPORTED", "imports need a Tabular adapter", {
        reason: "tier",
      });
    return adapter;
  };
  const mappingOf = (adapter: AdapterRecord, id: string): Mapping => {
    const mapping = repo.mapping(id);
    if (mapping === null || mapping.adapter_id !== adapter.id) throw notFound("mapping");
    return mapping;
  };
  const tableOf = async (adapter: AdapterRecord, target: string): Promise<TableSchema> => {
    const secrets = await openSecrets(deps.ring, adapter.id, CONFIG_COLUMN, adapter.config_sealed);
    const config = toConnectionConfig(adapter.engine, adapter.config, secrets);
    const live = await deps.engines
      .require(adapter.engine)
      .introspect({ connectionId: adapter.id, config }, []);
    const dot = target.indexOf(".");
    const ref =
      dot === -1
        ? { schema: null, name: target }
        : { schema: target.slice(0, dot), name: target.slice(dot + 1) };
    const table = live.tables.find(
      (item) => sameTable(item, ref) || (ref.schema === null && item.name === ref.name)
    );
    if (table === undefined) throw notFound("table");
    return table;
  };
  const liveUpload = (project: Project, id: string): UploadRecord => {
    const upload = repo.upload(id);
    if (upload === null || upload.project_id !== project.id) throw notFound("upload");
    if (Date.parse(upload.expires_at) <= deps.now().getTime()) throw notFound("upload");
    return upload;
  };
  const sourcePath = async (
    project: Project,
    source: ImportRunRequest["source"]
  ): Promise<SourceFile> => {
    if ("upload_id" in source) {
      const upload = liveUpload(project, source.upload_id);
      if (upload.type === "tar")
        throw new AppError("VALIDATION_ERROR", "an archive is not an import source", {
          reason: "type",
        });
      return { path: upload.path, uploadId: upload.upload_id };
    }
    if ("rejected_of_run_id" in source) {
      const run = repo.run(project.id, source.rejected_of_run_id);
      if (run === null || run.rejected_path === null) throw notFound("rejected rows");
      return { path: run.rejected_path, uploadId: null };
    }
    return fetchStorageSource(deps, project, source.adapter_id, source.path);
  };
  const files = createFileOps({ ...deps, sourcePath, tableOf });

  return {
    upload: (slug, file, purpose) => files.upload(projectOf(slug), file, purpose),
    preview: (slug, request) => files.preview(projectOf(slug), request),
    async listMappings(adapterId) {
      return repo.mappings(tabular(adapterId).id);
    },
    async createMapping(actor, adapterId, body) {
      const adapter = tabular(adapterId);
      if (repo.mappingByName(adapter.id, body.target, body.name) !== null)
        throw conflict("a normalizer for that table already has that name", {
          name: body.name,
          target: body.target,
        });
      validateMapping(
        body,
        await tableOf(adapter, body.target),
        deps.policies.list(adapter.id, body.target)
      );
      return repo.insertMapping({
        ...body,
        id: Bun.randomUUIDv7(),
        adapter_id: adapter.id,
        created_by: actor.id,
        created_at: nowIso(),
      });
    },
    async getMapping(adapterId, id) {
      return mappingOf(tabular(adapterId), id);
    },
    async updateMapping(adapterId, id, patch) {
      const adapter = tabular(adapterId);
      const current = mappingOf(adapter, id);
      const next = { ...current, ...patch };
      if (
        patch.name !== undefined &&
        patch.name.toLowerCase() !== current.name.toLowerCase() &&
        repo.mappingByName(adapter.id, next.target, patch.name) !== null
      ) {
        throw conflict("a normalizer for that table already has that name", {
          name: patch.name,
          target: next.target,
        });
      }
      validateMapping(
        next,
        await tableOf(adapter, next.target),
        deps.policies.list(adapter.id, next.target)
      );
      const change: MappingPatch = {};
      for (const key of ["name", "target", "columns", "key_columns", "mode", "options"] as const) {
        if (patch[key] !== undefined) Object.assign(change, { [key]: patch[key] });
      }
      repo.updateMapping(current.id, change, nowIso());
      return mappingOf(adapter, id);
    },
    async removeMapping(adapterId, id) {
      repo.removeMapping(mappingOf(tabular(adapterId), id).id);
    },
    async run(actor, slug, request, meta) {
      const project = projectOf(slug);
      const adapter = tabular(request.adapter_id);
      if (adapter.project_id !== project.id) throw notFound("adapter");
      const mapping = mappingOf(adapter, request.mapping_id);
      if (!request.dry_run && adapter.mode !== "sandbox") {
        throw new AppError("ADAPTER_READ_ONLY", `${adapter.name} is read-only`, {
          adapter_id: adapter.id,
        });
      }
      const mode = request.mode ?? mapping.mode;
      const source = await sourcePath(project, request.source);
      const runId = Bun.randomUUIDv7();
      repo.insertRun({
        id: runId,
        project_id: project.id,
        adapter_id: adapter.id,
        mapping_id: mapping.id,
        job_id: "",
        source: sourceOf(request.source),
        dry_run: request.dry_run,
        mode,
        actor,
        created_at: nowIso(),
      });
      const enqueue: EnqueueInput = {
        kind: "import",
        projectId: project.id,
        adapterIds: [adapter.id],
        payload: {
          run_id: runId,
          adapter_id: adapter.id,
          mapping_id: mapping.id,
          source_path: source.path,
          source_upload_id: source.uploadId,
          mode: v.parse(importModeSchema, mode),
          dry_run: request.dry_run,
          stash_first: request.stash_first ?? mode === "replace",
          foreign_key_checks: request.foreign_key_checks,
          options: v.parse(jsonObjectSchema, JSON.parse(JSON.stringify(request.options ?? {}))),
        },
        actor,
        parentRequestId: meta.request_id,
      };
      const job = await deps.jobs.enqueue(enqueue);
      repo.setRunJob(runId, job.id);
      deps.audit.record({
        actor,
        action: "import.run",
        target_type: "import_run",
        target_id: runId,
        // The run itself has no name; the mapping it executes is what a person recognises.
        target_label: mapping.name,
        project: { id: project.id, slug: project.slug },
        adapter: { id: adapter.id, name: adapter.name },
        details: { mapping_id: mapping.id, mode, dry_run: request.dry_run },
        outcome: "succeeded",
        meta,
      });
      return job;
    },
    async listRuns(slug, filter) {
      return repo
        .runs(projectOf(slug).id, filter)
        .map(({ project_id: _project, rejected_path: _path, ...run }) => run);
    },
    async report(slug, runId) {
      const run = repo.run(projectOf(slug).id, runId);
      if (run === null) throw notFound("import run");
      const job = await deps.jobs.get(null, run.job_id).catch(() => null);
      const preview = v.safeParse(ERRORS_PREVIEW, job?.result?.["errors_preview"]);
      return { ...toReport(run), errors_preview: preview.success ? preview.output : [] };
    },
    async rejectedRows(slug, runId) {
      const run = repo.run(projectOf(slug).id, runId);
      if (run === null || run.rejected_path === null) throw notFound("rejected rows");
      const file = Bun.file(run.rejected_path);
      if (!(await file.exists())) throw notFound("rejected rows");
      return file.text();
    },
    sample: (adapterId, table, format, mappingId) =>
      files.sample(
        tabular(adapterId),
        table,
        format,
        mappingId === undefined ? null : mappingOf(tabular(adapterId), mappingId)
      ),
  };
}
