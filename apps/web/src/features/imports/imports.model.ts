import * as v from "valibot";
import type { ImportRun } from "@testate/shared";
import { importRunSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

export const importsModel = {
  list: (slug: string): Promise<ImportRun[]> =>
    apiClient.get(`/projects/${encodeURIComponent(slug)}/imports`, {
      schema: v.array(importRunSchema),
    }),
};
