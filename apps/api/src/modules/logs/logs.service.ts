/**
 * The Logs tier's read side (#37, #69; docs/decisions/2026-10-10-logs-tier.md). One page of one
 * source of one `logs` adapter, masked for viewers and agents (Q5), and the same entries as a
 * download (S3). Nothing here writes: the tier has no write half.
 */
import { logfileConfigSchema } from "@testate/shared";
import type { Actor, LogEntry, LogsPage, LogsQuery, Project } from "@testate/shared";
import * as v from "valibot";

import type { FileSource } from "../../lib/files/index.ts";
import { AppError, notFound } from "../../lib/http/index.ts";
import type { RawEntry } from "../../lib/logs/chunk.ts";
import { createMasker, maskEntry } from "../../lib/logs/mask.ts";
import type { Masker } from "../../lib/logs/mask.ts";
import type { LogFile, LogFiles, SourceRead } from "../../lib/logs/read.ts";
import { readSource } from "../../lib/logs/source.ts";
import type { FilesResolver } from "../adapters/adapters.files.ts";
import { masksApply } from "../data/data.masks.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";

export type LogsDeps = {
  projects: Pick<ProjectsRepository, "bySlug">;
  files: FilesResolver;
};

/** What one read cost, for the request's wide event; never a line of the log itself. */
export type ReadStats = {
  source: string;
  files: number;
  bytes: number;
  entries: number;
  cutBy: string | null;
};
export type LogsAnswer = { page: LogsPage; stats: ReadStats; adapterName: string };

export type LogsService = {
  read(
    actor: Actor,
    slug: string,
    adapterId: string,
    query: LogsQuery,
    scope: string[] | null
  ): Promise<LogsAnswer>;
};

/** The directory listing and the ranged read the reader needs, over a file source. */
export function logFilesOf(source: FileSource): LogFiles {
  return {
    async list(dir) {
      const files: LogFile[] = [];
      let cursor: string | undefined;
      do {
        const page = await source
          .list(dir, cursor === undefined ? { limit: 1000 } : { limit: 1000, cursor })
          .catch((cause: unknown) => {
            // A log folder that does not exist yet holds no logs; anything else is a real failure.
            if (cause instanceof AppError && cause.code === "NOT_FOUND")
              return { data: [], next_cursor: null };
            throw cause;
          });
        for (const entry of page.data)
          if (entry.kind === "file")
            files.push({
              name: entry.name,
              path: entry.path,
              size: entry.size_bytes ?? 0,
              modified: entry.modified_at === null ? null : Date.parse(entry.modified_at),
            });
        cursor = page.next_cursor ?? undefined;
      } while (cursor !== undefined);
      return files;
    },
    // pm2 rotates on size, so a file listed a moment ago can be gone or shorter by the time it is
    // read. Gone reads as empty; shorter comes back short from the port.
    readRange: async (path, start, end) => {
      try {
        return await source.readRange(path, start, end);
      } catch (cause: unknown) {
        if (cause instanceof AppError && cause.code === "NOT_FOUND") return new Uint8Array();
        throw cause;
      }
    },
  };
}

function entryOf(raw: RawEntry, masker: Masker | null): LogEntry {
  const shown =
    masker === null
      ? { message: raw.message, fields: raw.fields, masked: false }
      : maskEntry(raw.message, raw.fields, masker);
  return { time: new Date(raw.time).toISOString(), level: raw.level, file: raw.file, ...shown };
}

function pageOf(read: SourceRead, masker: Masker | null): LogsPage {
  return {
    entries: read.entries.map((raw) => entryOf(raw, masker)),
    cursor: read.cursor,
    after: read.after,
    cut_by: read.cutBy,
    untimed: read.untimed,
  };
}

export function createLogsService(deps: LogsDeps): LogsService {
  const projectOf = (slug: string, scope: string[] | null): Project => {
    const project = deps.projects.bySlug(slug);
    if (project === null || (scope !== null && !scope.includes(project.id)))
      throw notFound("project");
    return project;
  };
  return {
    async read(actor, slug, adapterId, query, scope) {
      const project = projectOf(slug, scope);
      const trustAs = actor.kind === "user" ? actor.id : null;
      const { adapter, source } = await deps.files.resolve(project.id, adapterId, trustAs, "logs");
      try {
        const config = v.parse(logfileConfigSchema, adapter.config);
        const logSource = config.sources.find((candidate) => candidate.name === query.source);
        if (logSource === undefined) throw notFound("log source");
        const read = await readSource(logFilesOf(source), logSource, query);
        const masker = masksApply(actor) ? createMasker(logSource.patterns) : null;
        return {
          page: pageOf(read, masker),
          adapterName: adapter.name,
          stats: {
            source: logSource.name,
            files: read.filesOpened,
            bytes: read.bytesRead,
            entries: read.entries.length,
            cutBy: read.cutBy,
          },
        };
      } finally {
        await source.close();
      }
    },
  };
}
