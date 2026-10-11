import * as v from "valibot";
import type { Reading } from "@testate/shared";
import { readingSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

const base = (slug: string): string => `/projects/${encodeURIComponent(slug)}/readings`;

/** ponytail: the newest 100 readings, one page. A project keeps them for the job history, so a
 * long one could hold more; a Load more on the cursor is the upgrade. */
const LIST_LIMIT = 100;

export const readingsModel = {
  list: (slug: string): Promise<Reading[]> =>
    apiClient.get(base(slug), { schema: v.array(readingSchema), query: { limit: LIST_LIMIT } }),
  take: (slug: string): Promise<Reading> =>
    apiClient.post(base(slug), { schema: readingSchema, body: {} }),
};
