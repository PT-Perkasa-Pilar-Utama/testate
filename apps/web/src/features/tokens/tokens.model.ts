import * as v from "valibot";
import type { ApiToken, JsonObject } from "@testate/shared";
import { apiTokenSchema, createTokenResponseSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";
import type { Page } from "@/lib/async.ts";
import { tableQuery } from "@/lib/table.ts";
import type { TableParams } from "@/lib/table.ts";
import type { TokenSort } from "./tokens.presenter.ts";

export type CreatedToken = v.InferOutput<typeof createTokenResponseSchema>;

export const tokensModel = {
  list: (): Promise<ApiToken[]> => apiClient.get("/tokens", { schema: v.array(apiTokenSchema) }),
  page: (cursor: string | undefined, params: TableParams<TokenSort>): Promise<Page<ApiToken>> =>
    apiClient.page("/tokens", apiTokenSchema, tableQuery(params, cursor)),
  create: (body: JsonObject): Promise<CreatedToken> =>
    apiClient.post("/tokens", { schema: createTokenResponseSchema, body }),
  revoke: (id: string): Promise<undefined> =>
    apiClient.delete(`/tokens/${encodeURIComponent(id)}`, { schema: v.undefined() }),
};
