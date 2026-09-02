import type { Actor, Entry, JsonObject, Project } from "@testate/shared";

import type { FileSource, ListPage } from "../../lib/files/index.ts";
import { nameOf, normalizePath } from "../../lib/files/index.ts";
import type { RequestMeta } from "../../lib/http/auth.ts";
import { AppError, notFound } from "../../lib/http/index.ts";
import type { FilesResolver, ResolvedFiles } from "../adapters/adapters.files.ts";
import type { HostKeysRepository } from "../adapters/adapters.hostkeys.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import { collectCapped, renderPreview, tooLarge, PREVIEW_CAP_BYTES } from "./storage.preview.ts";
import type { PreviewResult } from "./storage.preview.ts";
import { createStorageWrites } from "./storage.write.ts";
import type { StorageWrites } from "./storage.write.ts";

export type StorageDeps = {
  projects: Pick<ProjectsRepository, "bySlug">;
  files: FilesResolver;
  hostKeys: HostKeysRepository;
  audit: AuditService;
  now: () => Date;
};

export type EntriesQuery = { path?: string; cursor?: string; limit?: number; q?: string };
export type Download = {
  stream: ReadableStream<Uint8Array>;
  name: string;
  size: number | null;
};

export type StorageService = StorageWrites & {
  list(actor: Actor, slug: string, adapterId: string, query: EntriesQuery): Promise<ListPage>;
  stat(actor: Actor, slug: string, adapterId: string, path: string): Promise<Entry>;
  preview(actor: Actor, slug: string, adapterId: string, path: string): Promise<PreviewResult>;
  download(actor: Actor, slug: string, adapterId: string, path: string): Promise<Download>;
  acceptHostKey(
    actor: Actor,
    slug: string,
    adapterId: string,
    fingerprint: string,
    meta: RequestMeta
  ): Promise<void>;
};

const LIMIT_DEFAULT = 200;
const LIMIT_MAX = 1000;

/** Closes the source once the stream ends or is cancelled. */
function closing(
  stream: ReadableStream<Uint8Array>,
  close: () => Promise<void>
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        await close();
        return;
      }
      controller.enqueue(value);
    },
    async cancel(reason) {
      await reader.cancel(reason);
      await close();
    },
  });
}

async function requireFile(source: FileSource, path: string): Promise<Entry> {
  const entry = await source.stat(path);
  if (entry.kind !== "file") throw new AppError("VALIDATION_ERROR", "directories have no preview");
  return entry;
}

/**
 * Browsing and, on a sandbox adapter, changing files over `resolveFiles` (05 §5.11).
 *
 * The role is checked by the route (`requireRole("qa")`) or by the MCP tool; the adapter's mode is
 * checked here, once, so both paths refuse the same targets for the same reason. It is the rule a
 * database already lives by: an admin decides which adapters may be written, and a tester writes.
 */
export function createStorageService(deps: StorageDeps): StorageService {
  const projectOf = (slug: string): Project => {
    const project = deps.projects.bySlug(slug);
    if (project === null) throw notFound("project");
    return project;
  };
  const trustAs = (actor: Actor): string | null => (actor.kind === "user" ? actor.id : null);
  const open = (actor: Actor, slug: string, adapterId: string): Promise<ResolvedFiles> =>
    deps.files.resolve(projectOf(slug).id, adapterId, trustAs(actor));
  const withSource = async <T>(
    actor: Actor,
    slug: string,
    adapterId: string,
    run: (source: FileSource) => Promise<T>
  ): Promise<T> => {
    const { source } = await open(actor, slug, adapterId);
    try {
      return await run(source);
    } finally {
      await source.close();
    }
  };
  /**
   * The source of an adapter a write may reach.
   *
   * `read_only` is the default and it is not an oversight: an adapter has to be loosened on
   * purpose, by an admin, before a tester can put a file in it or take one out.
   */
  const writable = async (
    actor: Actor,
    slug: string,
    adapterId: string
  ): Promise<ResolvedFiles> => {
    const resolved = await open(actor, slug, adapterId);
    if (resolved.adapter.mode !== "sandbox") {
      await resolved.source.close();
      throw new AppError("ADAPTER_READ_ONLY", `${resolved.adapter.name} is read-only`, {
        adapter_id: resolved.adapter.id,
      });
    }
    return resolved;
  };
  const record = (
    actor: Actor,
    action: string,
    adapter: ResolvedFiles["adapter"],
    slug: string,
    path: string,
    details: JsonObject,
    meta: RequestMeta
  ): void =>
    deps.audit.record({
      actor,
      action,
      target_type: "file",
      target_id: `${adapter.id}:${path}`,
      target_label: path,
      project: { id: projectOf(slug).id, slug },
      adapter: { id: adapter.id, name: adapter.name },
      details,
      outcome: "succeeded",
      meta,
    });
  return {
    list: (actor, slug, adapterId, query) =>
      withSource(actor, slug, adapterId, (source) => {
        const page = { limit: Math.min(query.limit ?? LIMIT_DEFAULT, LIMIT_MAX) };
        const listQuery = query.q === undefined ? page : { ...page, q: query.q };
        return source.list(
          normalizePath(query.path),
          query.cursor === undefined ? listQuery : { ...listQuery, cursor: query.cursor }
        );
      }),
    stat: (actor, slug, adapterId, path) =>
      withSource(actor, slug, adapterId, (source) => source.stat(normalizePath(path))),
    preview: (actor, slug, adapterId, path) =>
      withSource(actor, slug, adapterId, async (source) => {
        const clean = normalizePath(path);
        const entry = await requireFile(source, clean);
        if (entry.size_bytes !== null && entry.size_bytes > PREVIEW_CAP_BYTES)
          throw tooLarge(entry.size_bytes);
        return renderPreview(entry.name, await collectCapped(await source.read(clean)));
      }),
    async download(actor, slug, adapterId, path) {
      const { source } = await open(actor, slug, adapterId);
      try {
        const clean = normalizePath(path);
        const entry = await requireFile(source, clean);
        return {
          stream: closing(await source.read(clean), () => source.close()),
          name: nameOf(clean),
          size: entry.size_bytes,
        };
      } catch (cause: unknown) {
        await source.close();
        throw cause;
      }
    },
    ...createStorageWrites({ writable, record }),
    async acceptHostKey(actor, slug, adapterId, fingerprint, meta) {
      const project = projectOf(slug);
      const resolved = await deps.files.resolve(project.id, adapterId, null);
      if (resolved.adapter.engine !== "sftp")
        throw new AppError("VALIDATION_ERROR", "only SFTP adapters have a host key");
      try {
        await resolved.source.list("", { limit: 1 }).catch((cause: unknown) => {
          if (!(cause instanceof AppError && cause.code === "CONFLICT")) throw cause;
        });
      } finally {
        await resolved.source.close();
      }
      const live = resolved.presented();
      if (live === null || live.fingerprint !== fingerprint)
        throw new AppError("VALIDATION_ERROR", "fingerprint does not match the server's key", {
          presented: live?.fingerprint ?? null,
        });
      deps.hostKeys.replace(adapterId, {
        key_type: live.type,
        fingerprint: live.fingerprint,
        accepted_by: actor.id,
        accepted_at: deps.now().toISOString(),
      });
      deps.audit.record({
        actor,
        action: "host_key.accepted",
        target_type: "adapter",
        target_id: adapterId,
        target_label: resolved.adapter.name,
        project: { id: project.id, slug: project.slug },
        adapter: { id: adapterId, name: resolved.adapter.name },
        details: { fingerprint: live.fingerprint, key_type: live.type },
        outcome: "succeeded",
        meta,
      });
    },
  };
}
