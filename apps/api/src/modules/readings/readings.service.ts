/**
 * Resource readings (#38, docs/decisions/2026-10-11-resource-readings.md): one point-in-time
 * reading of every readable adapter in a project, stored as one row. The adapters read in
 * parallel, each under its own timeout; one that fails is unavailable, and the reading saves.
 * The monitor polls the same reading on a timer and draws the rows as a series (#101).
 */
import type {
  Actor,
  Project,
  Reading,
  ReadingAdapter,
  ReadingSeries,
  ReadingSource,
} from "@testate/shared";
import { SERIES_MAX_POINTS } from "@testate/shared";
import * as v from "valibot";

import { AppError, notFound } from "../../lib/http/index.ts";
import { reasonOf } from "../../lib/resources/read.ts";
import type { ResourceRead } from "../../lib/resources/read.ts";
import type { AdapterRecord, AdaptersRepository } from "../adapters/adapters.repository.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import type { ReadingsPage, ReadingsRepository, SeriesWindow } from "./readings.repository.ts";

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

/** Unset `from` is an hour before `to`; unset `to` is now; unset `step` gives about 300 points. */
export type SeriesQuery = { from?: string; to?: string; step?: number };

export type ReadingsService = {
  take(actor: Actor, slug: string): Promise<{ reading: Reading; stats: ReadingStats }>;
  /** The monitor's reading of one project: as Testate, over kept connections, never audited. */
  poll(projectId: string): Promise<ReadingStats | null>;
  /** Projects with an adapter, which `poll` narrows with `sourceOf`, and every adapter id. */
  targets(): { projectIds: string[]; adapterIds: Set<string> };
  list(slug: string, limit: number, cursor?: string): Promise<ReadingsPage>;
  get(slug: string, id: string): Promise<Reading>;
  series(slug: string, query: SeriesQuery): Promise<ReadingSeries>;
  /** Deletes readings of `source` older than `days`: the job history for manual, monitor days for polled. */
  sweep(source: ReadingSource, days: number): number;
};

export type ReadingsDeps = {
  repo: ReadingsRepository;
  projects: Pick<ProjectsRepository, "bySlug" | "byId">;
  adapters: Pick<AdaptersRepository, "list">;
  /** A database adapter's server counters, through its engine. */
  readServer(adapter: AdapterRecord): Promise<ResourceRead>;
  /**
   * An SFTP login's host; `trustAs` may trust a first-seen host key, as browsing does. `keep`
   * holds the connection open for the next tick instead of closing it.
   */
  readHost(adapter: AdapterRecord, trustAs: string | null, keep: boolean): Promise<ResourceRead>;
  now: () => Date;
  timeoutMs?: number;
};

const TIMEOUT_MS = 15_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const SYSTEM = { kind: "system", id: null, label: "Testate" } as const;

type Taker = { kind: Reading["actor"]["kind"]; id: string | null; label: string };
type Take = { project: Project; by: Taker; source: ReadingSource; trustAs: string | null };

/** The window as `toISOString()` writes it, so it compares with `taken_at` as text. */
function windowOf(query: SeriesQuery, now: Date): SeriesWindow {
  const to = query.to === undefined ? now.getTime() : Date.parse(query.to);
  const from = query.from === undefined ? to - HOUR_MS : Date.parse(query.from);
  if (!(from < to)) throw new AppError("VALIDATION_ERROR", "from must be before to");
  const step = query.step ?? Math.max(1, Math.ceil((to - from) / 1000 / 300));
  if ((to - from) / 1000 / step > SERIES_MAX_POINTS)
    throw new AppError(
      "VALIDATION_ERROR",
      `that window holds more than ${SERIES_MAX_POINTS} steps; ask for a longer step`
    );
  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    stepSeconds: step,
  };
}

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
    take: Take
  ): Promise<ReadingAdapter> => {
    const base = { adapter_id: adapter.id, name: adapter.name, engine: adapter.engine, source };
    const keep = take.source === "poll";
    try {
      const run =
        source === "server" ? deps.readServer(adapter) : deps.readHost(adapter, take.trustAs, keep);
      return { ...base, ...(await withTimeout(run, deps.timeoutMs ?? TIMEOUT_MS)) };
    } catch (cause: unknown) {
      // Nothing was read: the login, the network or the timeout refused the whole adapter.
      return { ...base, values: [], unavailable: [{ key: "adapter", reason: reasonOf(cause) }] };
    }
  };
  const record = async (take: Take): Promise<{ reading: Reading; stats: ReadingStats }> => {
    const started = deps.now().getTime();
    const readable = deps.adapters.list(take.project.id, {}).flatMap((adapter) => {
      const source = sourceOf(adapter);
      return source === null ? [] : [{ adapter, source }];
    });
    const adapters = await Promise.all(
      readable.map(({ adapter, source }) => readOne(adapter, source, take))
    );
    const reading: Reading = {
      id: Bun.randomUUIDv7(),
      taken_at: deps.now().toISOString(),
      source: take.source,
      actor: { kind: take.by.kind, label: take.by.label },
      adapters,
    };
    deps.repo.insert({ ...reading, project_id: take.project.id, actor_id: take.by.id });
    const stats = {
      adapters: adapters.length,
      values: adapters.reduce((sum, item) => sum + item.values.length, 0),
      unavailable: adapters.reduce((sum, item) => sum + item.unavailable.length, 0),
      ms: deps.now().getTime() - started,
    };
    return { reading, stats };
  };
  return {
    async take(actor, slug) {
      const by = { kind: actor.kind, id: actor.id, label: actor.label };
      const trustAs = actor.kind === "user" ? actor.id : null;
      return record({ project: projectOf(slug), by, source: "manual", trustAs });
    },
    async poll(projectId) {
      const project = deps.projects.byId(projectId);
      if (project === null) return null;
      if (!deps.adapters.list(project.id, {}).some((adapter) => sourceOf(adapter) !== null))
        return null;
      return (await record({ project, by: SYSTEM, source: "poll", trustAs: null })).stats;
    },
    targets() {
      const rows = deps.repo.targets();
      return {
        projectIds: [...new Set(rows.map((row) => row.project_id))],
        adapterIds: new Set(rows.map((row) => row.id)),
      };
    },
    async list(slug, limit, cursor) {
      return deps.repo.list(projectOf(slug).id, limit, cursor);
    },
    async get(slug, id) {
      const found = deps.repo.byId(projectOf(slug).id, id);
      if (found === null) throw notFound("reading");
      return found;
    },
    async series(slug, query) {
      const project = projectOf(slug);
      const window = windowOf(query, deps.now());
      const lines = deps.repo.series(project.id, window);
      return { from: window.from, to: window.to, step_seconds: window.stepSeconds, lines };
    },
    sweep(source, days) {
      const cutoff = new Date(deps.now().getTime() - days * DAY_MS).toISOString();
      return deps.repo.sweep(source, cutoff);
    },
  };
}
