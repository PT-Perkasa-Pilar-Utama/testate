import { createSignal, onCleanup, untrack } from "solid-js";
import type { LogEntry, LogSource, LogsPage } from "@testate/shared";
import { LOG_LINE_MAX } from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { logsModel } from "./logs.model.ts";
import type { LogsRequest } from "./logs.model.ts";

/** Q7: follow polls every 3 s with the `after` cursor; no stream. */
export const FOLLOW_MS = 3000;

/** `from` and `to` are ISO instants, "" when open; `level` is a floor, "" for every level. */
export type LogFilters = { source: string; from: string; to: string; level: string; text: string };

export type CutBy = LogsPage["cut_by"];

/**
 * `?source`, `?from` and `?to` open the viewer on one source and window: the "Logs during this
 * run" links (Q8). An unknown source falls back to the first.
 */
export function readLogQuery(search: string, sources: readonly LogSource[]): LogFilters {
  const params = new URLSearchParams(search);
  const asked = params.get("source") ?? "";
  const known = sources.some((source) => source.name === asked);
  return {
    source: known ? asked : (sources[0]?.name ?? ""),
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    level: "",
    text: "",
  };
}

/** Why a page stopped short, said once under the last entry (Q6); "" while older pages remain. */
const CUT = {
  lines: "",
  bytes: "Stopped at the 10 MB read ceiling for one request.",
  window: "Older entries fall outside the window.",
} as const;

export function endNote(cutBy: CutBy, more: boolean): string {
  if (cutBy !== null) return CUT[cutBy];
  return more ? "" : "The start of the log.";
}

export function requestOf(filters: LogFilters): LogsRequest {
  return {
    source: filters.source,
    from: filters.from,
    to: filters.to,
    level: filters.level,
    text: filters.text.trim(),
  };
}

export type LogViewer = {
  filters: () => LogFilters;
  setFilters: (patch: Partial<LogFilters>) => void;
  entries: () => LogEntry[];
  cutBy: () => CutBy;
  untimed: () => boolean;
  /** Whether older entries are left: the page came back with a cursor. */
  more: () => boolean;
  loading: () => boolean;
  error: () => string | null;
  older: () => Promise<void>;
  following: () => boolean;
  toggleFollow: () => void;
  downloadHref: () => string;
};

export function createLogViewer(
  slug: string,
  id: string,
  sources: readonly LogSource[],
  search: string
): LogViewer {
  const initial = readLogQuery(search, sources);
  const [filters, setFiltersSignal] = createSignal(initial);
  const [entries, setEntries] = createSignal<LogEntry[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [after, setAfter] = createSignal<string | null>(null);
  const [cutBy, setCutBy] = createSignal<CutBy>(null);
  const [untimed, setUntimed] = createSignal(false);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [following, setFollowing] = createSignal(false);
  // Writes apply on the next flush, so the request in flight is tracked here: a page that answers
  // after the filters moved on is dropped.
  let generation = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const read = async (current: LogFilters, extra: LogsRequest): Promise<LogsPage | null> => {
    const mine = generation;
    setError(null);
    try {
      const page = await logsModel.read(slug, id, { ...requestOf(current), ...extra });
      return mine === generation ? page : null;
    } catch (cause: unknown) {
      if (mine === generation) setError(humanMessage(cause, "The log could not be read"));
      return null;
    }
  };
  const load = async (current: LogFilters): Promise<void> => {
    generation += 1;
    setLoading(true);
    const page = await read(current, { source: current.source });
    setLoading(false);
    if (page === null) return;
    setEntries(page.entries);
    setCursor(page.cursor);
    setAfter(page.after);
    setCutBy(page.cut_by);
    setUntimed(page.untimed);
  };
  const poll = async (): Promise<void> => {
    const mark = after();
    if (document.hidden || mark === null) return;
    const page = await read(filters(), { source: filters().source, after: mark });
    if (page === null) return;
    // The `after` cursor resumes at each file's end mark, so a poll never repeats a line (25 §25.3).
    setEntries((shown) => [...page.entries, ...shown]);
    setAfter(page.after);
  };
  const stop = (): void => {
    clearInterval(timer);
    timer = undefined;
    setFollowing(false);
  };
  onCleanup(stop);
  // Not in the component's own scope: Solid 2 refuses a signal write there, and a read writes
  // `loading` before it awaits.
  queueMicrotask(() => void load(initial));

  return {
    filters,
    setFilters: (patch) => {
      // A snapshot on purpose: the viewer view also calls this from an effect.
      const next = { ...untrack(filters), ...patch };
      setFiltersSignal(next);
      void load(next);
    },
    entries,
    cutBy,
    untimed,
    more: () => cursor() !== null,
    loading,
    error,
    older: async () => {
      const back = cursor();
      if (back === null) return;
      const page = await read(filters(), { source: filters().source, cursor: back });
      if (page === null) return;
      setEntries((shown) => [...shown, ...page.entries]);
      setCursor(page.cursor);
      setCutBy(page.cut_by);
    },
    following,
    toggleFollow: () => {
      if (timer !== undefined) return stop();
      setFollowing(true);
      timer = setInterval(() => void poll(), FOLLOW_MS);
    },
    downloadHref: () =>
      logsModel.downloadUrl(slug, id, {
        ...requestOf(filters()),
        limit: Math.min(Math.max(entries().length, 1), LOG_LINE_MAX),
      }),
  };
}
