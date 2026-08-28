import * as v from "valibot";
import type { Diff } from "@testate/shared";
import { diffSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

export const diffsModel = {
  list: (slug: string): Promise<Diff[]> =>
    apiClient.get(`/projects/${encodeURIComponent(slug)}/diffs`, { schema: v.array(diffSchema) }),
};
