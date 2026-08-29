import * as v from "valibot";
import type { Job, JsonObject, State, StateDetail, StateTreeNode } from "@testate/shared";
import { jobSchema, stateDetailSchema, stateSchema, stateTreeNodeSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";
import type { Query } from "@/lib/api-client.ts";

const base = (slug: string): string => `/projects/${encodeURIComponent(slug)}/states`;
const one = (slug: string, id: string): string => `${base(slug)}/${encodeURIComponent(id)}`;

function pageQuery(includeStash: boolean, cursor: string | undefined): Query {
  const query: Query = { include_stash: includeStash ? "true" : "false" };
  if (cursor !== undefined) query["cursor"] = cursor;
  return query;
}

export const statesModel = {
  list: (slug: string, includeStash: boolean): Promise<State[]> =>
    apiClient.get(base(slug), {
      schema: v.array(stateSchema),
      query: { include_stash: includeStash ? "true" : "false" },
    }),
  page: (
    slug: string,
    includeStash: boolean,
    cursor?: string
  ): Promise<{ data: State[]; next: string | null }> =>
    apiClient.page(base(slug), stateSchema, pageQuery(includeStash, cursor)),
  tree: (slug: string): Promise<StateTreeNode[]> =>
    apiClient.get(`${base(slug)}/tree`, { schema: v.array(stateTreeNodeSchema) }),
  get: (slug: string, id: string): Promise<StateDetail> =>
    apiClient.get(one(slug, id), { schema: stateDetailSchema }),
  create: (slug: string, body: JsonObject): Promise<{ state: State; job: Job }> =>
    apiClient.post(base(slug), { schema: v.object({ state: stateSchema, job: jobSchema }), body }),
  update: (slug: string, id: string, body: JsonObject): Promise<State> =>
    apiClient.patch(one(slug, id), { schema: stateSchema, body }),
  remove: (slug: string, id: string): Promise<Job> =>
    apiClient.delete(one(slug, id), { schema: jobSchema }),
  archiveUrl: (slug: string, id: string): string => apiClient.url(`${one(slug, id)}/archive`),
};
