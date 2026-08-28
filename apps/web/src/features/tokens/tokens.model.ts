import * as v from "valibot";
import type { ApiToken, JsonObject } from "@testate/shared";
import { apiTokenSchema, createTokenResponseSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

export type CreatedToken = v.InferOutput<typeof createTokenResponseSchema>;

export const tokensModel = {
  list: (): Promise<ApiToken[]> => apiClient.get("/tokens", { schema: v.array(apiTokenSchema) }),
  create: (body: JsonObject): Promise<CreatedToken> =>
    apiClient.post("/tokens", { schema: createTokenResponseSchema, body }),
  revoke: (id: string): Promise<undefined> =>
    apiClient.delete(`/tokens/${encodeURIComponent(id)}`, { schema: v.undefined() }),
};
