/**
 * Resource readings (#38, docs/decisions/2026-10-11-resource-readings.md): one point-in-time
 * reading of every readable adapter in a project, stored as one row. The adapters read in
 * parallel, each under its own timeout; one that fails is unavailable, and the reading saves.
 */
import type { Actor, Project, Reading, ReadingAdapter } from "@testate/shared";
import * as v from "valibot";

import { notFound } from "../../lib/http/index.ts";
import { reasonOf } from "../../lib/resources/read.ts";
import type { ResourceRead } from "../../lib/resources/read.ts";
import type { AdapterRecord, AdaptersRepository } from "../adapters/adapters.repository.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import type { ReadingsPage, ReadingsRepository } from "./readings.repository.ts";

const DATABASE_ENGINES = new Set(["postgres", "mysql", "mariadb", "mongodb"]);
const overSftp = v.object({ transport: v.literal("sftp") });

/** Which source an adapter answers, or null when it has none (Q3). */
export function sourceOf(adapter: AdapterRecord): ReadingAdapter["source"] | null {
  if (adapter.kind === "database" && DATABASE_ENGINES.has(adapter.engine)) return "server";
  if (adapter.kind === "storage" && adapter.engine === "sftp") return "host";
  if (adapter.engine === "logfile" && v.is(overSftp, adapter.config)) return "host";
  return null;
}

export type ReadingStats = { adapters: number; values: number; unavailable: number; ms: number };

export type ReadingsService = {
  take(actor: Actor, slug: string): Promise<{ reading: Reading; stats: ReadingStats }>;
  list(slug: string, limit: number, cursor?: string): Promise<ReadingsPage>;
  get(slug: string, id: string): Promise<Reading>;
  /** Deletes readings older than `days`, with the job history (Q9). */
  sweep(days: number): number;
};

export type ReadingsDeps = {
  repo: ReadingsRepository;
  projects: Pick<ProjectsRepository, "bySlug">;
  adapters: Pick<AdaptersRepository, "list">;
  /** A database adapter's server counters, through its engine. */
  readServer(adapter: AdapterRecord): Promise<ResourceRead>;
  /** An SFTP login's host; `trustAs` may trust a first-seen host key, as browsing does. */
  readHost(adapter: AdapterRecord, trustAs: string | null): Promise<ResourceRead>;
  now: () => Date;
  timeoutMs?: number;
};

const TIMEOUT_MS = 15_000;
const DAY_MS = 86_400_000;

function withTimeout<T>(run: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms / 1000} s`)), ms);
  });
  return Promise.race([run, late]).finally(() => clearTimeout(timer));
}

export function createReadingsService(deps: ReadingsDeps): ReadingsService {
  const projectOf = (slug: string): Project => {
    const project = deps.projects.bySlug(slug);
    if (project === null) throw notFound("project");
    return project;
  };
  const readOne = async (
    adapter: AdapterRecord,
    source: ReadingAdapter["source"],
    trustAs: string | null
  ): Promise<ReadingAdapter> => {
    const base = { adapter_id: adapter.id, name: adapter.name, engine: adapter.engine, source };
    try {
      const run = source === "server" ? deps.readServer(adapter) : deps.readHost(adapter, trustAs);
      return { ...base, ...(await withTimeout(run, deps.timeoutMs ?? TIMEOUT_MS)) };
    } catch (cause: unknown) {
      // Nothing was read: the login, the network or the timeout refused the whole adapter.
      return { ...base, values: [], unavailable: [{ key: "adapter", reason: reasonOf(cause) }] };
    }
  };
  return {
    async take(actor, slug) {
      const started = deps.now().getTime();
      const project = projectOf(slug);
      const trustAs = actor.kind === "user" ? actor.id : null;
      const readable = deps.adapters.list(project.id, {}).flatMap((adapter) => {
        const source = sourceOf(adapter);
        return source === null ? [] : [{ adapter, source }];
      });
      const adapters = await Promise.all(
        readable.map(({ adapter, source }) => readOne(adapter, source, trustAs))
      );
      const reading: Reading = {
        id: Bun.randomUUIDv7(),
        taken_at: deps.now().toISOString(),
        actor: { kind: actor.kind, label: actor.label },
        adapters,
      };
      deps.repo.insert({ ...reading, project_id: project.id, actor_id: actor.id });
      const stats = {
        adapters: adapters.length,
        values: adapters.reduce((sum, item) => sum + item.values.length, 0),
        unavailable: adapters.reduce((sum, item) => sum + item.unavailable.length, 0),
        ms: deps.now().getTime() - started,
      };
      return { reading, stats };
    },
    async list(slug, limit, cursor) {
      return deps.repo.list(projectOf(slug).id, limit, cursor);
    },
    async get(slug, id) {
      const found = deps.repo.byId(projectOf(slug).id, id);
      if (found === null) throw notFound("reading");
      return found;
    },
    sweep(days) {
      return deps.repo.sweep(new Date(deps.now().getTime() - days * DAY_MS).toISOString());
    },
  };
}
