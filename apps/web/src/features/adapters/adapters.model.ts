import * as v from "valibot";
import type { Adapter, JsonObject } from "@testate/shared";
import {
  adapterDeletionPlanSchema,
  adapterSchema,
  createAdapterResponseSchema,
  jobSchema,
  probeOutcomeSchema,
} from "@testate/shared";

import { hostSuggestionSchema } from "@testate/shared";
import type { HostSuggestion } from "@testate/shared";
import { apiClient } from "@/lib/api-client.ts";

export type ProbeOutcome = v.InferOutput<typeof probeOutcomeSchema>;
export type CreatedAdapter = v.InferOutput<typeof createAdapterResponseSchema>;
export type AdapterDeletionPlan = v.InferOutput<typeof adapterDeletionPlanSchema>;
export type Job = v.InferOutput<typeof jobSchema>;

const base = (slug: string): string => `/projects/${encodeURIComponent(slug)}/adapters`;
const one = (slug: string, id: string): string => `${base(slug)}/${encodeURIComponent(id)}`;

export const adaptersModel = {
  /** Hosts the API can reach from where it runs; the browser cannot work these out itself. */
  hosts: (): Promise<HostSuggestion[]> =>
    apiClient.get("/adapter-hosts", { schema: v.array(hostSuggestionSchema) }),
  list: (slug: string): Promise<Adapter[]> =>
    apiClient.get(base(slug), { schema: v.array(adapterSchema) }),
  get: (slug: string, id: string): Promise<Adapter> =>
    apiClient.get(one(slug, id), { schema: adapterSchema }),
  test: (slug: string, body: JsonObject): Promise<ProbeOutcome> =>
    apiClient.post(`${base(slug)}/test`, { schema: probeOutcomeSchema, body }),
  create: (slug: string, body: JsonObject): Promise<CreatedAdapter> =>
    apiClient.post(base(slug), { schema: createAdapterResponseSchema, body }),
  update: (slug: string, id: string, body: JsonObject): Promise<CreatedAdapter> =>
    apiClient.patch(one(slug, id), { schema: createAdapterResponseSchema, body }),
  setMode: (slug: string, id: string, mode: "sandbox" | "read_only"): Promise<Adapter> =>
    apiClient.post(`${one(slug, id)}/mode`, { schema: adapterSchema, body: { mode } }),
  retest: (slug: string, id: string): Promise<ProbeOutcome> =>
    apiClient.post(`${one(slug, id)}/retest`, { schema: probeOutcomeSchema }),
  deletionPlan: (slug: string, id: string): Promise<AdapterDeletionPlan> =>
    apiClient.get(`${one(slug, id)}/deletion-plan`, { schema: adapterDeletionPlanSchema }),
  remove: (slug: string, id: string, body: JsonObject): Promise<Job> =>
    apiClient.post(`${one(slug, id)}/deletion`, { schema: jobSchema, body }),
};
