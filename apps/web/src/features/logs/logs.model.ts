import * as v from "valibot";
import type {
  Adapter,
  AdapterWithProject,
  IngestToken,
  LogSource,
  LogsPage,
} from "@testate/shared";
import {
  adapterWithProjectSchema,
  ingestTokenSchema,
  logSourcesSchema,
  logfileConfigSchema,
  logsPageSchema,
} from "@testate/shared";

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

const adapterPath = (slug: string, id: string): string =>
  `/projects/${encodeURIComponent(slug)}/adapters/${encodeURIComponent(id)}`;
const logsPath = (slug: string, id: string): string => `${adapterPath(slug, id)}/logs`;

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
  /**
   * The adapters a run's Logs menu offers (Q8): every log adapter, and every database adapter
   * whose credential can read a server log (#84, D5).
   */
  runAdapters: async (): Promise<AdapterWithProject[]> => {
    const [logs, databases] = await Promise.all([
      apiClient.get("/log-adapters", { schema: v.array(adapterWithProjectSchema) }),
      apiClient.get("/database-adapters", { schema: v.array(adapterWithProjectSchema) }),
    ]);
    return [
      ...logs,
      ...databases.filter((adapter) => (adapter.capabilities?.serverLogs ?? []).length > 0),
    ];
  },
  /** A logfile's configured names, or the sources an ingest adapter holds (#75, I2). */
  sources: (slug: string, id: string): Promise<string[]> =>
    apiClient.get(`${logsPath(slug, id)}/sources`, { schema: logSourcesSchema }),
  /** A new ingest token; the old one stops at once (I8). */
  rotateToken: (slug: string, id: string): Promise<IngestToken> =>
    apiClient.post(`${adapterPath(slug, id)}/ingest-token/rotation`, { schema: ingestTokenSchema }),
  /** Removes every line an ingest adapter holds (I3a); admin only. */
  clear: (slug: string, id: string): Promise<{ cleared: boolean }> =>
    apiClient.post(`${logsPath(slug, id)}/clear`, { schema: v.object({ cleared: v.boolean() }) }),
  /** Where an app sends its lines: a full URL, since it is pasted into the app's own config. */
  pushUrl: (id: string): string =>
    new URL(apiClient.url(`/ingest/${encodeURIComponent(id)}`), window.location.origin).toString(),
  /** The masked JSON lines of what the viewer shows (S3); the browser follows the link itself. */
  downloadUrl: (slug: string, id: string, request: LogsRequest): string =>
    apiClient.url(`${logsPath(slug, id)}/download`, queryOf(request)),
};
