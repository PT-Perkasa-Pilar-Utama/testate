import * as v from "valibot";
import type { Hook, JsonObject } from "@testate/shared";
import { hookSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

const base = (slug: string): string => `/projects/${encodeURIComponent(slug)}/hooks`;
const one = (slug: string, id: string): string => `${base(slug)}/${encodeURIComponent(id)}`;

export const hooksModel = {
  list: (slug: string): Promise<Hook[]> =>
    apiClient.get(base(slug), { schema: v.array(hookSchema) }),
  create: (slug: string, body: JsonObject): Promise<Hook> =>
    apiClient.post(base(slug), { schema: hookSchema, body }),
  update: (slug: string, id: string, body: JsonObject): Promise<Hook> =>
    apiClient.patch(one(slug, id), { schema: hookSchema, body }),
  reorder: (slug: string, body: JsonObject): Promise<Hook[]> =>
    apiClient.put(`${base(slug)}/order`, { schema: v.array(hookSchema), body }),
  remove: (slug: string, id: string): Promise<undefined> =>
    apiClient.delete(one(slug, id), { schema: v.undefined() }),
};
