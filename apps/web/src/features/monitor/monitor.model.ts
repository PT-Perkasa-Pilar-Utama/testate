import * as v from "valibot";
import type { Reading, ReadingSeries } from "@testate/shared";
import { readingSchema, readingSeriesSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

const base = (slug: string): string => `/projects/${encodeURIComponent(slug)}/readings`;

export type SeriesWindow = { from: string; to: string; step: number };

export const monitorModel = {
  series: (slug: string, window: SeriesWindow): Promise<ReadingSeries> =>
    apiClient.get(`${base(slug)}/series`, {
      schema: readingSeriesSchema,
      query: { from: window.from, to: window.to, step: window.step },
    }),
  /** The newest reading, polled or taken by hand; null before the first. */
  latest: async (slug: string): Promise<Reading | null> =>
    (await apiClient.get(base(slug), { schema: v.array(readingSchema), query: { limit: 1 } }))[0] ??
    null,
  take: (slug: string): Promise<Reading> =>
    apiClient.post(base(slug), { schema: readingSchema, body: {} }),
};
