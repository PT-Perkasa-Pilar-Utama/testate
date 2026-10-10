/**
 * The Logs tier's read side (#37, #69; docs/decisions/2026-10-10-logs-tier.md). One page of one
 * source of one `logs` adapter, masked for viewers and agents (Q5), and the same entries as a
 * download (S3). Nothing here writes: the tier has no write half.
 */
import { logfileConfigSchema } from "@testate/shared";
import type { Actor, LogEntry, LogSource, LogsPage, LogsQuery, Project } from "@testate/shared";
import * as v from "valibot";

import type { FileSource } from "../../lib/files/index.ts";
import { AppError, notFound } from "../../lib/http/index.ts";
import type { RawEntry } from "../../lib/logs/chunk.ts";
import { createMasker, maskEntry } from "../../lib/logs/mask.ts";
import type { Masker } from "../../lib/logs/mask.ts";
import type { LogFile, LogFiles, SourceRead } from "../../lib/logs/read.ts";
import { readSource } from "../../lib/logs/source.ts";
import { isSourceName } from "../../lib/logs/ingest/line.ts";
import type { IngestStore } from "../../lib/logs/ingest/store.ts";
import { requireStorage } from "../adapters/adapters.files.ts";
import type { FilesResolver } from "../adapters/adapters.files.ts";
import type { AdapterRecord, AdaptersRepository } from "../adapters/adapters.repository.ts";
import { masksApply } from "../data/data.masks.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import { readableOf } from "./logs.server.ts";
import type { ServerLogReader } from "./logs.server.ts";
import type { DockerReader } from "./logs.docker.ts";
import type { JournalReader } from "./logs.journal.ts";
import type { LokiReader } from "./logs.loki.ts";
import type { EsReader } from "./logs.elasticsearch.ts";

export type LogsDeps = {
  projects: Pick<ProjectsRepository, "bySlug">;
  files: FilesResolver;
  adapters: Pick<AdaptersRepository, "byId">;
  /** An `ingest` adapter's lines are Testate's own, read from disk (#75, I2). */
  ingest: IngestStore;
  /** A database adapter's server logs, through its own connection (#84). */
  serverLogs: ServerLogReader;
  /** A `journald` adapter's journal, through its SSH login (#86). */
  journal: JournalReader;
  /** A `docker` adapter's container logs, through the Engine API (#88). */
  docker: DockerReader;
  /** A `loki` adapter's LogQL queries, through `query_range` (#90). */
  loki: LokiReader;
  /** An `elasticsearch` adapter's searches, through `_search` (#92). */
  elasticsearch: EsReader;
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
  /** A `logfile`'s configured source names, or the sources an `ingest` adapter holds. */
  sources(slug: string, adapterId: string, scope: string[] | null): Promise<string[]>;
};

/** The remote engines all name their configured sources (#86, #88, #90, #92). */
const namedSourcesSchema = v.object({ sources: v.array(v.object({ name: v.string() })) });

/** An unknown source names the ones there are, so a person or an agent can pick again. */
const unknownSource = (sources: string[]): AppError =>
  new AppError("NOT_FOUND", "log source not found", { sources });

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

/** One read's page and its cost, masked for viewers and agents (Q5). */
export function answerOf(
  read: SourceRead,
  source: Pick<LogSource, "name" | "patterns">,
  actor: Actor,
  adapterName: string
): LogsAnswer {
  const masker = masksApply(actor) ? createMasker(source.patterns) : null;
  return {
    page: pageOf(read, masker),
    adapterName,
    stats: {
      source: source.name,
      files: read.filesOpened,
      bytes: read.bytesRead,
      entries: read.entries.length,
      cutBy: read.cutBy,
    },
  };
}

/** An ingest source is a folder of `testate` day files, with the built-in masks only (I2). */
const ingestSource = (name: string): LogSource => ({
  name,
  glob: `${name}/*.jsonl`,
  format: "testate",
  patterns: [],
});

export function createLogsService(deps: LogsDeps): LogsService {
  /** The project's ingest adapter, or null for any other adapter id. */
  const ingestOf = (project: Project, adapterId: string): AdapterRecord | null => {
    const adapter = deps.adapters.byId(adapterId);
    return adapter?.project_id === project.id && adapter.engine === "ingest" ? adapter : null;
  };
  /** The engines read through a connection of their own rather than a file source. */
  const remote = new Map<string, JournalReader | DockerReader | LokiReader | EsReader>([
    ["journald", deps.journal],
    ["docker", deps.docker],
    ["loki", deps.loki],
    ["elasticsearch", deps.elasticsearch],
  ]);
  /** The project's journald, docker, loki or elasticsearch adapter, or null for any other adapter id. */
  const remoteOf = (project: Project, adapterId: string): AdapterRecord | null => {
    const adapter = deps.adapters.byId(adapterId);
    return adapter?.project_id === project.id && remote.has(adapter.engine) ? adapter : null;
  };
  /** The project's database adapter, or null for any other adapter id. */
  const databaseOf = (project: Project, adapterId: string): AdapterRecord | null => {
    const adapter = deps.adapters.byId(adapterId);
    return adapter?.project_id === project.id && adapter.kind === "database" ? adapter : null;
  };
  const readIngest = async (
    actor: Actor,
    adapter: AdapterRecord,
    query: LogsQuery
  ): Promise<LogsAnswer> => {
    const held = await deps.ingest.sources(adapter.id);
    if (!isSourceName(query.source) || !held.includes(query.source)) throw unknownSource(held);
    const source = ingestSource(query.source);
    const read = await readSource(deps.ingest.files(adapter.id), source, query);
    return answerOf(read, source, actor, adapter.name);
  };
  const projectOf = (slug: string, scope: string[] | null): Project => {
    const project = deps.projects.bySlug(slug);
    if (project === null || (scope !== null && !scope.includes(project.id)))
      throw notFound("project");
    return project;
  };
  return {
    async read(actor, slug, adapterId, query, scope) {
      const project = projectOf(slug, scope);
      const ingest = ingestOf(project, adapterId);
      if (ingest !== null) return readIngest(actor, ingest, query);
      const database = databaseOf(project, adapterId);
      if (database !== null) return deps.serverLogs(actor, database, query);
      const own = remoteOf(project, adapterId);
      const reader = own === null ? undefined : remote.get(own.engine);
      if (own !== null && reader !== undefined) return reader(actor, own, query);
      const trustAs = actor.kind === "user" ? actor.id : null;
      const { adapter, source } = await deps.files.resolve(project.id, adapterId, trustAs, "logs");
      try {
        const config = v.parse(logfileConfigSchema, adapter.config);
        const logSource = config.sources.find((candidate) => candidate.name === query.source);
        if (logSource === undefined) throw unknownSource(config.sources.map((item) => item.name));
        const read = await readSource(logFilesOf(source), logSource, query);
        return answerOf(read, logSource, actor, adapter.name);
      } finally {
        await source.close();
      }
    },
    async sources(slug, adapterId, scope) {
      const project = projectOf(slug, scope);
      const ingest = ingestOf(project, adapterId);
      if (ingest !== null) return deps.ingest.sources(ingest.id);
      const database = databaseOf(project, adapterId);
      if (database !== null) return readableOf(database);
      const own = remoteOf(project, adapterId);
      if (own !== null)
        return v.parse(namedSourcesSchema, own.config).sources.map((item) => item.name);
      const adapter = requireStorage(deps.adapters.byId(adapterId), project.id, "logs");
      return v.parse(logfileConfigSchema, adapter.config).sources.map((item) => item.name);
    },
  };
}
