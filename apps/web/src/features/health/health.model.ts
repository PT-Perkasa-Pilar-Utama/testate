import { healthPublicSchema } from "@testate/shared";
import type { InferOutput } from "valibot";

import { apiClient } from "@/lib/api-client.ts";

export type HealthPublic = InferOutput<typeof healthPublicSchema>;

export const healthModel = {
  get: (): Promise<HealthPublic> => apiClient.get("/health", { schema: healthPublicSchema }),
};
