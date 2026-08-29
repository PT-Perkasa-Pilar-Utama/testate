import * as v from "valibot";
import type { Checkout, Job, JsonObject, Preflight } from "@testate/shared";
import { checkoutSchema, jobSchema, preflightSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

const base = (slug: string): string => `/projects/${encodeURIComponent(slug)}/checkouts`;

export const checkoutsModel = {
  list: (slug: string): Promise<Checkout[]> =>
    apiClient.get(base(slug), { schema: v.array(checkoutSchema) }),
  preflight: (slug: string, body: JsonObject): Promise<Preflight> =>
    apiClient.post(`${base(slug)}/preflight`, { schema: preflightSchema, body }),
  create: (slug: string, body: JsonObject): Promise<{ checkout: Checkout; job: Job }> =>
    apiClient.post(base(slug), {
      schema: v.object({ checkout: checkoutSchema, job: jobSchema }),
      body,
    }),
};
