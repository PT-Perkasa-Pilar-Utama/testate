import * as v from "valibot";
import type { Adapter } from "@testate/shared";
import { adapterSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

const base = (slug: string): string => `/projects/${encodeURIComponent(slug)}/adapters`;

export const adaptersModel = {
  list: (slug: string): Promise<Adapter[]> =>
    apiClient.get(base(slug), { schema: v.array(adapterSchema) }),
  get: (slug: string, id: string): Promise<Adapter> =>
    apiClient.get(`${base(slug)}/${encodeURIComponent(id)}`, { schema: adapterSchema }),
};
