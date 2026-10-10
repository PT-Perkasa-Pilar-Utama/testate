import * as v from "valibot";
import type { Adapter, AdapterWithProject, LogSource, LogsPage } from "@testate/shared";
import { adapterWithProjectSchema, logfileConfigSchema, logsPageSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";
import type { Query } from "@/lib/api-client.ts";

/** What the viewer asks for; empty filters are left off the request. */
export type LogsRequest = {
  source: string;
  from?: string | undefined;
  to?: string | undefined;
  level?: string | undefined;
  text?: string | undefined;
  cursor?: string | undefined;
  after?: string | undefined;
  limit?: number | undefined;
};

const logsPath = (slug: string, id: string): string =>
  `/projects/${encodeURIComponent(slug)}/adapters/${encodeURIComponent(id)}/logs`;

function queryOf(request: LogsRequest): Query {
  const query: Query = {};
  for (const [key, value] of Object.entries(request)) {
    if (value !== undefined && value !== "") query[key] = value;
  }
  return query;
}

/** A logfile adapter's sources, or none when its config is not one (a stored row from elsewhere). */
export function sourcesOf(adapter: Pick<Adapter, "config">): LogSource[] {
  const parsed = v.safeParse(logfileConfigSchema, adapter.config);
  return parsed.success ? parsed.output.sources : [];
}

export const logsModel = {
  /** Every log adapter this session may see, across projects: the Logs screen (#69). */
  adapters: (): Promise<AdapterWithProject[]> =>
    apiClient.get("/log-adapters", { schema: v.array(adapterWithProjectSchema) }),
  read: (slug: string, id: string, request: LogsRequest): Promise<LogsPage> =>
    apiClient.get(logsPath(slug, id), { schema: logsPageSchema, query: queryOf(request) }),
  /** The masked JSON lines of what the viewer shows (S3); the browser follows the link itself. */
  downloadUrl: (slug: string, id: string, request: LogsRequest): string =>
    apiClient.url(`${logsPath(slug, id)}/download`, queryOf(request)),
};
