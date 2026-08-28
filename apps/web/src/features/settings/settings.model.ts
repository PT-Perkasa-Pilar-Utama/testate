import type { Settings } from "@testate/shared";
import { settingsSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

export const settingsModel = {
  get: (): Promise<Settings> => apiClient.get("/settings", { schema: settingsSchema }),
};
