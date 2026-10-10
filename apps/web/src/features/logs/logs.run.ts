import type { AdapterWithProject } from "@testate/shared";
import { LOG_WINDOW_MAX_MS } from "@testate/shared";

import { sourcesOf } from "./logs.model.ts";

const MINUTE = 60_000;

/** `to` is null while the run is still going: the viewer then reads up to now. */
export type RunWindow = { from: string; to: string | null };

/**
 * Q8 (docs/decisions/2026-10-10-logs-tier.md): a run's logs are from a minute before it started
 * to five minutes after it ended, cut to the 7-day window the API allows.
 */
export function runWindow(startedAt: string, finishedAt: string | null): RunWindow {
  const start = Date.parse(startedAt) - MINUTE;
  if (finishedAt === null) return { from: new Date(start).toISOString(), to: null };
  const end = Date.parse(finishedAt) + 5 * MINUTE;
  return {
    from: new Date(Math.max(start, end - LOG_WINDOW_MAX_MS)).toISOString(),
    to: new Date(end).toISOString(),
  };
}

/** The adapter page, opened on its first source over the run's window. */
export function runLink(
  adapter: Pick<AdapterWithProject, "id" | "project_slug" | "config" | "capabilities">,
  window: RunWindow
): string {
  const params = new URLSearchParams({
    source: sourcesOf(adapter)[0]?.name ?? adapter.capabilities?.serverLogs[0] ?? "",
    from: window.from,
  });
  if (window.to !== null) params.set("to", window.to);
  return `/projects/${encodeURIComponent(adapter.project_slug)}/adapters/${encodeURIComponent(adapter.id)}?${params.toString()}`;
}
