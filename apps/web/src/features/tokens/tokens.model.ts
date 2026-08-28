import * as v from "valibot";
import type { ApiToken } from "@testate/shared";
import { apiTokenSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

export const tokensModel = {
  list: (): Promise<ApiToken[]> => apiClient.get("/tokens", { schema: v.array(apiTokenSchema) }),
};
