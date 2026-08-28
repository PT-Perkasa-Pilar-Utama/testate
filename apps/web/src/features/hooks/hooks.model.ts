import * as v from "valibot";
import type { Hook } from "@testate/shared";
import { hookSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

export const hooksModel = {
  list: (slug: string): Promise<Hook[]> =>
    apiClient.get(`/projects/${encodeURIComponent(slug)}/hooks`, { schema: v.array(hookSchema) }),
};
