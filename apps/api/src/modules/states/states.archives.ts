import type {
  Actor,
  ArchiveManifest,
  Job,
  Project,
  State,
  Adapter,
  AdapterDraft,
} from "@testate/shared";
import type { importArchiveSchema } from "@testate/shared";
import type * as v from "valibot";

import type { BlobStore } from "../../lib/blobstore/index.ts";
import { AppError, conflict, notFound } from "../../lib/http/index.ts";
import type { RequestMeta } from "../../lib/http/auth.ts";
import type { AdaptersRepository } from "../adapters/adapters.repository.ts";
import type { ImportsRepository } from "../imports/imports.repository.ts";
import type { JobsService } from "../jobs/jobs.service.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import { readArchive, writeArchive } from "./states.archive.ts";
import type { StatesRepository } from "./states.repository.ts";

export type ImportArchiveInput = v.InferOutput<typeof importArchiveSchema>;

export type ArchiveDeps = {
  repo: StatesRepository;
  projects: Pick<ProjectsRepository, "usedBytes">;
  adapters: Pick<AdaptersRepository, "byId">;
  jobs: Pick<JobsService, "enqueue">;
  blobs: BlobStore;
  uploads: Pick<ImportsRepository, "upload">;
  now: () => Date;
  /** Creates a new adapter for a `target.create` mapping (08 §8.9); absent in builds without the adapters service. */
  createAdapter?: (
    actor: Actor,
    project: Project,
    draft: AdapterDraft,
    meta: RequestMeta
  ) => Promise<Adapter>;
  find: (project: Project, idOrName: string) => State;
  assertNameFree: (project: Project, name: string) => void;
  record: (
    actor: Actor,
    action: string,
    project: Project,
    state: State,
    meta: RequestMeta,
    details?: Record<string, string | number | boolean | null>
  ) => void;
};

export type ArchiveOps = {
  archive(
    project: Project,
    idOrName: string
  ): Promise<{ state: State; body: ReadableStream<Uint8Array> }>;
  manifest(project: Project, uploadId: string): Promise<ArchiveManifest>;
  importArchive(
    actor: Actor,
    project: Project,
    input: ImportArchiveInput,
    meta: RequestMeta
  ): Promise<Job>;
};

type Mapped = { archive_adapter_id: string; adapter_id: string };

/** Download, upload manifest, and import of state archives (08 §8.7-8.9, 15 §15.5). */
export function createArchiveOps(deps: ArchiveDeps): ArchiveOps {
  const nowIso = (): string => deps.now().toISOString();
  const manifestOf = async (project: Project, uploadId: string): Promise<ArchiveManifest> => {
    const upload = deps.uploads.upload(uploadId);
    if (upload === null || upload.project_id !== project.id) throw notFound("upload");
    if (upload.type !== "tar")
      throw new AppError("VALIDATION_ERROR", "the upload is not a tar archive");
    return readArchive(new Uint8Array(await Bun.file(upload.path).arrayBuffer())).manifest;
  };
  /** `target.create` makes the adapter first (with its own init state), then maps like an existing one. */
  const mapOne = async (
    actor: Actor,
    project: Project,
    archive: ArchiveManifest,
    item: ImportArchiveInput["adapter_mapping"][number],
    meta: RequestMeta
  ): Promise<Mapped> => {
    const source = archive.adapters.find(
      (entry) => entry.archive_adapter_id === item.archive_adapter_id
    );
    if (source === undefined) throw notFound("adapter");
    if ("create" in item.target) {
      if (deps.createAdapter === undefined)
        throw new AppError(
          "ENGINE_UNSUPPORTED",
          "this build cannot create adapters from an archive",
          {
            reason: "create",
          }
        );
      if (item.target.create.engine !== source.engine)
        throw new AppError(
          "VALIDATION_ERROR",
          `${item.target.create.name} is ${item.target.create.engine}, the archive adapter is ${source.engine}`
        );
      const created = await deps.createAdapter(actor, project, item.target.create, meta);
      return { archive_adapter_id: item.archive_adapter_id, adapter_id: created.id };
    }
    const adapter = deps.adapters.byId(item.target.adapter_id);
    if (adapter === null || adapter.project_id !== project.id) throw notFound("adapter");
    if (adapter.engine !== source.engine) {
      throw new AppError(
        "VALIDATION_ERROR",
        `${adapter.name} is ${adapter.engine}, the archive adapter is ${source.engine}`
      );
    }
    return { archive_adapter_id: item.archive_adapter_id, adapter_id: adapter.id };
  };
  return {
    async archive(project, idOrName) {
      const state = deps.find(project, idOrName);
      if (state.status !== "ready") throw conflict("state is not ready", { status: state.status });
      return { state, body: writeArchive(state, deps.repo.manifestsOf(state.id), deps.blobs) };
    },
    manifest: manifestOf,
    async importArchive(actor, project, input, meta) {
      deps.assertNameFree(project, input.name);
      if (
        project.quota_bytes !== null &&
        deps.projects.usedBytes(project.id) >= project.quota_bytes
      ) {
        throw new AppError("QUOTA_EXCEEDED", "the project is at its storage quota");
      }
      const archive = await manifestOf(project, input.upload_id);
      const mapping: Mapped[] = [];
      for (const item of input.adapter_mapping)
        mapping.push(await mapOne(actor, project, archive, item, meta));
      if (mapping.length === 0)
        throw new AppError("VALIDATION_ERROR", "map each database in the archive to one here");
      const stateId = Bun.randomUUIDv7();
      deps.repo.insert({
        id: stateId,
        project_id: project.id,
        name: input.name,
        kind: "manual",
        protected: false,
        parent_state_id: null,
        job_id: "",
        actor,
        created_at: nowIso(),
      });
      deps.repo.update(stateId, { notes: archive.state.notes, tags: archive.state.tags }, nowIso());
      let job: Job;
      try {
        job = await deps.jobs.enqueue({
          kind: "archive_import",
          projectId: project.id,
          adapterIds: [],
          payload: { state_id: stateId, upload_id: input.upload_id, mapping },
          actor,
          parentRequestId: meta.request_id,
        });
      } catch (cause: unknown) {
        deps.repo.remove(stateId);
        throw cause;
      }
      deps.repo.update(stateId, { job_id: job.id }, nowIso());
      deps.record(actor, "state.import_requested", project, deps.find(project, stateId), meta, {
        upload_id: input.upload_id,
      });
      return job;
    },
  };
}
