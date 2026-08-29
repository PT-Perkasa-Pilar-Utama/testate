import * as v from "valibot";
import type { Checkout, Counters, Job, JsonObject, Preflight } from "@testate/shared";
import { checkoutSchema, countersSchema, jobSchema, preflightSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

const base = (slug: string): string => `/projects/${encodeURIComponent(slug)}/checkouts`;
const one = (slug: string, id: string): string => `${base(slug)}/${encodeURIComponent(id)}`;
const withJob = v.object({ checkout: checkoutSchema, job: jobSchema });

export const checkoutsModel = {
  list: (slug: string): Promise<Checkout[]> =>
    apiClient.get(base(slug), { schema: v.array(checkoutSchema) }),
  preflight: (slug: string, body: JsonObject): Promise<Preflight> =>
    apiClient.post(`${base(slug)}/preflight`, { schema: preflightSchema, body }),
  create: (slug: string, body: JsonObject): Promise<{ checkout: Checkout; job: Job }> =>
    apiClient.post(base(slug), { schema: withJob, body }),
  retry: (slug: string, id: string): Promise<{ checkout: Checkout; job: Job }> =>
    apiClient.post(`${one(slug, id)}/retry`, { schema: withJob, body: {} }),
  terminateBlockers: (
    slug: string,
    id: string,
    body: JsonObject
  ): Promise<{ terminated: string[]; failed: string[] }> =>
    apiClient.post(`${one(slug, id)}/terminate-blockers`, {
      schema: v.object({ terminated: v.array(v.string()), failed: v.array(v.string()) }),
      body,
    }),
  counters: (slug: string, id: string): Promise<Counters> =>
    apiClient.get(`${one(slug, id)}/counters`, { schema: countersSchema }),
  repairCounters: (slug: string, id: string): Promise<Counters> =>
    apiClient.post(`${one(slug, id)}/repair-counters`, { schema: countersSchema, body: {} }),
};
