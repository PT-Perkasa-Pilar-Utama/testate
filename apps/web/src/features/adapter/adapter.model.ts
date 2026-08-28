import * as v from "valibot";
import type { Entry, Introspection, RestRequest } from "@testate/shared";
import { entrySchema, introspectionSchema, restRequestSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

const adapterPath = (slug: string, id: string): string =>
  `/projects/${encodeURIComponent(slug)}/adapters/${encodeURIComponent(id)}`;

/** Detail reads per tier: schema for tabular and document, entries for files, requests for REST. */
export const adapterModel = {
  schema: (slug: string, id: string): Promise<Introspection> =>
    apiClient.get(`${adapterPath(slug, id)}/schema`, { schema: introspectionSchema }),
  entries: (slug: string, id: string): Promise<Entry[]> =>
    apiClient.get(`${adapterPath(slug, id)}/entries`, { schema: v.array(entrySchema) }),
  requests: (slug: string, id: string): Promise<RestRequest[]> =>
    apiClient.get(`/projects/${encodeURIComponent(slug)}/rest/${encodeURIComponent(id)}/requests`, {
      schema: v.array(restRequestSchema),
    }),
};
