import * as v from "valibot";
import type { Checkout } from "@testate/shared";
import { checkoutSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

export const checkoutsModel = {
  list: (slug: string): Promise<Checkout[]> =>
    apiClient.get(`/projects/${encodeURIComponent(slug)}/checkouts`, {
      schema: v.array(checkoutSchema),
    }),
};
