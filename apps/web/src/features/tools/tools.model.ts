import * as v from "valibot";
import type { JsonObject } from "@testate/shared";
import { hashResponseSchema, randomResponseSchema, uuidResponseSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

export type HashResponse = v.InferOutput<typeof hashResponseSchema>;
export type RandomResponse = v.InferOutput<typeof randomResponseSchema>;
export type UuidResponse = v.InferOutput<typeof uuidResponseSchema>;

/** Hashing runs on the API so the same functions back column policies and imports. */
export const toolsModel = {
  hash: (body: JsonObject): Promise<HashResponse> =>
    apiClient.post("/tools/hash", { schema: hashResponseSchema, body }),
  random: (body: JsonObject): Promise<RandomResponse> =>
    apiClient.post("/tools/random", { schema: randomResponseSchema, body }),
  uuid: (body: JsonObject): Promise<UuidResponse> =>
    apiClient.post("/tools/uuid", { schema: uuidResponseSchema, body }),
};
