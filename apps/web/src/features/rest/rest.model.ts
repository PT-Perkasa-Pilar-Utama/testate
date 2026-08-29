import * as v from "valibot";
import type { JsonObject, RestRequest, RestRun } from "@testate/shared";
import { restRequestSchema, restRunSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

const base = (slug: string, id: string): string =>
  `/projects/${encodeURIComponent(slug)}/rest/${encodeURIComponent(id)}/requests`;

export const restModel = {
  list: (slug: string, id: string): Promise<RestRequest[]> =>
    apiClient.get(base(slug, id), { schema: v.array(restRequestSchema) }),
  create: (slug: string, id: string, body: JsonObject): Promise<RestRequest> =>
    apiClient.post(base(slug, id), { schema: restRequestSchema, body }),
  remove: (slug: string, id: string, requestId: string): Promise<undefined> =>
    apiClient.delete(`${base(slug, id)}/${encodeURIComponent(requestId)}`, {
      schema: v.undefined(),
    }),
  run: (slug: string, id: string, requestId: string): Promise<RestRun> =>
    apiClient.post(`${base(slug, id)}/${encodeURIComponent(requestId)}/run`, {
      schema: restRunSchema,
      body: {},
    }),
  runs: (slug: string, id: string, requestId: string): Promise<RestRun[]> =>
    apiClient.get(`${base(slug, id)}/${encodeURIComponent(requestId)}/runs`, {
      schema: v.array(restRunSchema),
    }),
};
