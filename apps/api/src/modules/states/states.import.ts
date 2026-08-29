import { rmSync } from "node:fs";
import { dirname } from "node:path";
import * as v from "valibot";

import type { BlobStore } from "../../lib/blobstore/index.ts";
import { AppError, notFound } from "../../lib/http/index.ts";
import type { AdaptersRepository } from "../adapters/adapters.repository.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { ImportsRepository } from "../imports/imports.repository.ts";
import type { JobRunner } from "../jobs/jobs.dispatcher.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import { readArchive } from "./states.archive.ts";
import type { ArchiveContents } from "./states.archive.ts";
import type { AdapterManifest, StatesRepository } from "./states.repository.ts";

export type ArchiveImportDeps = {
  states: StatesRepository;
  uploads: Pick<ImportsRepository, "upload" | "removeUpload">;
  adapters: Pick<AdaptersRepository, "byId">;
  projects: Pick<ProjectsRepository, "byId">;
  blobs: BlobStore;
  audit: AuditService;
  now: () => Date;
};

export const archiveImportPayloadSchema = v.object({
  state_id: v.string(),
  upload_id: v.string(),
  mapping: v.array(v.object({ archive_adapter_id: v.string(), adapter_id: v.string() })),
});

type Mapping = v.InferOutput<typeof archiveImportPayloadSchema>["mapping"];

/** Archive adapters land on existing adapters of the same engine; every blob must be in the tar. */
function resolveManifests(
  deps: ArchiveImportDeps,
  archive: ArchiveContents,
  mapping: Mapping
): AdapterManifest[] {
  const manifests: AdapterManifest[] = [];
  for (const item of mapping) {
    const source = archive.adapters.get(item.archive_adapter_id);
    const adapter = deps.adapters.byId(item.adapter_id);
    if (source === undefined || adapter === null) throw notFound("adapter");
    if (adapter.engine !== source.engine) {
      throw new AppError(
        "VALIDATION_ERROR",
        `${adapter.name} is ${adapter.engine}, the archive adapter is ${source.engine}`,
        { adapter_id: adapter.id }
      );
    }
    const missing = source.tables.find((table) => !archive.blobs.has(table.blob_hash));
    if (missing !== undefined) {
      throw new AppError(
        "VALIDATION_ERROR",
        `blob ${missing.blob_hash} is missing from the archive`,
        { table: missing.name }
      );
    }
    manifests.push({ ...source, adapter_id: adapter.id, adapter_name: adapter.name });
  }
  return manifests;
}

/**
 * The `archive_import` job (08 §8.9, 15 §15.5): every blob is stored with its expected hash before
 * any manifest row exists, then the state commits with the mapped adapter ids.
 */
export function createArchiveImportRunner(deps: ArchiveImportDeps): JobRunner {
  return async ({ job, progress }) => {
    const payload = v.parse(archiveImportPayloadSchema, job.payload);
    const projectId = job.project_id ?? "";
    const upload = deps.uploads.upload(payload.upload_id);
    if (upload === null) throw notFound("upload");
    try {
      const archive = readArchive(new Uint8Array(await Bun.file(upload.path).arrayBuffer()));
      progress({ phase: "verify", blobs: archive.blobs.size });
      for (const [hash, bytes] of archive.blobs) {
        const put = await deps.blobs.put(new Blob([bytes]).stream(), { expectedHash: hash });
        deps.states.recordBlob(put.hash, put.size, job.id, deps.now().toISOString());
      }
      const manifests = resolveManifests(deps, archive, payload.mapping);
      const size = deps.states.commitManifest(
        payload.state_id,
        manifests,
        deps.now().toISOString()
      );
      deps.audit.record({
        actor: job.actor,
        action: "state.imported",
        target_type: "state",
        target_id: payload.state_id,
        project: { id: projectId, slug: deps.projects.byId(projectId)?.slug ?? "" },
        details: { upload_id: payload.upload_id, adapters: manifests.length, size_bytes: size },
        outcome: "succeeded",
      });
      return {
        status: "succeeded",
        result: { state_id: payload.state_id, adapters: manifests.length, size_bytes: size },
      };
    } catch (cause: unknown) {
      deps.states.setStatus(payload.state_id, "failed", deps.now().toISOString());
      throw cause;
    } finally {
      deps.states.releasePins(job.id);
      deps.uploads.removeUpload(upload.upload_id);
      rmSync(dirname(upload.path), { recursive: true, force: true });
    }
  };
}
