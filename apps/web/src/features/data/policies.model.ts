import * as v from "valibot";
import type { ColumnPolicy, JsonObject } from "@testate/shared";
import { columnPolicySchema, lookupResultSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

export type LookupRow = v.InferOutput<typeof lookupResultSchema>;

const adapterPath = (slug: string, id: string): string =>
  `/projects/${encodeURIComponent(slug)}/adapters/${encodeURIComponent(id)}`;
const policyPath = (slug: string, id: string, table: string, column: string): string =>
  `${adapterPath(slug, id)}/policies/${encodeURIComponent(table)}/${encodeURIComponent(column)}`;

export const policiesModel = {
  list: (slug: string, id: string): Promise<ColumnPolicy[]> =>
    apiClient.get(`${adapterPath(slug, id)}/policies`, { schema: v.array(columnPolicySchema) }),
  upsert: (
    slug: string,
    id: string,
    table: string,
    column: string,
    body: JsonObject
  ): Promise<ColumnPolicy> =>
    apiClient.put(policyPath(slug, id, table, column), { schema: columnPolicySchema, body }),
  remove: (slug: string, id: string, table: string, column: string): Promise<undefined> =>
    apiClient.delete(policyPath(slug, id, table, column), { schema: v.undefined() }),
  setLock: (
    slug: string,
    id: string,
    table: string,
    column: string,
    locked: boolean
  ): Promise<ColumnPolicy> =>
    apiClient.post(`${policyPath(slug, id, table, column)}/${locked ? "lock" : "unlock"}`, {
      schema: columnPolicySchema,
    }),
  lookup: (
    slug: string,
    id: string,
    table: string,
    column: string,
    q: string
  ): Promise<LookupRow[]> =>
    apiClient.get(`${adapterPath(slug, id)}/tables/${encodeURIComponent(table)}/lookup`, {
      query: { column, q, limit: 20 },
      schema: v.array(lookupResultSchema),
    }),
};
