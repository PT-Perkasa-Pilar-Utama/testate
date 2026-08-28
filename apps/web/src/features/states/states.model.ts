import * as v from "valibot";
import type { State } from "@testate/shared";
import { stateSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

export const statesModel = {
  list: (slug: string): Promise<State[]> =>
    apiClient.get(`/projects/${encodeURIComponent(slug)}/states`, {
      schema: v.array(stateSchema),
    }),
};
