import * as v from "valibot";
import type { JsonObject, QueryRequest, QueryResult, RowsPage } from "@testate/shared";
import {
  queryHistoryRowSchema,
  queryResultSchema,
  rowsPageSchema,
  runningQuerySchema,
  savedQuerySchema,
} from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";
import type { Download } from "@/lib/api-client.ts";

export type RunningQuery = v.InferOutput<typeof runningQuerySchema>;
export type SavedQuery = v.InferOutput<typeof savedQuerySchema>;
export type HistoryRow = v.InferOutput<typeof queryHistoryRowSchema>;

export type RowsQuery = {
  cursor?: string;
  limit: number;
  sort?: string;
  order: "asc" | "desc";
  filter: string[];
};

const adapterPath = (slug: string, id: string): string =>
  `/projects/${encodeURIComponent(slug)}/adapters/${encodeURIComponent(id)}`;

/** `filter` repeats per entry (06 §6.2); the client's query map takes one value per key, so build the string here. */
function rowsQueryString(query: RowsQuery): string {
  const params = new URLSearchParams();
  params.set("limit", String(query.limit));
  params.set("order", query.order);
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  if (query.sort !== undefined) params.set("sort", query.sort);
  for (const item of query.filter) params.append("filter", item);
  return `?${params.toString()}`;
}

export const dataModel = {
  rows: (slug: string, id: string, table: string, query: RowsQuery): Promise<RowsPage> =>
    apiClient.envelope(
      `${adapterPath(slug, id)}/tables/${encodeURIComponent(table)}/rows${rowsQueryString(query)}`,
      { schema: rowsPageSchema }
    ),
  /**
   * A link, not a fetch: the browser streams the file straight to disk and the session cookie
   * carries the auth, the same way a state archive downloads. The filters and sort travel with it,
   * so what you exported is what you were looking at. No row cap and no cursor.
   */
  tableExportUrl: (
    slug: string,
    id: string,
    table: string,
    query: Omit<RowsQuery, "cursor" | "limit">,
    format: "csv" | "json"
  ): string => {
    const params = new URLSearchParams({ order: query.order, format });
    if (query.sort !== undefined) params.set("sort", query.sort);
    for (const item of query.filter) params.append("filter", item);
    return apiClient.url(
      `${adapterPath(slug, id)}/tables/${encodeURIComponent(table)}/export?${params.toString()}`
    );
  },
  query: (slug: string, id: string, body: QueryRequest): Promise<QueryResult> =>
    apiClient.post(`${adapterPath(slug, id)}/query`, {
      schema: queryResultSchema,
      body: v.parse(v.record(v.string(), v.any()), body),
    }),
  exportQuery: (
    slug: string,
    id: string,
    body: QueryRequest,
    format: "csv" | "json"
  ): Promise<Download> =>
    apiClient.download(
      `${adapterPath(slug, id)}/query/export`,
      { ...v.parse(v.record(v.string(), v.any()), body), format },
      `query.${format}`
    ),
  running: (slug: string, id: string): Promise<RunningQuery[]> =>
    apiClient.get(`${adapterPath(slug, id)}/queries`, { schema: v.array(runningQuerySchema) }),
  cancel: (slug: string, id: string, queryId: string): Promise<undefined> =>
    apiClient.delete(`${adapterPath(slug, id)}/queries/${encodeURIComponent(queryId)}`, {
      schema: v.undefined(),
    }),
  savedQueries: (slug: string, id: string): Promise<SavedQuery[]> =>
    apiClient.get(`${adapterPath(slug, id)}/saved-queries`, { schema: v.array(savedQuerySchema) }),
  saveQuery: (slug: string, id: string, name: string, body: JsonObject): Promise<SavedQuery> =>
    apiClient.post(`${adapterPath(slug, id)}/saved-queries`, {
      schema: savedQuerySchema,
      body: { name, body },
    }),
  removeSavedQuery: (slug: string, id: string, queryId: string): Promise<undefined> =>
    apiClient.delete(`${adapterPath(slug, id)}/saved-queries/${encodeURIComponent(queryId)}`, {
      schema: v.undefined(),
    }),
  history: (slug: string, id: string): Promise<HistoryRow[]> =>
    apiClient.get(`${adapterPath(slug, id)}/query-history`, {
      query: { limit: 50 },
      schema: v.array(queryHistoryRowSchema),
    }),
};
