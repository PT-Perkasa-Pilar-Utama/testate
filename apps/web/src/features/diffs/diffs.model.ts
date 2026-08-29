import * as v from "valibot";
import type { Diff, DiffRow, Job, JsonObject } from "@testate/shared";
import { diffRowSchema, diffSchema, jobSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";
import type { Query } from "@/lib/api-client.ts";

const base = (slug: string): string => `/projects/${encodeURIComponent(slug)}/diffs`;
const one = (slug: string, id: string): string => `${base(slug)}/${encodeURIComponent(id)}`;

const rowsPageSchema = v.object({
  data: v.array(diffRowSchema),
  page: v.object({ next_cursor: v.nullable(v.string()), limit: v.number() }),
  masked_columns: v.array(v.string()),
});
export type DiffRowsPage = v.InferOutput<typeof rowsPageSchema>;
export type DiffRowsQuery = { adapter_id: string; table: string; op?: DiffRow["op"] };

export const diffsModel = {
  list: (slug: string): Promise<Diff[]> =>
    apiClient.get(base(slug), { schema: v.array(diffSchema) }),
  create: (slug: string, body: JsonObject): Promise<{ diff: Diff; job: Job }> =>
    apiClient.post(base(slug), { schema: v.object({ diff: diffSchema, job: jobSchema }), body }),
  get: (slug: string, id: string): Promise<Diff> =>
    apiClient.get(one(slug, id), { schema: diffSchema }),
  rows: (slug: string, id: string, query: DiffRowsQuery): Promise<DiffRowsPage> =>
    apiClient.envelope(`${one(slug, id)}/rows`, {
      schema: rowsPageSchema,
      query: { ...query, limit: 100 } satisfies Query,
    }),
  remove: (slug: string, id: string): Promise<undefined> =>
    apiClient.delete(one(slug, id), { schema: v.undefined() }),
  exportUrl: (slug: string, id: string, format: "csv" | "jsonl"): string =>
    apiClient.url(`${one(slug, id)}/export`, { format }),
};
